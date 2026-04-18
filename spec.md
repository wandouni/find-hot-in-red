好，方案确认完毕。现在给你出最终完整的技术实施方案，可以直接按这个开始构建。

---

# 最终方案：完整技术设计文档

## 系统架构图---

# 完整技术设计文档

## 一、插件设计（Chrome Extension）

### 工作流程

```
你点击"开始采集"
    ↓
任务队列：[关键词A × 20篇, 关键词B × 20篇, ...]
    ↓
打开小红书搜索页 → 模拟滚动 → 抓取笔记列表
    ↓
逐篇进入笔记 → 抓取正文 + 作者 + 时间 + 评论
    ↓
[成功] POST 数据到 localhost:8000/api/notes
[失败/改版] 自动截图 → POST 到 localhost:8000/api/screenshot → 后端调 LLM Vision 识别
    ↓
全部完成 → 系统通知弹出
```

### 文件结构

```
xhs-collector-extension/
├── manifest.json          # 插件配置（权限声明）
├── popup.html             # 你看到的操作界面
├── popup.js               # 界面逻辑（填关键词、点开始）
├── background.js          # 任务队列调度
├── content.js             # 注入小红书页面、读取DOM
└── config.js              # 延迟时间、抓取数量等参数
```

### manifest.json 关键权限

```json
{
    "permissions": ["tabs", "scripting", "storage", "notifications"],
    "host_permissions": [
        "https://www.xiaohongshu.com/*",
        "http://localhost:8000/*"
    ]
}
```

### 反检测策略

| 措施         | 实现方式                              |
| ------------ | ------------------------------------- |
| 随机延迟     | 每步操作间隔 1500 ～ 4000ms 随机      |
| 模拟滚动     | `window.scrollBy`分段滚动，非瞬间跳转 |
| 鼠标移动模拟 | `dispatchEvent(new MouseEvent)`       |
| 失败自动截图 | `chrome.tabs.captureVisibleTab()`     |
| 每日限额     | 单个关键词每次不超过 50 篇（可配置）  |

### 截图识别流程

```
content.js 抓取失败（DOM 元素找不到）
    ↓
background.js 调用 chrome.tabs.captureVisibleTab()
    ↓
base64 图片 POST 到 localhost:8000/api/screenshot
    ↓
后端把截图发给 LLM（Vision 模型）+ 提示词：
  "这是小红书笔记截图，请提取：标题、作者、点赞数、收藏数、发布时间、正文前500字"
    ↓
LLM 返回结构化 JSON → 存入数据库
```

---

## 二、本地网站设计

### 目录结构

```
xhs-insight/
├── backend/
│   ├── main.py            # FastAPI 入口
│   ├── models.py          # 数据库模型
│   ├── routes/
│   │   ├── notes.py       # 笔记 CRUD API
│   │   ├── ai.py          # AI 分析接口
│   │   └── ingest.py      # 接收插件数据
│   └── config.yaml        # ← 你只需要改这个文件
│
├── frontend/
│   ├── pages/
│   │   ├── index.tsx      # 数据看板
│   │   ├── note/[id].tsx  # 笔记详情
│   │   ├── ai.tsx         # AI 选题助手
│   │   └── tasks.tsx      # 采集管理
│   └── components/
│
├── data/
│   └── xhs_data.db        # SQLite 数据库（自动生成）
│
├── screenshots/           # 截图备份
├── start.sh               # 一键启动
└── setup.sh               # 首次初始化
```

### config.yaml（你唯一需要改的文件）

```yaml
# =============================
# LLM 配置（填你的 API Key）
# =============================
llm:
    provider: 'openai' # 可改为: anthropic / zhipu / qwen / custom
    api_key: 'sk-xxxxx' # 填你的 Key
    api_base: '' # 非官方地址时填，如 https://api.xxx.com/v1
    model: 'gpt-4o' # 改成你想用的模型名
    vision_model: 'gpt-4o' # 截图识别用的模型（需支持视觉）

# =============================
# 采集参数（可按需调整）
# =============================
crawler:
    max_notes_per_keyword: 30 # 每个关键词最多抓几篇
    top_comments: 10 # 每篇抓前几条热评
    delay_min_ms: 1500 # 最短等待（毫秒）
    delay_max_ms: 4000 # 最长等待（毫秒）

# =============================
# 端口（一般不用改）
# =============================
server:
    backend_port: 8000
    frontend_port: 3000
```

### 数据库表结构

**notes 表**

```sql
CREATE TABLE notes (
    id           TEXT PRIMARY KEY,   -- 小红书笔记ID
    keyword      TEXT,               -- 来源搜索词
    title        TEXT,
    content      TEXT,
    author       TEXT,
    author_id    TEXT,
    likes        INTEGER,
    collects     INTEGER,
    publish_date TEXT,
    source       TEXT,               -- "dom" 或 "vision"（区分正常/截图识别）
    crawl_time   DATETIME DEFAULT CURRENT_TIMESTAMP,
    url          TEXT
);
```

**comments 表**

```sql
CREATE TABLE comments (
    id       TEXT PRIMARY KEY,
    note_id  TEXT REFERENCES notes(id),
    content  TEXT,
    likes    INTEGER,
    rank     INTEGER                -- 第几热评
);
```

**tasks 表**

```sql
CREATE TABLE tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    keywords   TEXT,               -- JSON数组
    status     TEXT,               -- pending / running / done / failed
    total      INTEGER,
    done       INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### AI 选题助手 Prompt 模板

```
你是一位公众号内容策划专家。

以下是从小红书收集的 {N} 篇热门笔记（来自关键词「{keyword}」）：

{笔记列表：标题 + 摘要 + 点赞数 + 热评}

请完成以下任务：
1. 分析这些内容的共同爆点（用户痛点、情绪触发点、话题模式）
2. 给出 3～5 个适合公众号的选题方向
3. 每个选题包含：标题建议、写作角度、目标读者、预计共鸣点

输出格式：JSON
```

---

## 三、启动方式

### 首次初始化（只做一次）

```bash
双击 setup.sh
# 自动完成：
# - 检查 Python / Node.js 环境
# - pip install 依赖
# - npm install 依赖
# - 创建数据库
# - 生成默认 config.yaml
```

### 日常使用

```bash
双击 start.sh
# 自动完成：
# - 启动后端 (port 8000)
# - 启动前端 (port 3000)
# - 自动打开浏览器 http://localhost:3000
```

### 插件安装（只做一次）

1. Chrome 打开 `chrome://extensions`
2. 右上角开启"开发者模式"
3. 点"加载已解压的扩展程序" → 选择 `xhs-collector-extension` 文件夹
4. 插件图标出现在工具栏 → 完成

---

## 四、测试方案

### 阶段 1：插件单独测试

| 测试项   | 操作                                         | 预期结果                    |
| -------- | -------------------------------------------- | --------------------------- |
| DOM 抓取 | 手动打开一篇小红书笔记，点插件里"测试当前页" | 控制台输出笔记 JSON         |
| 截图识别 | 关闭网络或故意改错 DOM 选择器触发失败        | 自动截图 + LLM 识别返回结果 |
| 任务队列 | 填 2 个关键词各 5 篇，点开始                 | 10 篇数据进库，无报错       |

### 阶段 2：后端 API 测试

用 Postman 或浏览器直接访问：

```
GET  http://localhost:8000/api/notes?keyword=AI工具&sort=likes&limit=20
GET  http://localhost:8000/api/notes/{note_id}
POST http://localhost:8000/api/ai/topics   body: {note_ids: [...]}
GET  http://localhost:8000/api/tasks
```

### 阶段 3：全链路测试

1. 插件填关键词"职场副业"，抓取 10 篇
2. 打开网站 → 数据看板 → 确认数据显示正常
3. 勾选 5 篇热帖 → 点"生成选题建议" → 确认 AI 返回内容
4. 点某篇笔记 → 确认详情页评论显示正确

---

## 五、需要你安装的前置软件（仅此 3 个）

| 软件          | 用途     | 安装方式              |
| ------------- | -------- | --------------------- |
| Python 3.10+  | 运行后端 | python.org 下载安装包 |
| Node.js 18+   | 运行前端 | nodejs.org 下载安装包 |
| Chrome 浏览器 | 运行插件 | 应该已有              |

setup.sh 会自动检测是否安装，缺什么提示什么。

---

## 六、开发顺序建议

```
Week 1：插件基础版
  → 能抓单篇笔记数据 + 存到本地 JSON

Week 2：后端 + 数据库
  → FastAPI 接收插件数据 + SQLite 存储

Week 3：前端数据看板
  → 能看到数据、排序、筛选

Week 4：AI 选题助手 + 截图识别
  → 接入 LLM API + 打通全链路

Week 5：测试 + 打包
  → 两个启动脚本 + 安装说明文档
```

---

方案确认后，我们可以从任意一块开始实际编写代码。你想先从哪个部分开始？建议从**插件的 manifest.json + popup 界面**入手，因为这是你能最快看到效果的部分。
