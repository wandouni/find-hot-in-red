from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from database import get_db
from models import Note, Comment
from schemas import NoteOut, NoteDetail, CommentOut

router = APIRouter()


@router.get("/api/notes")
def list_notes(
    keyword: Optional[str] = Query(None),
    sort: Literal["likes", "collects", "date"] = Query("date"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(Note)
    if keyword:
        q = q.filter(Note.keyword == keyword)

    sort_col = {
        "likes": desc(Note.likes),
        "collects": desc(Note.collects),
        "date": desc(Note.crawl_time),
    }[sort]
    q = q.order_by(sort_col)

    total = q.count()
    notes = q.offset(offset).limit(limit).all()
    return {"total": total, "items": [NoteOut.model_validate(n) for n in notes]}


@router.get("/api/notes/{note_id}")
def get_note(note_id: str, db: Session = Depends(get_db)):
    note = db.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    comments = (
        db.query(Comment)
        .filter(Comment.note_id == note_id)
        .order_by(Comment.rank)
        .all()
    )
    result = NoteDetail.model_validate(note)
    result.comments = [CommentOut.model_validate(c) for c in comments]
    return result
