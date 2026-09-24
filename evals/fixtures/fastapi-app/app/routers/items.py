from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Item
from app.schemas import ItemCreate, ItemOut

router = APIRouter(prefix="/items", tags=["items"])


@router.get("", response_model=list[ItemOut])
def list_items(db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    return db.query(Item).order_by(Item.id).all()


@router.post("", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
def create_item(body: ItemCreate, db: Session = Depends(get_db), user: str = Depends(get_current_user)):
    if db.query(Item).filter(Item.name == body.name).first():
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "ITEM_EXISTS"})
    item = Item(**body.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
