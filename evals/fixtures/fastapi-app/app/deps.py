from fastapi import Header, HTTPException, status


def get_current_user(x_user_id: str | None = Header(default=None)) -> str:
    if not x_user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "UNAUTHENTICATED"})
    return x_user_id
