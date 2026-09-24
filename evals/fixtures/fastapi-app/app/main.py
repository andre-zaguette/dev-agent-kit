from fastapi import FastAPI

from app.routers import items

app = FastAPI(title="inventory")
app.include_router(items.router)
