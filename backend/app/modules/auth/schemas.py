import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, ValidationInfo, field_validator

Email = Annotated[EmailStr, Field(max_length=320)]


class RegisterIn(BaseModel):
    email: Email
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        return value.lower()

    @field_validator("confirm_password")
    @classmethod
    def passwords_match(cls, value: str, info: ValidationInfo) -> str:
        if "password" in info.data and value != info.data["password"]:
            raise ValueError("Passwords do not match")
        return value


class LoginIn(BaseModel):
    email: Email
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        return value.lower()


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    avatar_initials: str
    role: str
    job_title: str | None
    primary_department_id: str | None
    active_department_id: str | None
    created_at: datetime


class ActiveDepartmentIn(BaseModel):
    """null = All Departments."""

    department_id: str | None


class AuthOut(BaseModel):
    """Returned by register, login, and refresh. The refresh token itself travels only as an httpOnly cookie."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int  # seconds until the access token expires
    user: UserOut
