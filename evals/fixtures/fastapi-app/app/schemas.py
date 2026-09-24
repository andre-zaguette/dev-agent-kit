from pydantic import BaseModel, Field


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    stock: int = Field(ge=0)


class ItemOut(BaseModel):
    id: int
    name: str
    stock: int

    model_config = {"from_attributes": True}
