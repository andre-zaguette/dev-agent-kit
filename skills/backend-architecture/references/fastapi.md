---
name: fastapi
description: Baseline conventions for FastAPI services: routers, Pydantic schemas, dependencies, sessions and error handling.
status: baseline
---

## Princípio

Keep routers thin: validate with Pydantic schemas, get collaborators through dependencies, put domain logic in services, and turn domain errors into one consistent HTTP error shape.

## Quando aplicar

Projects that list `fastapi` as a dependency.

## Quando não aplicar

Other Python web frameworks. Do not add SQLAlchemy, Alembic or Pydantic settings if the project does not already use them.

## Exemplo

```python
from fastapi import APIRouter, Depends, HTTPException, status

router = APIRouter(prefix="/items", tags=["items"])


@router.post("/{item_id}/reserve", response_model=ReservationOut, status_code=status.HTTP_201_CREATED)
def reserve(item_id: int, body: ReserveIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return reservations.reserve(db, user=user, item_id=item_id, quantity=body.quantity)
    except reservations.OutOfStock:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "OUT_OF_STOCK"})
```

Use `response_model` so responses are filtered and documented, dependencies for authentication and database sessions, and explicit status codes. Commit or roll back the session in one place. FastAPI generates the OpenAPI description; keep schemas accurate instead of maintaining a second document.

## Fonte

FastAPI documentation (dependencies, response models, error handling); refined per project conventions.
