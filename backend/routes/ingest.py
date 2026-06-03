import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from database import get_db
from models import Note, Comment, Task
from schemas import IngestRequest

router = APIRouter()
log = logging.getLogger("xhs.ingest")


@router.post("/api/notes")
def ingest_notes(payload: IngestRequest, db: Session = Depends(get_db)):
    inserted = 0
    updated = 0

    # Deduplicate within the batch (same id appearing multiple times)
    seen_notes: set[str] = set()
    seen_comments: set[str] = set()

    try:
        for note_in in payload.notes:
            if not note_in.id:
                log.warning("Skipping note with empty id")
                continue

            note_data = note_in.model_dump(exclude={"comments"})
            if payload.task_id:
                note_data["task_id"] = payload.task_id

            if note_in.id in seen_notes:
                # Duplicate within batch — just update what we already have in DB
                existing = db.get(Note, note_in.id)
                if existing:
                    for k, v in note_data.items():
                        if v is not None:
                            setattr(existing, k, v)
            else:
                existing = db.get(Note, note_in.id)
                if existing:
                    for k, v in note_data.items():
                        if v is not None:
                            setattr(existing, k, v)
                    updated += 1
                else:
                    db.add(Note(**note_data))
                    db.flush()  # flush so db.get() finds it in identity map later
                    inserted += 1
                seen_notes.add(note_in.id)

            # Upsert comments — skip dupes within batch
            for c in note_in.comments:
                if not c.id or c.id in seen_comments:
                    continue
                existing_c = db.get(Comment, c.id)
                if existing_c:
                    for k, v in c.model_dump().items():
                        if v is not None:
                            setattr(existing_c, k, v)
                else:
                    db.add(Comment(**c.model_dump()))
                    db.flush()
                seen_comments.add(c.id)

        # Update task progress if task_id provided
        if payload.task_id:
            task = db.get(Task, payload.task_id)
            if task:
                task.done = (task.done or 0) + inserted + updated

        db.commit()

    except IntegrityError as e:
        db.rollback()
        log.error(f"IntegrityError in ingest: {e}", exc_info=True)
        raise HTTPException(status_code=409, detail=f"DB constraint violation: {e.orig}")
    except Exception as e:
        db.rollback()
        log.error(f"Unexpected error in ingest: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    return {"inserted": inserted, "updated": updated}
