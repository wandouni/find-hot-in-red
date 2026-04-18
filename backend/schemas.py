from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class CommentIn(BaseModel):
    id: str
    note_id: str
    content: Optional[str] = None
    likes: int = 0
    rank: Optional[int] = None


class NoteIn(BaseModel):
    id: str
    keyword: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    author: Optional[str] = None
    author_id: Optional[str] = None
    likes: int = 0
    collects: int = 0
    publish_date: Optional[str] = None
    url: Optional[str] = None
    source: str = "dom"
    comments: list[CommentIn] = []


class IngestRequest(BaseModel):
    notes: list[NoteIn]
    task_id: Optional[int] = None


class CommentOut(BaseModel):
    id: str
    note_id: str
    content: Optional[str]
    likes: int
    rank: Optional[int]

    model_config = {"from_attributes": True}


class NoteOut(BaseModel):
    id: str
    keyword: Optional[str]
    title: Optional[str]
    author: Optional[str]
    author_id: Optional[str]
    likes: int
    collects: int
    publish_date: Optional[str]
    url: Optional[str]
    source: str
    crawl_time: datetime

    model_config = {"from_attributes": True}


class NoteDetail(NoteOut):
    content: Optional[str]
    comments: list[CommentOut] = []


class TaskOut(BaseModel):
    id: int
    keywords: Optional[str]
    status: str
    total: int
    done: int
    created_at: datetime

    model_config = {"from_attributes": True}
