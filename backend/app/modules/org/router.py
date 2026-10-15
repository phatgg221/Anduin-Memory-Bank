from fastapi import APIRouter

from app.core.db import SessionDep
from app.modules.auth.deps import CurrentUser
from app.modules.org import service
from app.modules.org.schemas import DepartmentOut

router = APIRouter(prefix="/org", tags=["org"])


@router.get("/departments")
async def list_departments(user: CurrentUser, session: SessionDep) -> list[DepartmentOut]:
    return [DepartmentOut.model_validate(d) for d in await service.list_departments(session)]
