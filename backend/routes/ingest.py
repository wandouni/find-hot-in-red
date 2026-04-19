from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import Note, Comment, Task
from schemas import IngestRequest

router = APIRouter()


@router.post("/api/notes")
def ingest_notes(payload: IngestRequest, db: Session = Depends(get_db)):
    inserted = 0
    updated = 0

    for note_in in payload.notes:
        existing = db.get(Note, note_in.id)
        note_data = note_in.model_dump(exclude={"comments"})
        # Attach to scheme
        if payload.task_id:
            note_data["task_id"] = payload.task_id

        if existing:
            for k, v in note_data.items():
                if v is not None:
                    setattr(existing, k, v)
            updated += 1
        else:
            db.add(Note(**note_data))
            inserted += 1

        # Upsert comments
        for c in note_in.comments:
            existing_c = db.get(Comment, c.id)
            if existing_c:
                for k, v in c.model_dump().items():
                    if v is not None:
                        setattr(existing_c, k, v)
            else:
                db.add(Comment(**c.model_dump()))

    # Update task progress if task_id provided
    if payload.task_id:
        task = db.get(Task, payload.task_id)
        if task:
            task.done = (task.done or 0) + inserted + updated

    db.commit()
    return {"inserted": inserted, "updated": updated}
