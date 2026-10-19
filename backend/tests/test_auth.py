import re

from app.core.config import settings
from app.modules.auth.router import REFRESH_COOKIE

REGISTER = {
    "email": "Minh.Nguyen@Corvane.example",
    "name": "Minh Nguyen",
    "password": "cayman-feeder-iv",
    "confirm_password": "cayman-feeder-iv",
}


def register(client, **overrides):
    return client.post("/api/auth/register", json={**REGISTER, **overrides})


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def refresh_with(client, token: str):
    """Call /refresh presenting exactly `token` as the cookie (ignores the client's cookie jar)."""
    client.cookies.clear()
    return client.post("/api/auth/refresh", headers={"Cookie": f"{REFRESH_COOKIE}={token}"})


def test_register_signs_in_and_sets_httponly_refresh_cookie(client):
    response = register(client)

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == settings.access_token_ttl_minutes * 60
    assert body["user"]["email"] == "minh.nguyen@corvane.example"  # normalised
    assert body["user"]["name"] == "Minh Nguyen"
    assert "password" not in str(body["user"]).lower()

    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{REFRESH_COOKIE}=")
    assert "HttpOnly" in cookie
    assert re.search(r"Path=/(;|$)", cookie)  # site-wide, so the Next.js proxy can verify it
    assert "SameSite=lax" in cookie

    me = client.get("/api/auth/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200
    assert me.json()["id"] == body["user"]["id"]


def test_register_rejects_duplicate_email_case_insensitively(client):
    assert register(client).status_code == 201
    response = register(client, email="MINH.NGUYEN@corvane.example")
    assert response.status_code == 409


def test_register_validates_password_confirmation_and_length(client):
    mismatch = register(client, confirm_password="something-else")
    assert mismatch.status_code == 422
    assert mismatch.json()["detail"][0]["loc"] == ["body", "confirm_password"]

    short = register(client, password="short", confirm_password="short")
    assert short.status_code == 422
    assert short.json()["detail"][0]["loc"] == ["body", "password"]

    blank_name = register(client, name="   ")
    assert blank_name.status_code == 422


def test_login_uses_one_message_for_wrong_password_and_unknown_email(client):
    register(client)
    wrong = client.post("/api/auth/login", json={"email": REGISTER["email"], "password": "not-it"})
    unknown = client.post("/api/auth/login", json={"email": "nobody@corvane.example", "password": "not-it"})

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid email or password"}

    ok = client.post("/api/auth/login", json={"email": "MINH.nguyen@corvane.example", "password": REGISTER["password"]})
    assert ok.status_code == 200
    assert client.cookies.get(REFRESH_COOKIE)


def test_refresh_rotates_the_refresh_token(client):
    register(client)
    first = client.cookies.get(REFRESH_COOKIE)

    response = client.post("/api/auth/refresh")

    assert response.status_code == 200
    assert response.json()["user"]["email"] == "minh.nguyen@corvane.example"
    second = client.cookies.get(REFRESH_COOKIE)
    assert second and second != first
    assert client.get("/api/auth/me", headers=bearer(response.json()["access_token"])).status_code == 200


def test_replaying_a_just_rotated_token_inside_grace_window_is_a_benign_race(client):
    register(client)
    first = client.cookies.get(REFRESH_COOKIE)
    client.post("/api/auth/refresh")
    second = client.cookies.get(REFRESH_COOKIE)

    race = refresh_with(client, first)
    assert race.status_code == 409
    assert race.json()["detail"] == "refresh_token_rotated"
    # The session survives: the newest token still works.
    assert refresh_with(client, second).status_code == 200


def test_reusing_a_rotated_token_after_grace_revokes_the_whole_session(client, monkeypatch):
    monkeypatch.setattr(settings, "refresh_reuse_grace_seconds", 0)
    register(client)
    stolen = client.cookies.get(REFRESH_COOKIE)
    client.post("/api/auth/refresh")
    current = client.cookies.get(REFRESH_COOKIE)

    reuse = refresh_with(client, stolen)
    assert reuse.status_code == 401
    assert f'{REFRESH_COOKIE}=""' in reuse.headers["set-cookie"]  # cookie cleared
    # Theft detected → the legitimate holder's newer token is revoked too.
    assert refresh_with(client, current).status_code == 401


def test_logout_revokes_the_session_and_clears_the_cookie(client):
    register(client)
    token = client.cookies.get(REFRESH_COOKIE)

    response = client.post("/api/auth/logout")

    assert response.status_code == 204
    assert f'{REFRESH_COOKIE}=""' in response.headers["set-cookie"]
    assert refresh_with(client, token).status_code == 401
    # Logging out again (no cookie) is a harmless no-op.
    client.cookies.clear()
    assert client.post("/api/auth/logout").status_code == 204


def test_me_requires_a_valid_access_token(client):
    response = register(client)
    refresh_token = client.cookies.get(REFRESH_COOKIE)

    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=bearer("not-a-jwt")).status_code == 401
    # A refresh token must not work as an access token.
    assert client.get("/api/auth/me", headers=bearer(refresh_token)).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(response.json()["access_token"])).status_code == 200


def test_register_with_role_and_department(client, sql):
    sql("INSERT INTO departments (id, code, name) VALUES ('LEGAL_COMPLIANCE', 'LEGAL', 'Legal & Compliance')")
    assert [d["code"] for d in client.get("/api/auth/departments").json()] == ["LEGAL"]  # public

    created = register(client, job_title="  Legal Counsel ", department_id="LEGAL_COMPLIANCE")
    assert created.status_code == 201
    user = created.json()["user"]
    assert user["job_title"] == "Legal Counsel"
    assert user["primary_department_id"] == user["active_department_id"] == "LEGAL_COMPLIANCE"
    assert user["role"] == "MEMBER"  # not self-assignable

    unknown = register(client, email="other@corvane.example", department_id="NOPE")
    assert unknown.status_code == 422
