from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.org.models import Department


async def list_departments(session: AsyncSession) -> list[Department]:
    return list(await session.scalars(select(Department).order_by(Department.name)))
