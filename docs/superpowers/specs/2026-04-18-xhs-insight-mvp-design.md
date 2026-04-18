# XHS Insight MVP — 设计文档

**日期：** 2026-04-18  
**范围：** MVP（Chrome 插件 + FastAPI 后端 + Next.js 数据看板）  
**不含：** AI 选题助手、截图识别降级

---

## 一、整体架构

### 目录结构

```
find-hot-in-red/
├── config.yaml                 # 唯一需要用户修改的文件
├── start.sh                    # 一键启动后端+前端
├── setup.sh                    # 首次初始化
│
├── extension/                  # Chrome 插件
│   ├── manifest.json
│   ├── popup.html / popup.js   # 操作界面
│   ├── background.js           # 任务队列调度
│   ├── content.js              # 注入小红书页面抓取数据
│   └── config.js               # 硬编码常量（延迟范围、抓取数量上限），与 config.yaml 保持一致
│
├── backend/                    # FastAPI + SQLite
│   ├── main.py                 # 应用入口，CORS 配置
│   ├── models.py               # SQLAlchemy 模型（notes/comments/tasks）
│   ├── config.py               # 读取 config.yaml
│   └── routes/
│       ├── ingest.py           # POST /api/notes
│       └── notes.py            # GET /api/notes, GET /api/notes/{id}, GET /api/tasks
│
├── frontend/                   # Next.js 14 (App Router)
│   ├── app/
│   │   ├── page.tsx            # 数据看板
│   │   └── notes/[id]/page.tsx # 笔记详情
│   └── lib/
│       └── api.ts              # 后端请求封装
│
└── data/
    └── xhs_data.db             # SQLite（自动生成，gitignore）
```

### 数据流

```
Chrome 插件
  → 搜索小红书 → 滚动加载 → 逐篇抓取
  → POST /api/notes（批量，含评论）
  → FastAPI 写入 SQLite

Next.js 前端
  → GET /api/notes（列表/筛选/排序）
  → GET /api/notes/{id}（详情+评论）
  → 展示给用户
```

---

## 二、Chrome 插件

### Popup 界面

- 关键词输入区（每行一个关键词）
- 每词抓取数量（默认 20，上限 50）
- 开始采集 / 停止按钮
- 进度显示：`关键词A: 12/20 | 关键词B: 等待中`

### 任务调度（background.js）

1. Popup 提交 → 写入 `chrome.storage.local`
2. 按关键词顺序处理：打开搜索页 → 收集笔记链接 → 逐篇进入抓取
3. 每步随机等待 1500～4000ms（`delay_min_ms` / `delay_max_ms` 可配置）
4. `window.scrollBy` 分段滚动加载更多
5. 抓取完成 → `POST localhost:8000/api/notes`
6. DOM 元素找不到时跳过该笔记（记录失败，不中断队列）

### 抓取字段（content.js）

| 字段 | 说明 |
|------|------|
| id | 小红书笔记 ID |
| url | 笔记完整 URL |
| title | 标题 |
| content | 正文 |
| author | 作者昵称 |
| author_id | 作者 ID |
| likes | 点赞数 |
| collects | 收藏数 |
| publish_date | 发布时间 |
| comments | 前 10 条热评（content + likes + rank） |

### 反检测策略（基础版）

- 随机延迟（每步操作均等待）
- `window.scrollBy` 分段滚动，非瞬间跳转
- 单关键词单次不超过 50 篇（`max_notes_per_keyword` 可配置）

---

## 三、FastAPI 后端

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/notes` | 插件批量推送笔记+评论（重复 note_id 做 upsert） |
| GET | `/api/notes` | 列表查询：`keyword` / `sort=likes\|collects\|date` / `limit` / `offset` |
| GET | `/api/notes/{id}` | 单篇详情（含评论列表，按 rank 排序） |
| GET | `/api/tasks` | 采集任务状态列表 |

### 数据库表（SQLite + SQLAlchemy）

**notes 表**
```sql
id TEXT PRIMARY KEY, keyword TEXT, title TEXT, content TEXT,
author TEXT, author_id TEXT, likes INTEGER, collects INTEGER,
publish_date TEXT, url TEXT, source TEXT DEFAULT 'dom',
crawl_time DATETIME DEFAULT CURRENT_TIMESTAMP
```

**comments 表**
```sql
id TEXT PRIMARY KEY, note_id TEXT REFERENCES notes(id),
content TEXT, likes INTEGER, rank INTEGER
```

**tasks 表**
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT, keywords TEXT,
status TEXT, total INTEGER, done INTEGER DEFAULT 0,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

### 其他

- **CORS：** 允许 `localhost:3000` 和 Chrome 插件源
- **upsert：** 相同 `note_id` 时更新而非报错，支持插件重跑
- **config.yaml：** 启动时加载，LLM 配置预留（MVP 不调用）
- **GET `/api/config`：** 返回 `crawler` 配置，供插件 popup 显示默认参数（可选）

---

## 四、Next.js 前端

### 页面一：数据看板 `/`

- 顶部筛选栏：关键词下拉 + 排序（点赞/收藏/时间）+ 每页数量
- 笔记卡片列表：标题、作者、点赞数、收藏数、来源关键词、抓取时间
- 点击卡片 → 跳转详情页
- 空状态提示："暂无数据，请先用插件采集"

### 页面二：笔记详情 `/notes/[id]`

- 基本信息：标题、作者、点赞、收藏、发布时间、URL 外链
- 正文全文
- 热评列表（按 rank 排序，评论内容 + 点赞数）
- 返回看板按钮

### 技术选型

- **框架：** Next.js 14，App Router
- **样式：** Tailwind CSS
- **数据获取：** Server Components + fetch（看板页筛选用 URL 参数 + client-side router）
- **API 层：** `lib/api.ts` 封装所有后端请求

---

## 五、config.yaml

```yaml
llm:
  provider: 'openai'        # openai / anthropic / zhipu / qwen
  api_key: 'sk-xxxxx'
  api_base: ''
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

---

## 六、启动脚本

**setup.sh（首次）：**
1. 检查 Python 3.10+ / Node.js 18+
2. `pip install` 后端依赖
3. `npm install` 前端依赖
4. 创建 SQLite 数据库
5. 生成默认 `config.yaml`

**start.sh（日常）：**
1. 后台启动 FastAPI（port 8000）
2. 后台启动 Next.js（port 3000）
3. 自动打开浏览器 `http://localhost:3000`

---

## 七、MVP 验收标准

1. 插件能采集至少 1 个关键词的笔记并成功推送到后端
2. 后端 `GET /api/notes` 返回正确数据
3. 前端看板能展示笔记列表并支持关键词筛选
4. 前端详情页能展示正文和评论
5. `setup.sh` + `start.sh` 可在全新环境运行
