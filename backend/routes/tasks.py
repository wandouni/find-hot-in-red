import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Task
from schemas import TaskOut, TaskCreate, TaskUpdate

router = APIRouter()


@router.get("/api/tasks")
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.query(Task).order_by(Task.created_at.desc()).all()
    return [TaskOut.model_validate(t) for t in tasks]


@router.post("/api/tasks", status_code=201)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)):
    task = Task(
        keywords=json.dumps(payload.keywords, ensure_ascii=False),
        status="running",
        total=payload.total,
        done=0,
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
