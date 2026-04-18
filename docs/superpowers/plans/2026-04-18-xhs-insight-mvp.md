# XHS Insight MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that scrapes Xiaohongshu notes and pushes them to a local FastAPI backend with SQLite storage, viewable via a Next.js dashboard.

**Architecture:** Chrome extension collects note data via DOM scraping and POSTs to FastAPI at localhost:8000. FastAPI stores data in SQLite via SQLAlchemy. Next.js frontend reads from FastAPI and renders a filterable dashboard and detail pages.

**Tech Stack:** Python 3.10+ / FastAPI / SQLAlchemy / SQLite / pytest / httpx — Chrome Extension (Manifest V3) — Next.js 14 App Router / Tailwind CSS / TypeScript

---

## File Map

```
find-hot-in-red/
├── config.yaml
├── setup.sh
├── start.sh
│
├── backend/
│   ├── requirements.txt
│   ├── main.py               # FastAPI app, CORS, router mount
│   ├── config.py             # load config.yaml → Settings dataclass
│   ├── database.py           # SQLAlchemy engine, SessionLocal, Base, get_db
│   ├── models.py             # Note, Comment, Task ORM models
│   ├── schemas.py            # Pydantic request/response schemas
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── ingest.py         # POST /api/notes
│   │   ├── notes.py          # GET /api/notes, GET /api/notes/{id}
│   │   └── tasks.py          # GET /api/tasks
│   └── tests/
│       ├── conftest.py       # in-memory SQLite test DB + TestClient
│       ├── test_ingest.py
│       └── test_notes.py
│
├── extension/
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── background.js
│   ├── content.js
│   └── config.js             # hardcoded constants (delay ranges, limits)
│
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── next.config.ts
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx           # dashboard: filterable note list
    │   └── notes/
    │       └── [id]/
    │           └── page.tsx   # note detail + comments
    └── lib/
        └── api.ts             # typed fetch wrappers for backend
```

---

## Task 1: Project scaffold & config

**Files:**
- Create: `config.yaml`
- Create: `setup.sh`
- Create: `start.sh`
- Create: `backend/requirements.txt`
- Create: `.gitignore`

- [ ] **Step 1: Create config.yaml**

```yaml
# XHS Insight 配置文件 — 只需修改此文件
llm:
  provider: 'openai'        # openai / anthropic / zhipu / qwen
  api_key: 'sk-xxxxx'       # 填入你的 API Key
  api_base: ''              # 非官方地址时填写，如 https://api.xxx.com/v1
  model: 'gpt-4o'
  vision_model: 'gpt-4o'

crawler:
  max_notes_per_keyword: 30
  top_comments: 10
  delay_min_ms: 1500
  delay_max_ms: 4000

server:
  backend_port: 8000
  frontend_port: 3000
```

Save to: `config.yaml`

- [ ] **Step 2: Create backend/requirements.txt**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
sqlalchemy==2.0.35
pydantic==2.9.2
pydantic-settings==2.5.2
PyYAML==6.0.2
httpx==0.27.2
pytest==8.3.3
pytest-asyncio==0.24.0
```

- [ ] **Step 3: Create .gitignore**

```
data/
__pycache__/
*.pyc
.env
node_modules/
.next/
frontend/.next/
*.db
```

- [ ] **Step 4: Create setup.sh**

```bash
#!/bin/bash
set -e

echo "=== XHS Insight Setup ==="

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "ERROR: Python 3 not found. Install from https://python.org"
  exit 1
fi
PY_VER=$(python3 -c "import sys; print(sys.version_info.minor)")
if [ "$PY_VER" -lt 10 ]; then
  echo "ERROR: Python 3.10+ required"
  exit 1
fi
echo "✓ Python $(python3 --version)"

# Check Node
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo "✓ Node $(node --version)"

# Backend deps
echo "Installing backend dependencies..."
cd backend
python3 -m pip install -r requirements.txt -q
cd ..

# Frontend deps
echo "Installing frontend dependencies..."
cd frontend
npm install -q
cd ..

# Create data dir
mkdir -p data

echo ""
echo "✓ Setup complete! Run ./start.sh to launch."
```

- [ ] **Step 5: Create start.sh**

```bash
#!/bin/bash
set -e

echo "=== Starting XHS Insight ==="

# Start backend
echo "Starting backend (port 8000)..."
cd backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

# Wait for backend
sleep 2

# Start frontend
echo "Starting frontend (port 3000)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✓ Backend: http://localhost:8000"
echo "✓ Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"

# Open browser
sleep 3
open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true

# Wait
wait $FRONTEND_PID
```

- [ ] **Step 6: Make scripts executable**

```bash
chmod +x setup.sh start.sh
```

- [ ] **Step 7: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add config.yaml setup.sh start.sh backend/requirements.txt .gitignore
git commit -m "feat: project scaffold, config.yaml, setup/start scripts"
```

---

## Task 2: Backend — database & models

**Files:**
- Create: `backend/config.py`
- Create: `backend/database.py`
- Create: `backend/models.py`
- Create: `backend/schemas.py`

- [ ] **Step 1: Create backend/config.py**

```python
import yaml
from dataclasses import dataclass, field
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


@dataclass
class LLMConfig:
    provider: str = "openai"
    api_key: str = ""
    api_base: str = ""
    model: str = "gpt-4o"
    vision_model: str = "gpt-4o"


@dataclass
class CrawlerConfig:
    max_notes_per_keyword: int = 30
    top_comments: int = 10
    delay_min_ms: int = 1500
    delay_max_ms: int = 4000


@dataclass
class ServerConfig:
    backend_port: int = 8000
    frontend_port: int = 3000


@dataclass
class Settings:
    llm: LLMConfig = field(default_factory=LLMConfig)
    crawler: CrawlerConfig = field(default_factory=CrawlerConfig)
    server: ServerConfig = field(default_factory=ServerConfig)


def load_settings() -> Settings:
    if not CONFIG_PATH.exists():
        return Settings()
    with open(CONFIG_PATH) as f:
        raw = yaml.safe_load(f) or {}
    return Settings(
        llm=LLMConfig(**raw.get("llm", {})),
        crawler=CrawlerConfig(**raw.get("crawler", {})),
        server=ServerConfig(**raw.get("server", {})),
    )


settings = load_settings()
```

- [ ] **Step 2: Create backend/database.py**

```python
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DB_PATH = Path(__file__).parent.parent / "data" / "xhs_data.db"
DB_PATH.parent.mkdir(exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 3: Create backend/models.py**

```python
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
from database import Base


class Note(Base):
    __tablename__ = "notes"

    id = Column(String, primary_key=True)
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
    crawl_time = Column(DateTime, default=datetime.utcnow)


class Comment(Base):
    __tablename__ = "comments"

    id = Column(String, primary_key=True)
    note_id = Column(String, ForeignKey("notes.id"), nullable=False)
    content = Column(Text, nullable=True)
    likes = Column(Integer, default=0)
    rank = Column(Integer, nullable=True)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    keywords = Column(Text, nullable=True)   # JSON array string
    status = Column(String, default="pending")  # pending/running/done/failed
    total = Column(Integer, default=0)
    done = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 4: Create backend/schemas.py**

```python
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
```

- [ ] **Step 5: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add backend/config.py backend/database.py backend/models.py backend/schemas.py
git commit -m "feat: backend database models and config loader"
```

---

## Task 3: Backend — ingest route + tests

**Files:**
- Create: `backend/routes/__init__.py`
- Create: `backend/routes/ingest.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_ingest.py`

- [ ] **Step 1: Create backend/routes/__init__.py**

```python
```

(empty file)

- [ ] **Step 2: Write failing tests first**

Create `backend/tests/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Use in-memory SQLite for tests
TEST_DB_URL = "sqlite://"


@pytest.fixture(scope="function")
def client():
    from database import Base, get_db
    import main

    engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[get_db] = override_get_db

    with TestClient(main.app) as c:
        yield c

    Base.metadata.drop_all(bind=engine)
    main.app.dependency_overrides.clear()
```

Create `backend/tests/test_ingest.py`:

```python
def test_ingest_single_note(client):
    payload = {
        "notes": [{
            "id": "note_001",
            "keyword": "职场副业",
            "title": "我靠副业月入2万",
            "content": "分享我的经历...",
            "author": "小明",
            "author_id": "user_123",
            "likes": 1500,
            "collects": 800,
            "publish_date": "2024-01-15",
            "url": "https://www.xiaohongshu.com/explore/note_001",
            "source": "dom",
            "comments": [
                {"id": "c_001", "note_id": "note_001", "content": "太厉害了", "likes": 50, "rank": 1},
                {"id": "c_002", "note_id": "note_001", "content": "怎么做到的", "likes": 30, "rank": 2},
            ]
        }]
    }
    resp = client.post("/api/notes", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["inserted"] == 1
    assert data["updated"] == 0


def test_ingest_upsert_duplicate(client):
    payload = {
        "notes": [{
            "id": "note_001",
            "keyword": "职场副业",
            "title": "标题",
            "content": "内容",
            "author": "作者",
            "author_id": "user_1",
            "likes": 100,
            "collects": 50,
            "comments": []
        }]
    }
    client.post("/api/notes", json=payload)
    # Second POST same id — should upsert (update), not fail
    payload["notes"][0]["likes"] = 200
    resp = client.post("/api/notes", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated"] == 1
    assert data["inserted"] == 0


def test_ingest_multiple_notes(client):
    notes = [
        {"id": f"note_{i}", "keyword": "测试", "title": f"标题{i}", "content": f"内容{i}",
         "author": "作者", "author_id": f"u_{i}", "likes": i * 10, "collects": i * 5, "comments": []}
        for i in range(5)
    ]
    resp = client.post("/api/notes", json={"notes": notes})
    assert resp.status_code == 200
    assert resp.json()["inserted"] == 5
```

- [ ] **Step 3: Run tests — expect failure (route not yet implemented)**

```bash
cd /Users/shenni/repository/find-hot-in-red/backend
python3 -m pytest tests/test_ingest.py -v 2>&1 | head -30
```

Expected: errors about missing `main` module or missing route.

- [ ] **Step 4: Create backend/routes/ingest.py**

```python
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

        if existing:
            for k, v in note_data.items():
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
```

- [ ] **Step 5: Create backend/main.py (minimal, just for tests)**

```python
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
```

Note: `routes/notes.py` and `routes/tasks.py` need to exist (create stubs now):

Create `backend/routes/notes.py` stub:
```python
from fastapi import APIRouter
router = APIRouter()
```

Create `backend/routes/tasks.py` stub:
```python
from fastapi import APIRouter
router = APIRouter()
```

- [ ] **Step 6: Run tests — expect pass**

```bash
cd /Users/shenni/repository/find-hot-in-red/backend
python3 -m pytest tests/test_ingest.py -v
```

Expected output:
```
PASSED tests/test_ingest.py::test_ingest_single_note
PASSED tests/test_ingest.py::test_ingest_upsert_duplicate
PASSED tests/test_ingest.py::test_ingest_multiple_notes
3 passed
```

- [ ] **Step 7: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add backend/routes/ backend/main.py backend/tests/
git commit -m "feat: ingest route POST /api/notes with upsert logic"
```

---

## Task 4: Backend — notes query route + tests

**Files:**
- Modify: `backend/routes/notes.py`
- Create: `backend/tests/test_notes.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_notes.py`:

```python
def _seed(client, n=3):
    notes = [
        {
            "id": f"note_{i}",
            "keyword": "副业" if i % 2 == 0 else "职场",
            "title": f"标题{i}",
            "content": f"正文内容{i}，详细描述...",
            "author": f"作者{i}",
            "author_id": f"u_{i}",
            "likes": (i + 1) * 100,
            "collects": (i + 1) * 50,
            "publish_date": f"2024-0{i+1}-01",
            "url": f"https://www.xiaohongshu.com/explore/note_{i}",
            "source": "dom",
            "comments": [
                {"id": f"c_{i}_1", "note_id": f"note_{i}", "content": "好棒", "likes": 10, "rank": 1}
            ]
        }
        for i in range(n)
    ]
    client.post("/api/notes", json={"notes": notes})


def test_list_notes_default(client):
    _seed(client)
    resp = client.get("/api/notes")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 3
    assert data["total"] == 3


def test_list_notes_filter_by_keyword(client):
    _seed(client, 4)
    resp = client.get("/api/notes?keyword=副业")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(n["keyword"] == "副业" for n in items)


def test_list_notes_sort_by_likes(client):
    _seed(client, 3)
    resp = client.get("/api/notes?sort=likes")
    items = resp.json()["items"]
    likes = [n["likes"] for n in items]
    assert likes == sorted(likes, reverse=True)


def test_list_notes_pagination(client):
    _seed(client, 5)
    resp = client.get("/api/notes?limit=2&offset=0")
    assert len(resp.json()["items"]) == 2
    resp2 = client.get("/api/notes?limit=2&offset=2")
    assert len(resp2.json()["items"]) == 2


def test_get_note_detail(client):
    _seed(client, 1)
    resp = client.get("/api/notes/note_0")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "note_0"
    assert data["content"] == "正文内容0，详细描述..."
    assert len(data["comments"]) == 1
    assert data["comments"][0]["rank"] == 1


def test_get_note_not_found(client):
    resp = client.get("/api/notes/nonexistent")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /Users/shenni/repository/find-hot-in-red/backend
python3 -m pytest tests/test_notes.py -v 2>&1 | head -20
```

Expected: 404 errors or route-not-found failures.

- [ ] **Step 3: Implement backend/routes/notes.py**

```python
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /Users/shenni/repository/find-hot-in-red/backend
python3 -m pytest tests/ -v
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add backend/routes/notes.py backend/tests/test_notes.py
git commit -m "feat: GET /api/notes list+filter+sort+paginate, GET /api/notes/{id} detail"
```

---

## Task 5: Backend — tasks route + full server smoke test

**Files:**
- Modify: `backend/routes/tasks.py`

- [ ] **Step 1: Implement backend/routes/tasks.py**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import Task
from schemas import TaskOut

router = APIRouter()


@router.get("/api/tasks")
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.query(Task).order_by(Task.created_at.desc()).all()
    return [TaskOut.model_validate(t) for t in tasks]
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/shenni/repository/find-hot-in-red/backend
python3 -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 3: Smoke test — start server manually**

```bash
cd /Users/shenni/repository/find-hot-in-red/backend
python3 -m uvicorn main:app --port 8000
```

In another terminal:
```bash
curl http://localhost:8000/api/notes
# Expected: {"total":0,"items":[]}

curl http://localhost:8000/api/tasks
# Expected: []
```

Stop server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add backend/routes/tasks.py
git commit -m "feat: GET /api/tasks endpoint"
```

---

## Task 6: Chrome Extension — manifest + popup UI

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/config.js`
- Create: `extension/popup.html`
- Create: `extension/popup.js`

- [ ] **Step 1: Create extension/manifest.json**

```json
{
  "manifest_version": 3,
  "name": "XHS Insight Collector",
  "version": "1.0.0",
  "description": "采集小红书笔记数据到本地数据库",
  "permissions": ["tabs", "scripting", "storage", "notifications", "activeTab"],
  "host_permissions": [
    "https://www.xiaohongshu.com/*",
    "http://localhost:8000/*"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "XHS Insight"
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.xiaohongshu.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Create extension/config.js**

```javascript
// 与 config.yaml crawler 配置保持一致
const CONFIG = {
  BACKEND_URL: 'http://localhost:8000',
  DELAY_MIN_MS: 1500,
  DELAY_MAX_MS: 4000,
  MAX_NOTES_PER_KEYWORD: 30,
  TOP_COMMENTS: 10,
};
```

- [ ] **Step 3: Create extension/popup.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      width: 320px;
      padding: 16px;
      font-family: -apple-system, sans-serif;
      font-size: 14px;
      color: #333;
    }
    h2 { margin: 0 0 12px; font-size: 16px; color: #e0284a; }
    label { display: block; margin-bottom: 4px; font-weight: 500; }
    textarea {
      width: 100%;
      height: 80px;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 13px;
      resize: vertical;
      box-sizing: border-box;
    }
    .row { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
    input[type=number] {
      width: 60px;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 4px 6px;
      font-size: 13px;
    }
    button {
      width: 100%;
      padding: 8px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      margin-top: 8px;
    }
    #startBtn { background: #e0284a; color: white; }
    #startBtn:disabled { background: #ccc; cursor: not-allowed; }
    #stopBtn { background: #f5f5f5; color: #666; display: none; }
    #progress {
      margin-top: 10px;
      font-size: 12px;
      color: #666;
      min-height: 36px;
      background: #f9f9f9;
      border-radius: 6px;
      padding: 6px 8px;
      white-space: pre-line;
    }
  </style>
</head>
<body>
  <h2>XHS Insight 采集</h2>

  <label>关键词（每行一个）</label>
  <textarea id="keywords" placeholder="职场副业&#10;AI工具&#10;副业赚钱"></textarea>

  <div class="row">
    <label style="margin:0">每词抓取数量</label>
    <input type="number" id="maxNotes" value="20" min="1" max="50">
    <span style="color:#999">篇（最多50）</span>
  </div>

  <button id="startBtn">开始采集</button>
  <button id="stopBtn">停止</button>

  <div id="progress">等待开始...</div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create extension/popup.js**

```javascript
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressEl = document.getElementById('progress');
const keywordsEl = document.getElementById('keywords');
const maxNotesEl = document.getElementById('maxNotes');

// Load saved keywords
chrome.storage.local.get(['keywords', 'maxNotes'], (data) => {
  if (data.keywords) keywordsEl.value = data.keywords;
  if (data.maxNotes) maxNotesEl.value = data.maxNotes;
});

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS_UPDATE') {
    progressEl.textContent = msg.text;
  }
  if (msg.type === 'TASK_DONE') {
    progressEl.textContent = msg.text;
    setRunning(false);
  }
});

function setRunning(running) {
  startBtn.disabled = running;
  startBtn.style.display = running ? 'none' : 'block';
  stopBtn.style.display = running ? 'block' : 'none';
}

startBtn.addEventListener('click', () => {
  const raw = keywordsEl.value.trim();
  if (!raw) { progressEl.textContent = '请输入关键词'; return; }

  const keywords = raw.split('\n').map(k => k.trim()).filter(Boolean);
  const maxNotes = Math.min(parseInt(maxNotesEl.value) || 20, 50);

  chrome.storage.local.set({ keywords: raw, maxNotes });
  chrome.runtime.sendMessage({ type: 'START_TASK', keywords, maxNotes });
  setRunning(true);
  progressEl.textContent = '任务已启动，正在初始化...';
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_TASK' });
  setRunning(false);
  progressEl.textContent = '已停止';
});

// Check if task is already running on popup open
chrome.storage.local.get(['taskRunning'], (data) => {
  if (data.taskRunning) setRunning(true);
});
```

- [ ] **Step 5: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add extension/
git commit -m "feat: chrome extension manifest, config, popup UI"
```

---

## Task 7: Chrome Extension — content.js (DOM scraping)

**Files:**
- Create: `extension/content.js`

- [ ] **Step 1: Create extension/content.js**

```javascript
// Injected into xiaohongshu.com pages by manifest content_scripts
// Also called directly via chrome.scripting.executeScript from background.js

/**
 * Scrape the current note detail page.
 * Returns a note object or null if this page is not a note detail page.
 */
function scrapeCurrentNote(keyword) {
  // Note detail URL pattern: /explore/<note_id>
  const match = location.pathname.match(/\/explore\/([a-f0-9]+)/);
  if (!match) return null;

  const noteId = match[1];
  const url = location.href;

  // Title
  const titleEl = document.querySelector('#detail-title') ||
                  document.querySelector('.note-content .title') ||
                  document.querySelector('h1');
  const title = titleEl?.textContent?.trim() || '';

  // Content / body
  const contentEl = document.querySelector('#detail-desc') ||
                    document.querySelector('.note-content .desc') ||
                    document.querySelector('.content');
  const content = contentEl?.textContent?.trim() || '';

  // Author
  const authorEl = document.querySelector('.author-wrapper .name') ||
                   document.querySelector('.username');
  const author = authorEl?.textContent?.trim() || '';

  const authorLinkEl = document.querySelector('.author-wrapper a') ||
                       document.querySelector('a.author');
  const authorHref = authorLinkEl?.href || '';
  const authorIdMatch = authorHref.match(/\/user\/profile\/([a-f0-9]+)/);
  const authorId = authorIdMatch ? authorIdMatch[1] : '';

  // Engagement counts
  function parseCount(el) {
    if (!el) return 0;
    const text = el.textContent?.trim().replace(/[,，]/g, '') || '0';
    if (text.endsWith('万')) return Math.round(parseFloat(text) * 10000);
    return parseInt(text) || 0;
  }

  const likeEl = document.querySelector('.like-wrapper .count') ||
                 document.querySelector('[class*="like"] span');
  const collectEl = document.querySelector('.collect-wrapper .count') ||
                    document.querySelector('[class*="collect"] span');
  const likes = parseCount(likeEl);
  const collects = parseCount(collectEl);

  // Publish date
  const dateEl = document.querySelector('.date') ||
                 document.querySelector('time') ||
                 document.querySelector('[class*="date"]');
  const publishDate = dateEl?.textContent?.trim() || '';

  // Comments (top N by rank in DOM)
  const commentEls = document.querySelectorAll('.comment-item, .comments-el');
  const comments = [];
  commentEls.forEach((el, idx) => {
    if (idx >= 10) return;
    const commentContentEl = el.querySelector('.content, .comment-content');
    const commentLikeEl = el.querySelector('.like-count, [class*="like"]');
    const commentContent = commentContentEl?.textContent?.trim() || '';
    const commentLikes = parseCount(commentLikeEl);
    const commentId = `${noteId}_c_${idx + 1}`;
    comments.push({
      id: commentId,
      note_id: noteId,
      content: commentContent,
      likes: commentLikes,
      rank: idx + 1,
    });
  });

  return {
    id: noteId,
    keyword: keyword || '',
    title,
    content,
    author,
    author_id: authorId,
    likes,
    collects,
    publish_date: publishDate,
    url,
    source: 'dom',
    comments,
  };
}

// Listen for messages from background.js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SCRAPE_NOTE') {
    const note = scrapeCurrentNote(msg.keyword);
    sendResponse({ note });
  }
  return true; // keep channel open for async
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add extension/content.js
git commit -m "feat: content.js DOM scraper for xiaohongshu note pages"
```

---

## Task 8: Chrome Extension — background.js (task queue)

**Files:**
- Create: `extension/background.js`

- [ ] **Step 1: Create extension/background.js**

```javascript
// Service worker — handles task queue and tab orchestration
importScripts('config.js');

let stopRequested = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay() {
  const ms = CONFIG.DELAY_MIN_MS +
    Math.random() * (CONFIG.DELAY_MAX_MS - CONFIG.DELAY_MIN_MS);
  return sleep(ms);
}

function sendProgress(text) {
  chrome.runtime.sendMessage({ type: 'PROGRESS_UPDATE', text }).catch(() => {});
}

function sendDone(text) {
  chrome.storage.local.set({ taskRunning: false });
  chrome.runtime.sendMessage({ type: 'TASK_DONE', text }).catch(() => {});
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: 'XHS Insight',
    message: text,
  });
}

/**
 * Collect note links from a search results page.
 * Scrolls down to load more, collects up to maxNotes links.
 */
async function collectNoteLinks(tabId, keyword, maxNotes) {
  const links = new Set();
  let scrollAttempts = 0;
  const maxScrolls = Math.ceil(maxNotes / 5);  // ~5 notes per viewport

  while (links.size < maxNotes && scrollAttempts < maxScrolls) {
    if (stopRequested) break;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Collect visible note links
        const anchors = document.querySelectorAll('a[href*="/explore/"]');
        return Array.from(anchors)
          .map(a => a.href)
          .filter(href => /\/explore\/[a-f0-9]+/.test(href));
      },
    });

    const newLinks = results[0]?.result || [];
    newLinks.forEach(l => links.add(l));

    // Scroll down
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (amount) => window.scrollBy({ top: amount, behavior: 'smooth' }),
      args: [600],
    });

    scrollAttempts++;
    await randomDelay();
    sendProgress(`关键词「${keyword}」: 已找到 ${links.size} 篇笔记...`);
  }

  return Array.from(links).slice(0, maxNotes);
}

/**
 * Scrape a single note by navigating to its URL in the given tab.
 */
async function scrapeNote(tabId, url, keyword) {
  await chrome.tabs.update(tabId, { url });

  // Wait for page to load
  await new Promise(resolve => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });

  // Extra wait for dynamic content
  await sleep(2000);

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (kw) => {
      // Inline scrape (same logic as content.js scrapeCurrentNote)
      const match = location.pathname.match(/\/explore\/([a-f0-9]+)/);
      if (!match) return null;
      const noteId = match[1];

      function parseCount(el) {
        if (!el) return 0;
        const text = el?.textContent?.trim().replace(/[,，]/g, '') || '0';
        if (text.endsWith('万')) return Math.round(parseFloat(text) * 10000);
        return parseInt(text) || 0;
      }

      const title = (document.querySelector('#detail-title') ||
                     document.querySelector('.title'))?.textContent?.trim() || '';
      const content = (document.querySelector('#detail-desc') ||
                       document.querySelector('.desc'))?.textContent?.trim() || '';
      const author = document.querySelector('.name')?.textContent?.trim() || '';
      const authorHref = document.querySelector('.author-wrapper a')?.href || '';
      const authorIdMatch = authorHref.match(/\/user\/profile\/([a-f0-9]+)/);
      const authorId = authorIdMatch?.[1] || '';
      const likes = parseCount(document.querySelector('.like-wrapper .count'));
      const collects = parseCount(document.querySelector('.collect-wrapper .count'));
      const publishDate = document.querySelector('.date')?.textContent?.trim() || '';

      const commentEls = document.querySelectorAll('.comment-item');
      const comments = [];
      commentEls.forEach((el, idx) => {
        if (idx >= 10) return;
        const c = el.querySelector('.content')?.textContent?.trim() || '';
        const cl = parseCount(el.querySelector('.like-count'));
        comments.push({ id: `${noteId}_c_${idx+1}`, note_id: noteId, content: c, likes: cl, rank: idx+1 });
      });

      return { id: noteId, keyword: kw, title, content, author, author_id: authorId,
               likes, collects, publish_date: publishDate, url: location.href, source: 'dom', comments };
    },
    args: [keyword],
  });

  return results[0]?.result || null;
}

/**
 * POST a batch of notes to the backend.
 */
async function pushNotes(notes) {
  const resp = await fetch(`${CONFIG.BACKEND_URL}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
  if (!resp.ok) throw new Error(`Backend error: ${resp.status}`);
  return resp.json();
}

/**
 * Main task runner — processes all keywords sequentially.
 */
async function runTask(keywords, maxNotes) {
  stopRequested = false;
  chrome.storage.local.set({ taskRunning: true });

  // Open a working tab (we'll reuse it)
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const tabId = tab.id;

  let totalDone = 0;
  const totalTarget = keywords.length * maxNotes;

  try {
    for (const keyword of keywords) {
      if (stopRequested) break;

      sendProgress(`开始处理关键词「${keyword}」...`);

      // Navigate to search page
      const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`;
      await chrome.tabs.update(tabId, { url: searchUrl });
      await new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function l(id, info) {
          if (id === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(l);
            resolve();
          }
        });
      });
      await sleep(3000);

      // Collect links
      const links = await collectNoteLinks(tabId, keyword, maxNotes);
      sendProgress(`关键词「${keyword}」: 找到 ${links.length} 篇，开始抓取...`);

      const collected = [];
      for (let i = 0; i < links.length; i++) {
        if (stopRequested) break;
        sendProgress(`关键词「${keyword}」: ${i + 1}/${links.length} | 总进度 ${totalDone}/${totalTarget}`);

        try {
          const note = await scrapeNote(tabId, links[i], keyword);
          if (note) collected.push(note);
        } catch (e) {
          console.warn('Scrape failed, skipping:', links[i], e);
        }

        await randomDelay();
      }

      // Push collected notes to backend
      if (collected.length > 0) {
        try {
          await pushNotes(collected);
          totalDone += collected.length;
        } catch (e) {
          console.error('Backend push failed:', e);
        }
      }
    }
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
    sendDone(`采集完成！共采集 ${totalDone} 篇笔记`);
  }
}

// Message handler
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_TASK') {
    runTask(msg.keywords, msg.maxNotes);
  }
  if (msg.type === 'STOP_TASK') {
    stopRequested = true;
  }
});
```

- [ ] **Step 2: Manual test — load extension in Chrome**

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" → select `extension/` folder
4. Plugin icon should appear in toolbar
5. Click icon → popup should show keyword input form

- [ ] **Step 3: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add extension/background.js
git commit -m "feat: background.js task queue, tab orchestration, note scraping"
```

---

## Task 9: Next.js frontend setup + API layer

**Files:**
- Create: `frontend/` (Next.js project)
- Create: `frontend/lib/api.ts`
- Create: `frontend/app/layout.tsx`

- [ ] **Step 1: Scaffold Next.js 14 project**

```bash
cd /Users/shenni/repository/find-hot-in-red
npx create-next-app@14 frontend \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --no-eslint
```

When prompted, accept defaults.

- [ ] **Step 2: Create frontend/lib/api.ts**

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface Comment {
  id: string;
  note_id: string;
  content: string | null;
  likes: number;
  rank: number | null;
}

export interface Note {
  id: string;
  keyword: string | null;
  title: string | null;
  author: string | null;
  author_id: string | null;
  likes: number;
  collects: number;
  publish_date: string | null;
  url: string | null;
  source: string;
  crawl_time: string;
}

export interface NoteDetail extends Note {
  content: string | null;
  comments: Comment[];
}

export interface NotesResponse {
  total: number;
  items: Note[];
}

export interface Task {
  id: number;
  keywords: string | null;
  status: string;
  total: number;
  done: number;
  created_at: string;
}

export async function fetchNotes(params: {
  keyword?: string;
  sort?: 'likes' | 'collects' | 'date';
  limit?: number;
  offset?: number;
}): Promise<NotesResponse> {
  const query = new URLSearchParams();
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.sort) query.set('sort', params.sort);
  if (params.limit != null) query.set('limit', String(params.limit));
  if (params.offset != null) query.set('offset', String(params.offset));

  const res = await fetch(`${API_BASE}/api/notes?${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch notes: ${res.status}`);
  return res.json();
}

export async function fetchNote(id: string): Promise<NoteDetail> {
  const res = await fetch(`${API_BASE}/api/notes/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Note not found: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: Update frontend/app/layout.tsx**

```typescript
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'XHS Insight',
  description: '小红书热门内容分析',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-800 min-h-screen">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
          <span className="text-red-500 font-bold text-xl">XHS</span>
          <span className="text-gray-700 font-semibold">Insight</span>
          <span className="text-gray-400 text-sm ml-2">小红书热门内容分析</span>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify Next.js starts**

```bash
cd /Users/shenni/repository/find-hot-in-red/frontend
npm run dev
```

Open `http://localhost:3000` — should show default Next.js page. Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add frontend/
git commit -m "feat: Next.js 14 frontend scaffold with API layer"
```

---

## Task 10: Frontend — dashboard page

**Files:**
- Create: `frontend/app/page.tsx`
- Create: `frontend/app/components/NoteCard.tsx`
- Create: `frontend/app/components/FilterBar.tsx`

- [ ] **Step 1: Create frontend/app/components/NoteCard.tsx**

```typescript
import Link from 'next/link';
import type { Note } from '@/lib/api';

export function NoteCard({ note }: { note: Note }) {
  return (
    <Link href={`/notes/${note.id}`}>
      <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-red-200 transition-all cursor-pointer">
        <h3 className="font-semibold text-gray-900 line-clamp-2 mb-2 text-sm leading-snug">
          {note.title || '（无标题）'}
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
          <span className="bg-gray-100 rounded px-2 py-0.5">{note.author || '未知作者'}</span>
          {note.keyword && (
            <span className="bg-red-50 text-red-500 rounded px-2 py-0.5">#{note.keyword}</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>❤️ {note.likes.toLocaleString()}</span>
          <span>⭐ {note.collects.toLocaleString()}</span>
          <span className="ml-auto">{note.publish_date || ''}</span>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create frontend/app/components/FilterBar.tsx**

```typescript
'use client';

import { useRouter, useSearchParams } from 'next/navigation';

const SORT_OPTIONS = [
  { value: 'date', label: '最新' },
  { value: 'likes', label: '点赞最多' },
  { value: 'collects', label: '收藏最多' },
];

interface Props {
  keywords: string[];
  currentKeyword: string;
  currentSort: string;
}

export function FilterBar({ keywords, currentKeyword, currentSort }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete('offset');
    router.push(`/?${p.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <select
        value={currentKeyword}
        onChange={(e) => update('keyword', e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
      >
        <option value="">全部关键词</option>
        {keywords.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>

      <div className="flex gap-1">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => update('sort', opt.value)}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
              currentSort === opt.value
                ? 'bg-red-500 text-white border-red-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create frontend/app/page.tsx**

```typescript
import { Suspense } from 'react';
import { fetchNotes } from '@/lib/api';
import { NoteCard } from './components/NoteCard';
import { FilterBar } from './components/FilterBar';

const PAGE_SIZE = 20;

interface SearchParams {
  keyword?: string;
  sort?: string;
  offset?: string;
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const keyword = searchParams.keyword || '';
  const sort = (searchParams.sort as 'likes' | 'collects' | 'date') || 'date';
  const offset = parseInt(searchParams.offset || '0');

  let data;
  try {
    data = await fetchNotes({ keyword, sort, limit: PAGE_SIZE, offset });
  } catch {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg mb-2">无法连接到后端</p>
        <p className="text-sm">请确认已运行 ./start.sh</p>
      </div>
    );
  }

  // Get all unique keywords for filter bar (fetch unfiltered for keyword list)
  let allKeywords: string[] = [];
  try {
    const all = await fetchNotes({ limit: 200, sort: 'date' });
    allKeywords = [...new Set(all.items.map((n) => n.keyword).filter(Boolean) as string[])];
  } catch {}

  const totalPages = Math.ceil(data.total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-700">
          数据看板
          <span className="ml-2 text-sm text-gray-400 font-normal">共 {data.total} 篇</span>
        </h1>
      </div>

      <Suspense>
        <FilterBar
          keywords={allKeywords}
          currentKeyword={keyword}
          currentSort={sort}
        />
      </Suspense>

      {data.items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">暂无数据</p>
          <p className="text-sm">请先用 Chrome 插件采集小红书笔记</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.items.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              {Array.from({ length: totalPages }, (_, i) => {
                const pageOffset = i * PAGE_SIZE;
                const params = new URLSearchParams();
                if (keyword) params.set('keyword', keyword);
                if (sort !== 'date') params.set('sort', sort);
                if (pageOffset > 0) params.set('offset', String(pageOffset));
                return (
                  <a
                    key={i}
                    href={`/?${params.toString()}`}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      currentPage === i + 1
                        ? 'bg-red-500 text-white border-red-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
                    }`}
                  >
                    {i + 1}
                  </a>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="text-center py-16 text-gray-400">加载中...</div>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}
```

- [ ] **Step 4: Smoke test dashboard**

```bash
# Terminal 1: start backend
cd /Users/shenni/repository/find-hot-in-red/backend
python3 -m uvicorn main:app --port 8000

# Terminal 2: start frontend
cd /Users/shenni/repository/find-hot-in-red/frontend
npm run dev
```

Open `http://localhost:3000` — should show "暂无数据" empty state. Stop both servers.

- [ ] **Step 5: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add frontend/app/
git commit -m "feat: dashboard page with keyword filter, sort, and pagination"
```

---

## Task 11: Frontend — note detail page

**Files:**
- Create: `frontend/app/notes/[id]/page.tsx`

- [ ] **Step 1: Create frontend/app/notes/[id]/page.tsx**

```typescript
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchNote } from '@/lib/api';

export default async function NoteDetailPage({ params }: { params: { id: string } }) {
  let note;
  try {
    note = await fetchNote(params.id);
  } catch {
    notFound();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-red-500 mb-6 transition-colors"
      >
        ← 返回看板
      </Link>

      {/* Note header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <h1 className="text-xl font-bold text-gray-900 mb-3">
          {note.title || '（无标题）'}
        </h1>

        <div className="flex flex-wrap gap-3 text-sm text-gray-500 mb-4">
          <span>
            <span className="font-medium text-gray-700">{note.author || '未知作者'}</span>
          </span>
          {note.keyword && (
            <span className="bg-red-50 text-red-500 rounded px-2 py-0.5">#{note.keyword}</span>
          )}
          {note.publish_date && <span>{note.publish_date}</span>}
        </div>

        <div className="flex gap-6 text-sm mb-4">
          <span className="text-gray-600">❤️ <strong>{note.likes.toLocaleString()}</strong> 点赞</span>
          <span className="text-gray-600">⭐ <strong>{note.collects.toLocaleString()}</strong> 收藏</span>
        </div>

        {note.url && (
          <a
            href={note.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-red-400 hover:text-red-600 underline"
          >
            在小红书中查看 ↗
          </a>
        )}
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <h2 className="font-semibold text-gray-700 mb-3">正文</h2>
        <p className="text-gray-600 leading-relaxed whitespace-pre-wrap text-sm">
          {note.content || '（无正文）'}
        </p>
      </div>

      {/* Comments */}
      {note.comments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-700 mb-4">
            热门评论 <span className="text-gray-400 font-normal text-sm">({note.comments.length}条)</span>
          </h2>
          <div className="space-y-3">
            {note.comments.map((comment) => (
              <div key={comment.id} className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 text-red-500 text-xs flex items-center justify-center font-medium">
                  {comment.rank}
                </span>
                <div className="flex-1">
                  <p className="text-sm text-gray-700 leading-relaxed">{comment.content}</p>
                  {comment.likes > 0 && (
                    <span className="text-xs text-gray-400 mt-1">❤️ {comment.likes}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Smoke test detail page**

Start both servers (see Task 10 Step 4). 

POST a test note via curl:
```bash
curl -X POST http://localhost:8000/api/notes \
  -H "Content-Type: application/json" \
  -d '{
    "notes": [{
      "id": "test001",
      "keyword": "测试",
      "title": "测试笔记标题",
      "content": "这是正文内容，可以很长很长...",
      "author": "测试作者",
      "author_id": "u_test",
      "likes": 1234,
      "collects": 567,
      "publish_date": "2024-01-15",
      "url": "https://www.xiaohongshu.com/explore/test001",
      "source": "dom",
      "comments": [
        {"id": "c001", "note_id": "test001", "content": "好棒！", "likes": 88, "rank": 1},
        {"id": "c002", "note_id": "test001", "content": "学到了", "likes": 42, "rank": 2}
      ]
    }]
  }'
```

Open `http://localhost:3000` — note card should appear.
Click note card → detail page should show title, content, comments.

- [ ] **Step 3: Commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add frontend/app/notes/
git commit -m "feat: note detail page with content and comments"
```

---

## Task 12: End-to-end integration & polish

**Files:**
- Modify: `setup.sh` (finalize checks)
- Modify: `start.sh` (finalize process management)

- [ ] **Step 1: Add NEXT_PUBLIC_API_URL to frontend env**

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 2: Full end-to-end test**

Run full test suite:
```bash
cd /Users/shenni/repository/find-hot-in-red/backend
python3 -m pytest tests/ -v
```

Expected: all tests pass.

Start all services:
```bash
cd /Users/shenni/repository/find-hot-in-red
./start.sh
```

Verify:
1. `http://localhost:8000/api/notes` returns `{"total":0,"items":[]}` (or data if DB has records)
2. `http://localhost:3000` loads with empty state message
3. POST a note via curl (see Task 11 Step 2)
4. Refresh dashboard → note card appears
5. Click card → detail page loads with comments

- [ ] **Step 3: Load Chrome extension and do manual scrape test**

1. Open `chrome://extensions` → Load unpacked → select `extension/`
2. Click extension icon
3. Enter keyword: `AI工具`
4. Set count to `3`
5. Click "开始采集"
6. Verify progress updates in popup
7. After completion, check `http://localhost:3000` for new notes

- [ ] **Step 4: Final commit**

```bash
cd /Users/shenni/repository/find-hot-in-red
git add frontend/.env.local
git commit -m "feat: MVP complete — extension + backend + frontend integrated"
```

---

## MVP Acceptance Criteria

- [ ] `./setup.sh` runs clean on a fresh environment
- [ ] `./start.sh` starts both services and opens browser
- [ ] Chrome extension popup loads and accepts keywords
- [ ] Extension can scrape notes from xiaohongshu.com and push to backend
- [ ] `GET /api/notes` returns correct data with filtering/sorting
- [ ] Dashboard shows note cards, filters work, pagination works
- [ ] Detail page shows full content and comments
- [ ] All backend tests pass: `pytest tests/ -v`
