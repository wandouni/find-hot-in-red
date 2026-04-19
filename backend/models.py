from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
from database import Base


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    keywords = Column(Text, nullable=True)   # JSON array string
    status = Column(String, default="pending")  # pending/running/done/failed
    total = Column(Integer, default=0)
    done = Column(Integer, default=0)
    date_filter = Column(Integer, default=0)  # 0=不限, 1=1天, 2=2天, 7=1周
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Note(Base):
    __tablename__ = "notes"

    id = Column(String, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    keyword = Column(String, nullable=True)
    title = Column(Text, nullable=True)
    content = Column(Text, nullable=True)
    author = Column(String, nullable=True)
    author_id = Column(String, nullable=True)
    likes = Column(Integer, default=0)
    collects = Column(Integer, default=0)
    publish_date = Column(String, nullable=True)
    url = Column(String, nullable=True)
    source = Column(String, default="dom")
    crawl_time = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Comment(Base):
    __tablename__ = "comments"

    id = Column(String, primary_key=True)
    note_id = Column(String, ForeignKey("notes.id"), nullable=False)
    content = Column(Text, nullable=True)
    likes = Column(Integer, default=0)
    rank = Column(Integer, nullable=True)
