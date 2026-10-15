import uuid

from fastapi import APIRouter, HTTPException, status

from app.core.db import SessionDep
from app.modules.auth.deps import CurrentUser
from app.modules.vault import service
from app.modules.vault.schemas import ArtifactLinkOut, VaultCaseOut, VaultViewOut

router = APIRouter(prefix="/vault", tags=["vault"])


@router.get("/cases")
async def vault_cases(user: CurrentUser, session: SessionDep, department_id: str | None = None) -> VaultViewOut:
    cases, counts, total = await service.vault_view(session, department_id)
    return VaultViewOut(
        department_id=department_id,
        total=total,
        counts=counts,
        cases=[VaultCaseOut.model_validate(c) for c in cases],
    )


@router.post("/artifacts/{artifact_id}/link")
async def artifact_link(artifact_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> ArtifactLinkOut:
    """A fresh short-lived GET link per click (presigned URLs expire, so they're never cached)."""
    try:
        url, expires_in = await service.artifact_link(session, artifact_id)
    except service.ArtifactNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artifact not found") from None
    return ArtifactLinkOut(url=url, expires_in=expires_in)
