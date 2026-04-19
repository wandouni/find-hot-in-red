# XHS Insight

小红书热门内容采集与分析工具。通过 Chrome 插件抓取搜索结果页的笔记数据，存入本地数据库，在 Web 看板中筛选、排序、导出。

---

## 项目结构

```
find-hot-in-red/
├── extension/          # Chrome 插件（Manifest V3）
│   ├── manifest.json
│   ├── interceptor.js  # 在页面加载前注入，拦截 XHS API 响应提取 token
│   ├── background.js   # Service Worker，任务调度与采集主逻辑
│   ├── popup.html/js   # 插件弹窗 UI
│   ├── content.js      # 注入页面的辅助脚本
│   └── config.js       # 后端地址、延迟等常量
│
├── backend/            # FastAPI + SQLite
│   ├── main.py         # 应用入口，CORS 配置
│   ├── models.py       # SQLAlchemy 数据模型
│   ├── schemas.py      # Pydantic 请求/响应模型
│   ├── database.py     # 数据库连接
│   ├── config.py       # 读取 config.yaml
│   └── routes/
│       ├── ingest.py   # POST /api/notes（插件推送数据）
│       ├── notes.py    # GET /api/notes, GET /api/notes/{id}, 导出接口
│       └── tasks.py    # GET/POST/PATCH /api/tasks
│
├── frontend/           # Next.js 14（App Router）
│   └── app/
│       ├── page.tsx            # 数据看板（笔记列表+筛选+导出）
│       ├── tasks/page.tsx      # 采集任务记录
│       └── notes/[id]/page.tsx # 笔记详情页
│
├── config.yaml         # 统一配置（端口、延迟、LLM 预留）
├── setup.sh            # 首次初始化
└── start.sh            # 一键启动
```

---

## 功能说明

### Chrome 插件
- 输入关键词（每行一个），设置每词采集数量（最多 50 篇）
- 可按**发表日期**筛选：不限 / 1天内 / 2天内 / 1周内
- 自动在小红书搜索页采集笔记：标题、作者、点赞、收藏、正文、前10条热评
- 每次采集作为一个「任务」记录到后端

### 数据看板（localhost:3000）
- **数据看板**：按关键词筛选，按点赞/收藏/时间排序，分页浏览
- **采集任务**：查看每次采集记录，含关键词、进度条、状态
- **导出**：一键导出当前筛选结果为 Excel（两个 Sheet：笔记 + 评论）或 Markdown

### 导出格式
**Excel**：首行冻结 + 标题列冻结 + 筛选下拉，笔记 Sheet + 评论 Sheet

**Markdown**（按点赞数从高到低）：
```
[笔记标题](链接)
点赞数量：1234；收藏数量：567；

[笔记标题](链接)
点赞数量：890；收藏数量：234；
```

---

## 快速开始

### 环境要求

| 工具 | 版本 |
|------|------|
| Python | 3.10+ |
| Node.js | 18+ |
| Chrome | 111+（支持 content_scripts MAIN world） |

### 第一次使用

```bash
cd find-hot-in-red

# 1. 初始化（安装依赖、创建数据库）
bash setup.sh

# 2. 启动后端 + 前端
bash start.sh
```

`start.sh` 启动后会自动打开 `http://localhost:3000`。

### 安装 Chrome 插件

1. 打开 Chrome，访问 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目中的 `extension/` 目录

安装后工具栏出现 **XHS** 图标，点击打开采集面板。

### 开始采集

1. 确认 `start.sh` 已运行（后端在 8000 端口）
2. 点击插件图标，输入关键词（每行一个）
3. 设置每词采集数量和日期筛选
4. 点击「开始采集」
5. 采集完成后在 `localhost:3000` 查看数据

---

## 调试指南

### 后端调试

```bash
cd backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

- API 文档：`http://localhost:8000/docs`（Swagger UI）
- 数据库文件：`data/xhs_data.db`（SQLite，可用 DB Browser 查看）

```bash
# 手动测试接口
curl http://localhost:8000/api/notes
curl http://localhost:8000/api/tasks
curl -o notes.xlsx http://localhost:8000/api/export/notes
```

### 前端调试

```bash
cd frontend
npm run dev
```

访问 `http://localhost:3000`，Next.js 支持热重载。

### 插件调试

1. 打开 `chrome://extensions`，找到 XHS Insight Collector
2. 点击「Service worker」链接，打开 Service Worker 的 DevTools
3. Console 中可看到带 `[XHS]` 前缀的采集日志：
   - `[XHS] Captured=N` — 拦截到的 token 数量
   - `[XHS] → https://...` — 正在导航的笔记 URL
   - `[XHS] OK: "标题" likes=N` — 成功采集
4. 修改插件文件后，在 `chrome://extensions` 点击刷新按钮重载

### 常见问题

**插件采集不到数据（Captured=0）**
- 检查小红书是否已登录
- 在小红书搜索页打开 DevTools → Console，查看是否有 `[XHS-intercept]` 日志
- 重新加载插件后刷新小红书页面再试

**后端报错 / 无法连接**
- 确认 `bash start.sh` 已运行
- 检查端口是否被占用：`lsof -i :8000`
- 多余的 uvicorn 进程：`pkill -f uvicorn`

**Excel 下载显示 Note not found**
- 后端可能还在运行旧版本，重启：`pkill -f uvicorn && bash start.sh`

---

## 配置

编辑根目录 `config.yaml`：

```yaml
crawler:
  max_notes_per_keyword: 30   # 每词默认采集上限
  delay_min_ms: 1500          # 请求间最小延迟（毫秒）
  delay_max_ms: 4000          # 请求间最大延迟（毫秒）

server:
  backend_port: 8000
  frontend_port: 3000
```

---

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/notes` | 插件推送笔记数据（含评论） |
| GET | `/api/notes` | 列表查询（keyword / sort / limit / offset） |
| GET | `/api/notes/{id}` | 单篇详情（含评论） |
| GET | `/api/tasks` | 采集任务列表 |
| POST | `/api/tasks` | 创建采集任务 |
| PATCH | `/api/tasks/{id}` | 更新任务进度/状态 |
| GET | `/api/export/notes` | 导出 Excel（?keyword=xxx） |
| GET | `/api/export/notes.md` | 导出 Markdown（按点赞排序） |
