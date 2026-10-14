---
name: fastapi
description: FastAPI guide: routers per feature, Annotated dependencies, lifespan, Pydantic v2 schemas, session per request, error handling and testing with dependency_overrides.
status: guide
---

Targets: FastAPI 0.x (docs at 0.143), Pydantic v2, Python 3.10+ (the Python level of the docs' `Annotated` examples).

## Princípio

Keep routers thin: validate with Pydantic schemas, get collaborators through `Annotated[..., Depends(...)]` dependencies, put domain logic in services, and turn domain errors into one consistent HTTP error shape. Declare input and output schemas separately so a response can never leak a field the client did not need.

## Quando aplicar

Projects that list `fastapi` as a dependency. Match the project's own Python level and Pydantic major: do not assume Pydantic v2 until you have seen it in the dependency file.

## Quando não aplicar

Other Python web frameworks. Do not add SQLAlchemy, Alembic, pydantic-settings or a service layer if the project does not already use them; follow what is there.

## Exemplo

```python
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy.orm import Session

router = APIRouter(prefix="/items", tags=["items"])


class ReserveIn(BaseModel):
    quantity: int

    @field_validator("quantity")
    @classmethod
    def positive(cls, value: int) -> int:
        if value < 1:
            raise ValueError("quantity must be at least 1")
        return value


class ReservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    quantity: int


SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.post("/{item_id}/reserve", response_model=ReservationOut, status_code=status.HTTP_201_CREATED)
def reserve(item_id: int, body: ReserveIn, user: UserDep, db: SessionDep):
    try:
        return reservations.reserve(db, user=user, item_id=item_id, quantity=body.quantity)
    except reservations.OutOfStock:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "OUT_OF_STOCK"})
```

`response_model` filters and documents the response, so the function may return an ORM object (`from_attributes=True` lets Pydantic read its attributes). `get_session`, `get_current_user`, `reservations` and `User` come from the project's own modules. FastAPI generates the OpenAPI description from these declarations; keep schemas accurate instead of maintaining a second document. The `detail` body in the example is FastAPI's default error shape; a registered domain-error handler (see "Erros e validação") would replace it with the project's uniform body.

## Estrutura do projeto

The "Bigger Applications" page splits the app into a package with one `APIRouter` module per feature, shared dependencies in `dependencies.py` and an entry module that assembles them:

```text
app/
  main.py           # FastAPI(lifespan=...), include_router(...)
  dependencies.py   # shared Annotated dependencies
  routers/          # items.py, users.py: one APIRouter each
  schemas/          # Pydantic models, input and output separate
  services/         # domain logic, no FastAPI imports
```

Give each router `prefix` (no trailing `/`), `tags` and, when every route needs it, `dependencies=[Depends(...)]`; import the submodules (`from .routers import items, users`) and call `app.include_router(items.router)` for each. `include_router` also accepts `prefix`, `tags` and `dependencies`, which configures a shared router without editing it. Router dependencies run first, then decorator dependencies, then parameter dependencies.

Run startup and shutdown work through the `lifespan` context manager, not the deprecated event decorators; if `lifespan` is passed, the startup and shutdown handlers are no longer called:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI


resources = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    resources["model"] = load_model()  # startup: load shared resources
    yield
    resources.clear()                  # shutdown: release them


app = FastAPI(lifespan=lifespan)
```

## Dados e estado

- One session per request, from a dependency with `yield`. Code after `yield` runs after the response, so it is for closing, not for committing work the client was told succeeded.

```python
def get_session():
    with Session(engine) as session:
        yield session
```

- Commit or roll back in one place (the service function that owns the transaction), not scattered across routers.
- Use SQLAlchemy 2.0 style (`select()`, `session.execute`) only if the project already uses SQLAlchemy; the FastAPI docs' own database tutorial uses SQLModel. Follow the project's ORM.
- Separate models for create, update and public output (the docs' `HeroCreate`, `HeroUpdate`, `HeroPublic`): the table model is never the response. For updates, all fields optional.
- Settings: use pydantic-settings only if present. The documented pattern is a `BaseSettings` subclass with `model_config = SettingsConfigDict(env_file=".env")` read through a `@lru_cache` dependency (`get_settings`), so it is built once and can be overridden in tests.
- `BackgroundTasks` suits small work that shares the app's memory (an email notification). Heavy or must-not-be-lost work belongs in a job queue such as Celery, in other processes.

## Erros e validação

- Raise `HTTPException(status_code=..., detail=...)` for expected failures; register handlers with `@app.exception_handler(DomainError)` that return a `JSONResponse`, so every domain error becomes one body shape, for example `{"code": "OUT_OF_STOCK", "message": "..."}`.
- Request validation failures are `RequestValidationError`; override its handler if the project's error body must be uniform. Format `exc.errors()` item by item rather than `str(exc)`.
- Field rules go in Pydantic: `@field_validator("field")` stacked above `@classmethod`, returning the value. Read ORM objects with `Model.model_validate(obj)` and `from_attributes=True`.
- A dependency with `yield` that catches an exception must re-raise it (or raise `HTTPException`); swallowing it yields a 500 with no logs.
- `response_model` takes priority over the return annotation, so a function can return a richer type than it exposes. `response_model_exclude_unset=True` omits fields the client never set.

## Testes

`TestClient` is synchronous: tests are plain `def` and use no `await` (install `httpx` and `pytest`). Swap collaborators with `app.dependency_overrides`, a dict keyed by the original dependency function:

```python
from fastapi.testclient import TestClient

from app.main import app
from app.dependencies import get_current_user, get_session

client = TestClient(app)


def test_reserve_requires_stock(db_session, fake_user):
    app.dependency_overrides[get_session] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: fake_user
    try:
        response = client.post("/items/1/reserve", json={"quantity": 99})
        assert response.status_code == 409
    finally:
        app.dependency_overrides = {}
```

Override the session to point at a test database (a per-test transaction rolled back, or a throwaway database) and the auth dependency to skip real tokens. For async tests use `httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test")` with `@pytest.mark.anyio`; it does not run lifespan events, so wrap the app in `LifespanManager` from `asgi-lifespan` when the test needs them.

## Armadilhas

- Blocking I/O inside `async def` blocks the event loop. Use `async def` only with awaitable libraries; plain `def` endpoints and dependencies run in a threadpool. If unsure, use `def`.
- Returning an ORM object without `response_model` (or `from_attributes=True`) leaks columns or fails to serialize.
- In plain helper functions, mutable default arguments (`def f(tags: list = [])`) are shared across calls; default to `None` and build the list inside. Pydantic fields and endpoint parameter defaults are copied, so this does not apply to them.
- N+1 queries: loading related rows per item inside a loop; load them in the query.
- Forgetting `status_code` on creation routes (the default is 200).
- CORS: with `allow_credentials=True`, `allow_origins`, `allow_methods` and `allow_headers` cannot be `["*"]`; list them.
- `BackgroundTasks` are not durable jobs: they die with the process.
- Mixing `lifespan` and the deprecated startup/shutdown event decorators: only one of them runs.

## Fonte

FastAPI documentation: https://fastapi.tiangolo.com/tutorial/bigger-applications/, /tutorial/dependencies/, /tutorial/dependencies/dependencies-with-yield/, /advanced/events/ (lifespan), /tutorial/response-model/, /tutorial/handling-errors/, /tutorial/sql-databases/, /advanced/settings/, /tutorial/background-tasks/, /tutorial/cors/, /async/, /tutorial/testing/, /advanced/testing-dependencies/, /advanced/async-tests/. Pydantic documentation (validators and models, `field_validator`, `from_attributes`).
