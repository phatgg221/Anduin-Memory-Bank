"""Auth: users, registration, login, JWT access tokens, rotating refresh tokens (revocable, reuse-detected).

Leaf module (depends only on core/db). Any module's router may depend on `auth.deps.CurrentUser`.
"""
