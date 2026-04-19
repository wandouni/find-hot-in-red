import json
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from database import get_db
from models import Task, Note, Comment
from schemas import TaskOut, TaskCreate, TaskUpdate

router = APIRouter()


@router.get("/api/tasks")
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.query(Task).order_by(Task.created_at.desc()).all()
    return [TaskOut.model_validate(t) for t in tasks]


@router.get("/api/tasks/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskOut.model_validate(task)


@router.post("/api/tasks", status_code=201)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)):
    task = Task(
        keywords=json.dumps(payload.keywords, ensure_ascii=False),
        status="running",
        total=payload.total,
        done=0,
        date_filter=payload.date_filter,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"id": task.id}


@router.patch("/api/tasks/{task_id}")
def update_task(task_id: int, payload: TaskUpdate, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if payload.status is not None:
        task.status = payload.status
    if payload.done is not None:
        task.done = payload.done
    if payload.total is not None:
        task.total = payload.total
    db.commit()
    return {"ok": True}


def _cascade_delete_task(task_id: int, db: Session):
    """Delete a task and all its notes + comments."""
    note_ids = [row[0] for row in db.query(Note.id).filter(Note.task_id == task_id).all()]
    if note_ids:
        db.query(Comment).filter(Comment.note_id.in_(note_ids)).delete(synchronize_session=False)
        db.query(Note).filter(Note.task_id == task_id).delete(synchronize_session=False)
    db.query(Task).filter(Task.id == task_id).delete(synchronize_session=False)


@router.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    _cascade_delete_task(task_id, db)
    db.commit()
    return {"ok": True}


@router.delete("/api/tasks")
def delete_tasks_bulk(ids: list[int] = Body(...), db: Session = Depends(get_db)):
    for task_id in ids:
        _cascade_delete_task(task_id, db)
    db.commit()
    return {"ok": True, "deleted": len(ids)}
