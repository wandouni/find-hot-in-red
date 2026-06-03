# XHS Insight

小红书热门内容采集与分析工具。支持两种采集方式：**Chrome 插件**（在浏览器内采集）和 **Python 爬虫**（命令行驱动，适合批量运行），数据统一存入本地数据库，在 Web 看板中筛选、排序、导出。

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
├── scraper/            # Python 爬虫（Playwright 驱动）
│   ├── xhs_scraper.py  # 主脚本
│   └── requirements.txt
│
├── config.yaml         # 统一配置（端口、延迟、LLM 预留）
├── setup.sh            # 首次初始化
└── start.sh            # 一键启动
```

---

## 功能说明

### Chrome 插件

- 输入关键词（每行一个），设置每词采集数量（最多 50 篇）
- 可按**发表日期**筛选：不限 / 1 天内 / 1 周内 / 半年内
- 自动在小红书搜索页采集笔记：标题、作者、点赞、收藏、正文、前 10 条热评
- 每次采集作为一个「方案」记录到后端，方案间数据互相隔离

### Python 爬虫

- 命令行参数指定关键词、数量、日期范围，无需手动操作浏览器
- 基于 Playwright 驱动真实 Chrome，登录态持久化，无需每次重新登录
- 拦截 XHS API 响应提取 token（与插件同一机制），三层日期过滤
- 全程随机延迟 + 仿人滚动，反检测策略与插件一致
- 采集结果通过后端 API 写入，前端无需改动即可查看

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

| 工具    | 版本                                    |
| ------- | --------------------------------------- |
| Python  | 3.10+                                   |
| Node.js | 18+                                     |
| Chrome  | 111+（支持 content_scripts MAIN world） |

### 第一次使用

```bash
cd find-hot-in-red

# 1. 初始化（安装依赖、创建数据库）
bash setup.sh

# 2. 启动后端 + 前端
bash start.sh
```

`start.sh` 启动后会自动打开 `http://localhost:3000`。

### Python 爬虫

> **适用场景**：不想在浏览器里手动操作、需要批量定时运行、或插件采集受限时。

**第一步：安装依赖（只需一次）**

```bash
cd scraper
pip install -r requirements.txt
playwright install chrome   # 下载 Playwright 用的 Chrome 驱动
```

**第二步：首次登录**

首次运行时会弹出真实 Chrome 窗口，手动登录小红书账号，之后 Cookie 自动保存到 `scraper/.xhs_profile/`，后续运行无需重复登录。

**第三步：运行采集**

```bash
# 基本用法：采集「职场副业」和「AI工具」，每词 20 篇，不限日期
python3 xhs_scraper.py --keywords "职场副业" "AI工具" --max 20

# 只采集 1 周内发布的内容
python3 xhs_scraper.py --keywords "土木" "体制内" --max 30 --days 7

# 所有参数说明
python xhs_scraper.py --help
```

| 参数                    | 说明                                                                | 默认值                    |
| ----------------------- | ------------------------------------------------------------------- | ------------------------- |
| `--keywords` / `-k` | 采集关键词，可多个                                                  | 必填                      |
| `--max` / `-m`      | 每个关键词最多采集篇数                                              | `20`                    |
| `--days` / `-d`     | 日期筛选：`0` 不限 / `1` 1 天内 / `7` 1 周内 / `180` 半年内 | `0`                     |
| `--backend`           | 后端地址                                                            | `http://localhost:8000` |

> ⚠️ **注意**：运行前确保后端已启动（`bash start.sh` 或手动启动 uvicorn）。采集结果与插件共用同一数据库，在 `localhost:3000` 直接查看。

---

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

### 用 Playwright Codegen 录制操作并同步到代码

当 XHS 前端改版导致筛选按钮/排序选项的 DOM 选择器失效时，可以用 Playwright 内置的录制工具重新录一遍人工操作，再把生成的选择器替换回代码。

**第一步：启动录制（在 `scraper/` 目录下运行）**

```bash
python3 -m playwright codegen \
  --browser chromium \
  --channel chrome \
  --user-data-dir .xhs_profile \
  --lang python-async \
  --output recorded.py \
  "https://www.xiaohongshu.com/search_result?keyword=土木&type=51&sort=time_descending"
```

- `--user-data-dir .xhs_profile` — 复用已登录的 Cookie，无需重新登录
- `--lang python-async` — 生成与爬虫风格一致的 async Python 代码
- `--output recorded.py` — 录制结果写入此文件

**第二步：在弹出的浏览器里手动操作一遍完整流程**

1. 点击「筛选」按钮打开筛选面板
2. 在「排序依据」区域点击「最新」
3. 在「发布时间」区域点击「一周内」（如需日期筛选）
4. 点击任意一篇笔记进入详情页
5. 向下滚动一下
6. 返回搜索页

**第三步：关闭浏览器**，查看生成的 `recorded.py`，里面是 Playwright 录制的精确选择器，例如：

```python
await page.get_by_text("筛选").click()
await page.get_by_text("最新", exact=True).click()
await page.get_by_text("一周内", exact=True).click()
```

**第四步：把录制到的选择器替换回 `xhs_scraper.py` 的 `apply_date_filter` 函数**，用 `page.locator(...)` 原生定位器替换现有的 `page.evaluate(querySelectorAll...)` 逻辑，Playwright 原生定位器自带自动等待，比手动 `sleep` 更稳定。

---

### Python 爬虫调试

```bash
# 查看详细日志（DEBUG 级别）
python3 xhs_scraper.py --keywords "职场副业" --max 5 --days 7
```

日志说明：

- `✅ 标题 | 👍N ⭐N` — 成功采集一篇笔记
- `⏭  API预过滤` — 该笔记发布时间超出筛选范围，跳过（未打开页面）
- `⏭  DOM日期过滤` — 打开页面后确认超期，丢弃
- `📦 上报后端：inserted=N updated=N` — 成功写入数据库
- `💤 短暂休息 Xs` — 正常的防检测停顿

**Cookie 失效 / 需要重新登录**：删除 `scraper/.xhs_profile/` 目录后重新运行，会再次弹出登录窗口。

---

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
  max_notes_per_keyword: 30 # 每词默认采集上限
  delay_min_ms: 1500 # 请求间最小延迟（毫秒）
  delay_max_ms: 4000 # 请求间最大延迟（毫秒）

server:
  backend_port: 8000
  frontend_port: 3000
```

---

## API 一览

| 方法  | 路径                     | 说明                                        |
| ----- | ------------------------ | ------------------------------------------- |
| POST  | `/api/notes`           | 插件推送笔记数据（含评论）                  |
| GET   | `/api/notes`           | 列表查询（keyword / sort / limit / offset） |
| GET   | `/api/notes/{id}`      | 单篇详情（含评论）                          |
| GET   | `/api/tasks`           | 采集任务列表                                |
| POST  | `/api/tasks`           | 创建采集任务                                |
| PATCH | `/api/tasks/{id}`      | 更新任务进度/状态                           |
| GET   | `/api/export/notes`    | 导出 Excel（?keyword=xxx）                  |
| GET   | `/api/export/notes.md` | 导出 Markdown（按点赞排序）                 |
