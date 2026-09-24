import pytest
from pydantic import ValidationError

from app.schemas import ItemCreate


def test_item_create_rejects_negative_stock():
    with pytest.raises(ValidationError):
        ItemCreate(name="x", stock=-1)
