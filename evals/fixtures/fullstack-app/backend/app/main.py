from fastapi import FastAPI

from app.routers import users

app = FastAPI(title="directory")
app.include_router(users.router)
