from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import Base, engine
from routes.ingest import router as ingest_router
from routes.notes import router as notes_router
from routes.tasks import router as tasks_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="XHS Insight API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "chrome-extension://*"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.include_router(ingest_router)
app.include_router(notes_router)
app.include_router(tasks_router)
