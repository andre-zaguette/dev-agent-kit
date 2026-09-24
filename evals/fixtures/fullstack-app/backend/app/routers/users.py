from fastapi import APIRouter

from app.schemas import UserOut

router = APIRouter(prefix="/api/users", tags=["users"])

USERS: list[dict] = [{"id": "1", "email": "ana@example.test", "name": "Ana"}]


@router.get("", response_model=list[UserOut])
def list_users():
    return USERS
