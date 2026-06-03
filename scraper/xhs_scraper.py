"""
XHS Insight — Python 爬虫（Playwright 驱动）
=============================================

核心反检测策略：
  1. 使用真实 Chrome（channel="chrome"），持久化 profile（保留 Cookie/指纹）
  2. 拦截 XHS 网络响应提取 xsec_token + 发布时间，不需要逆向签名算法
  3. 三层日期过滤：XHS UI 筛选 → API 时间戳预过滤 → DOM 日期验证
  4. 全程随机延迟 + 仿人滚动 + 偶发休息，行为接近正常用户
  5. 非 headless 模式运行（可见窗口），降低被识别风险
  6. 异常时自动退出并保存进度，不强行重试导致封号

使用流程：
  1. pip install -r requirements.txt
  2. playwright install chrome
  3. 首次运行时会打开浏览器，手动登录小红书，登录后按 Enter 继续
  4. 之后 Cookie 自动复用，无需重复登录

  python xhs_scraper.py --keywords "职场副业" "AI工具" --max 20 --days 7
"""

import argparse
import asyncio
import json
import logging
import math
import random
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
from playwright.async_api import (
    BrowserContext,
    Page,
    Response,
    async_playwright,
)

# ─────────────────────────── 配置 ────────────────────────────────────
BACKEND_URL   = "http://localhost:8000"
PROFILE_DIR   = Path(__file__).parent / ".xhs_profile"   # 持久化 Chrome 数据目录
XHS_HOME      = "https://www.xiaohongshu.com"
XHS_SEARCH    = "https://www.xiaohongshu.com/search_result"

# 日期筛选：days → XHS 筛选按钮文字
DATE_LABEL = {1: "一天内", 7: "一周内", 180: "半年内"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("xhs")


# ─────────────────────────── 随机延迟工具 ────────────────────────────
def rand(lo: float, hi: float) -> float:
    return random.uniform(lo, hi)


async def sleep(seconds: float):
    await asyncio.sleep(seconds)


async def reading_delay():
    """三段式阅读时间：快速浏览 / 正常阅读 / 深度阅读"""
    r = random.random()
    if r < 0.40:
        await sleep(rand(4, 10))      # 40%：快速扫一眼
    elif r < 0.75:
        await sleep(rand(10, 22))     # 35%：正常阅读
    else:
        await sleep(rand(22, 38))     # 25%：认真看评论


async def browse_delay():
    """笔记之间的浏览间隔：5-15s"""
    await sleep(rand(5, 15))


async def maybe_rest(total_done: int):
    """每处理 5-9 篇随机休息 25-55s，模拟刷手机中途停顿"""
    rest_every = random.randint(5, 9)
    if total_done > 0 and total_done % rest_every == 0:
        t = rand(25, 55)
        log.info(f"  💤 短暂休息 {t:.0f}s …")
        await sleep(t)


async def human_scroll(page: Page, passes: int = None):
    """仿人滚动：2-4 次不规则小滚动，25% 概率向上回滚"""
    if passes is None:
        passes = random.randint(2, 4)
    for _ in range(passes):
        amt = random.randint(200, 700)
        await page.evaluate(f"window.scrollBy({{top: {amt}, behavior: 'smooth'}})")
        await sleep(rand(0.5, 1.5))
    if random.random() < 0.25:
        up = random.randint(80, 250)
        await page.evaluate(f"window.scrollBy({{top: -{up}, behavior: 'smooth'}})")
        await sleep(rand(0.4, 0.9))
    await sleep(rand(0.8, 2.0))


# ─────────────────────────── 网络拦截 ────────────────────────────────
class LinkCapture:
    """
    订阅 Playwright 的 response 事件，从 XHS API 响应里提取
    note_id → { url, time_ms }，与 interceptor.js 逻辑完全对应。
    """

    def __init__(self):
        self._links: dict[str, dict] = {}

    def attach(self, page: Page):
        page.on("response", self._on_response)

    def detach(self, page: Page):
        page.remove_listener("response", self._on_response)

    def clear(self):
        self._links.clear()

    def snapshot(self) -> list[dict]:
        """返回当前捕获的链接列表 [{id, url, time_ms}]"""
        return list(self._links.values())

    async def _on_response(self, response: Response):
        # 只关注 XHS 的 JSON API 接口
        url = response.url
        if "xiaohongshu.com" not in url:
            return
        if response.status != 200:
            return
        ct = response.headers.get("content-type", "")
        if "json" not in ct:
            return
        try:
            data = await response.json()
        except Exception:
            return
        self._extract(data)

    def _extract(self, data: dict):
        items = (
            (data.get("data") or {}).get("items")
            or data.get("items")
            or []
        )
        if not isinstance(items, list):
            return
        captured = 0
        for item in items:
            note_id = item.get("id") or item.get("note_id")
            card    = item.get("note_card") or item.get("noteCard") or {}
            token   = item.get("xsec_token") or card.get("xsec_token")
            raw_t   = (
                card.get("time") or card.get("create_time")
                or card.get("last_update_time")
                or item.get("time") or item.get("create_time") or 0
            )
            if note_id and token:
                time_ms = self._to_ms(raw_t)
                self._links[note_id] = {
                    "id":      note_id,
                    "url":     f"{XHS_HOME}/explore/{note_id}"
                               f"?xsec_token={token}&xsec_source=pc_search",
                    "time_ms": time_ms,
                }
                captured += 1
        if captured:
            log.debug(f"  [intercept] +{captured} tokens, total={len(self._links)}")

    @staticmethod
    def _to_ms(t) -> int:
        try:
            n = int(t)
            if n <= 0:
                return 0
            # 秒级时间戳 < 1e12；毫秒级 ≥ 1e12
            return n * 1000 if n < 1_000_000_000_000 else n
        except Exception:
            return 0


# ─────────────────────────── 日期解析 ────────────────────────────────
DATE_RE = re.compile(
    r"^(刚刚|\d+\s*分钟前|\d+\s*小时前|昨天|\d+\s*天前|\d{1,2}-\d{2}|\d{4}-\d{2}-\d{2})$"
)


def parse_days_ago(publish_date: str) -> float:
    """
    解析 XHS 中文日期字符串 → 距今天数（float）。
    无法解析返回 None（不过滤，保守策略）。
    """
    if not publish_date:
        return None
    s = publish_date.strip()
    now = datetime.now()

    if s == "刚刚":
        return 0.0
    m = re.match(r"^(\d+)\s*分钟前$", s)
    if m:
        return int(m[1]) / (60 * 24)
    m = re.match(r"^(\d+)\s*小时前$", s)
    if m:
        return int(m[1]) / 24
    if s == "昨天":
        return 1.0
    m = re.match(r"^(\d+)\s*天前$", s)
    if m:
        return float(m[1])
    m = re.match(r"^(\d{1,2})-(\d{2})$", s)
    if m:
        d = datetime(now.year, int(m[1]), int(m[2]))
        if d > now:
            d = d.replace(year=d.year - 1)
        return (now - d).total_seconds() / 86400
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        d = datetime(int(m[1]), int(m[2]), int(m[3]))
        return (now - d).total_seconds() / 86400
    return None   # 无法解析，不丢弃


def passes_api_filter(time_ms: int, days: int) -> bool:
    """第二层：API 时间戳预过滤"""
    if not days or not time_ms:
        return True
    cutoff_ms = (time.time() - days * 86400) * 1000
    return time_ms >= cutoff_ms


def passes_dom_filter(publish_date: str, days: int) -> bool:
    """第三层：DOM 日期验证（无法解析时保留）"""
    if not days:
        return True
    age = parse_days_ago(publish_date)
    if age is None:
        return True   # 无法解析，保守保留
    return age <= days


# ─────────────────────────── DOM 抓取 ────────────────────────────────
async def scrape_note_page(page: Page, keyword: str, note_id: str) -> Optional[dict]:
    """
    在已打开的笔记页面上提取结构化数据。
    返回 dict 或 None（如果页面内容异常）。
    """
    try:
        # 确认还在笔记页（防止跳转到 404 或登录页）
        path = page.url
        m = re.search(r"/explore/([0-9a-zA-Z]+)", path)
        if not m or (note_id and m[1] != note_id):
            log.warning(f"  URL 不匹配：{path}")
            return None

        def parse_count(text: str) -> int:
            text = (text or "").strip().replace(",", "").replace("，", "")
            if text.endswith("万"):
                return round(float(text[:-1]) * 10000)
            try:
                return int(text)
            except ValueError:
                return 0

        result = await page.evaluate("""
            () => {
                function parseCount(el) {
                    if (!el) return 0;
                    const t = (el.textContent || '').trim()
                              .replace(/[,，]/g,'');
                    if (t.endsWith('万')) return Math.round(parseFloat(t)*10000);
                    return parseInt(t) || 0;
                }

                const noteId = location.pathname.match(/\\/explore\\/([0-9a-zA-Z]+)/)?.[1] || '';
                const title = (
                    document.querySelector('#detail-title') ||
                    document.querySelector('.note-content .title') ||
                    document.querySelector('h1')
                )?.textContent?.trim() || '';

                const content = (
                    document.querySelector('#detail-desc') ||
                    document.querySelector('.note-content .desc') ||
                    document.querySelector('.desc')
                )?.textContent?.trim() || '';

                const author = (
                    document.querySelector('.author-wrapper .name') ||
                    document.querySelector('.username')
                )?.textContent?.trim() || '';

                const authorHref = (
                    document.querySelector('.author-wrapper a') ||
                    document.querySelector('a.author')
                )?.href || '';
                const authorId = (authorHref.match(/\\/user\\/profile\\/([0-9a-zA-Z]+)/) || [])[1] || '';

                const likes = parseCount(
                    document.querySelector('.like-wrapper .count') ||
                    document.querySelector('[class*="like"] .count')
                );
                const collects = parseCount(
                    document.querySelector('.collect-wrapper .count') ||
                    document.querySelector('[class*="collect"] .count')
                );

                // 日期：只接受符合格式的元素
                const DATE_RE = /^(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|昨天|\\d+\\s*天前|\\d{1,2}-\\d{2}|\\d{4}-\\d{2}-\\d{2})$/;
                let publishDate = '';
                const dateCandidates = [
                    document.querySelector('.note-content .date'),
                    document.querySelector('time'),
                    ...document.querySelectorAll('[class*="date"]'),
                ];
                for (const el of dateCandidates) {
                    if (!el) continue;
                    const t = (el.textContent || '').trim();
                    if (DATE_RE.test(t)) { publishDate = t; break; }
                }

                const commentEls = document.querySelectorAll('.comment-item, .comments-el');
                const comments = [];
                commentEls.forEach((el, idx) => {
                    if (idx >= 10) return;
                    const c = (el.querySelector('.content') ||
                               el.querySelector('.comment-content'))?.textContent?.trim() || '';
                    const cl = parseCount(
                        el.querySelector('.like-count') ||
                        el.querySelector('[class*="like"]')
                    );
                    comments.push({
                        id: noteId + '_c_' + (idx+1),
                        note_id: noteId,
                        content: c,
                        likes: cl,
                        rank: idx + 1,
                    });
                });

                return { id: noteId, title, content, author, author_id: authorId,
                         likes, collects, publish_date: publishDate,
                         url: location.href, source: 'dom', comments };
            }
        """)
        if not result or not result.get("id"):
            return None
        result["keyword"] = keyword
        return result
    except Exception as e:
        log.warning(f"  scrape_note_page 异常: {e}")
        return None


# ─────────────────────────── 日期筛选点击 ────────────────────────────
async def apply_date_filter(page: Page, days: int):
    """点击 XHS 搜索页的日期筛选按钮（策略 A：定位"发布时间"区域；策略 B：全页最小元素）"""
    label = DATE_LABEL.get(days)
    if not label:
        return

    # Step 1：打开筛选面板（点击"筛选"按钮）
    await page.evaluate("""
        () => {
            const allEls = [...document.querySelectorAll('span,div,button,a,li')];
            // 找"筛选"入口按钮（文字精确匹配或含筛选图标）
            const trigger = allEls.find(el =>
                (el.textContent.trim() === '筛选' || el.textContent.trim() === '选项') &&
                el.offsetParent !== null
            );
            if (trigger) trigger.click();
        }
    """)
    await sleep(rand(0.8, 1.4))

    # Step 2：点击"最新"排序
    await page.evaluate("""
        () => {
            const els = [...document.querySelectorAll('span,div,button,a,li')]
                .filter(el => el.textContent.trim() === '最新' && el.offsetParent);
            els.sort((a,b) => a.offsetWidth*a.offsetHeight - b.offsetWidth*b.offsetHeight);
            els[0]?.dispatchEvent(new MouseEvent('click', {bubbles:true}));
        }
    """)
    await sleep(rand(0.6, 1.2))

    # Step 3：点击日期选项（两轮：精准 + 全局兜底）
    clicked = await page.evaluate(f"""
        (targetText) => {{
            const allEls = [...document.querySelectorAll('span,div,button,a,li,section')];
            // 策略 A：发布时间区域内查找
            const sec = allEls.find(el =>
                el.textContent.includes('发布时间') &&
                el.offsetParent !== null && el.offsetWidth < 600
            );
            if (sec) {{
                const opts = [...sec.querySelectorAll('span,div,button,a,li')]
                    .filter(el => el.textContent.trim() === targetText && el.offsetParent);
                if (opts.length) {{
                    opts[0].dispatchEvent(new MouseEvent('click', {{bubbles:true}}));
                    return 'A';
                }}
            }}
            // 策略 B：全页最小元素
            const matches = allEls
                .filter(el => el.textContent.trim() === targetText && el.offsetParent);
            matches.sort((a,b) => a.offsetWidth*a.offsetHeight - b.offsetWidth*b.offsetHeight);
            if (matches[0]) {{
                matches[0].dispatchEvent(new MouseEvent('click', {{bubbles:true}}));
                return 'B';
            }}
            return null;
        }}
    """, label)

    if not clicked:
        # 面板可能还没开：再等一秒重试
        await sleep(1.5)
        clicked = await page.evaluate(f"""
            (targetText) => {{
                const matches = [...document.querySelectorAll('span,div,button,a,li')]
                    .filter(el => el.textContent.trim() === targetText && el.offsetParent);
                matches.sort((a,b) => a.offsetWidth*a.offsetHeight - b.offsetWidth*b.offsetHeight);
                if (matches[0]) {{
                    matches[0].dispatchEvent(new MouseEvent('click', {{bubbles:true}}));
                    return 'retry';
                }}
                return null;
            }}
        """, label)

    log.info(f"  日期筛选 「{label}」 → {clicked or '未找到按钮'}")
    await sleep(rand(3.5, 5.5))   # 等待 XHS 重新加载结果


# ─────────────────────────── 后端通信 ────────────────────────────────
async def create_task(client: httpx.AsyncClient, keywords: list[str],
                      total: int, days: int) -> int:
    resp = await client.post(f"{BACKEND_URL}/api/tasks", json={
        "keywords": keywords,
        "total": total,
        "date_filter": days,
    })
    resp.raise_for_status()
    return resp.json()["id"]


async def push_notes(client: httpx.AsyncClient,
                     notes: list[dict], task_id: int) -> dict:
    resp = await client.post(f"{BACKEND_URL}/api/notes", json={
        "task_id": task_id,
        "notes": notes,
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()


async def finish_task(client: httpx.AsyncClient, task_id: int, status: str):
    await client.patch(f"{BACKEND_URL}/api/tasks/{task_id}",
                       json={"status": status})


# ─────────────────────────── 登录检查 ────────────────────────────────
async def ensure_logged_in(page: Page):
    """
    检查是否已登录。未登录则等待用户手动完成。
    登录状态通过 Cookie 持久化，通常只需首次操作。
    """
    await page.goto(XHS_HOME, wait_until="domcontentloaded")
    await sleep(rand(1.5, 2.5))

    # 判断是否出现登录弹窗或跳转到 /login
    is_login_page = await page.evaluate("""
        () => document.querySelector('.login-container, [class*="login"], #login')
              !== null || location.pathname.includes('/login')
    """)

    if is_login_page:
        log.warning("⚠️  检测到未登录。请在浏览器窗口中完成登录，然后回到此终端按 Enter 继续...")
        input()   # 等待用户确认
        log.info("继续执行...")
    else:
        log.info("✅ 已登录，Cookie 有效")


# ─────────────────────────── 核心：处理单个关键词 ─────────────────────
async def process_keyword(
    page: Page,
    capture: LinkCapture,
    client: httpx.AsyncClient,
    keyword: str,
    max_notes: int,
    days: int,
    task_id: int,
) -> list[dict]:

    sort_qs = "&sort=time_descending" if days else ""
    search_url = (
        f"{XHS_SEARCH}?keyword={keyword}&type=51{sort_qs}"
    )

    log.info(f"🔍 关键词：「{keyword}」 → {search_url}")
    capture.clear()
    await page.goto(search_url, wait_until="domcontentloaded")
    await sleep(rand(3, 5.5))   # 等待首屏 API 响应被拦截

    # 应用日期筛选
    if days:
        log.info(f"  📅 设置日期筛选 {days}天 …")
        await apply_date_filter(page, days)

    collected: list[dict] = []
    seen_ids: set[str]    = set()
    no_new_rounds         = 0
    MAX_NO_NEW            = 8
    notes_this_kw         = 0

    while len(collected) < max_notes:
        links = capture.snapshot()
        new_links = [l for l in links if l["id"] not in seen_ids]

        if not new_links:
            no_new_rounds += 1
            if no_new_rounds >= MAX_NO_NEW:
                log.info("  无新链接，停止滚动")
                break
            await human_scroll(page)
            continue

        no_new_rounds = 0

        for link in new_links:
            if len(collected) >= max_notes:
                break

            note_id  = link["id"]
            note_url = link["url"]
            time_ms  = link["time_ms"]
            seen_ids.add(note_id)

            # 第二层：API 时间戳预过滤
            if not passes_api_filter(time_ms, days):
                ts = datetime.fromtimestamp(time_ms / 1000).strftime("%Y-%m-%d") if time_ms else "?"
                log.info(f"  ⏭  API预过滤（{ts} 超出 {days}d）: {note_id}")
                continue

            # 8% 随机跳过（模拟用户不感兴趣）
            if random.random() < 0.08:
                log.debug(f"  ⏭  随机跳过: {note_id}")
                continue

            log.info(f"  → [{len(collected)+1}/{max_notes}] {note_url[:90]}")

            try:
                await page.goto(note_url, wait_until="domcontentloaded")
                await reading_delay()

                # 30% 概率向下滚动（模拟看评论）
                if random.random() < 0.30:
                    await human_scroll(page, passes=2)

                note = await scrape_note_page(page, keyword, note_id)

                if not note:
                    log.warning(f"  ⚠️  抓取为空: {note_id}")
                elif not passes_dom_filter(note.get("publish_date", ""), days):
                    log.info(f"  ⏭  DOM日期过滤 ({note.get('publish_date')}): {note_id}")
                else:
                    collected.append(note)
                    notes_this_kw += 1
                    log.info(f"  ✅ {note.get('title','')[:30]} | 👍{note.get('likes')} ⭐{note.get('collects')}")

            except Exception as e:
                log.warning(f"  ❌ 访问笔记出错 {note_id}: {e}")

            finally:
                # 回到搜索页，清空 token 缓存，等新 API 响应填充
                capture.clear()
                await page.goto(search_url, wait_until="domcontentloaded")
                await sleep(rand(1.5, 4.0))

            await browse_delay()
            await maybe_rest(notes_this_kw)

    # 批量上报后端
    if collected:
        result = await push_notes(client, collected, task_id)
        log.info(f"  📦 上报后端：inserted={result['inserted']} updated={result['updated']}")

    return collected


# ─────────────────────────── 主入口 ──────────────────────────────────
async def main(keywords: list[str], max_notes: int, days: int):
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as pw:
        # 使用持久化 Context：保留 Cookie、localStorage、指纹等
        context: BrowserContext = await pw.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            channel="chrome",          # 使用系统安装的真实 Chrome
            headless=False,            # 可见窗口，降低被检测概率
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
            args=[
                "--disable-blink-features=AutomationControlled",  # 隐藏 webdriver 标记
                "--no-first-run",
                "--no-default-browser-check",
            ],
            ignore_default_args=["--enable-automation"],          # 关键：移除自动化标记
        )

        page = context.pages[0] if context.pages else await context.new_page()

        # 隐藏 navigator.webdriver（部分检测依赖此字段）
        await page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
                configurable: true,
            });
        """)

        # 登录检查
        await ensure_logged_in(page)

        # 建立网络拦截
        capture = LinkCapture()
        capture.attach(page)

        async with httpx.AsyncClient(timeout=20) as client:
            # 确认后端在线
            try:
                await client.get(f"{BACKEND_URL}/api/tasks")
            except Exception:
                log.error(f"后端未响应，请先启动 FastAPI: cd backend && uvicorn main:app")
                return

            # 创建采集方案
            total_expected = len(keywords) * max_notes
            task_id = await create_task(client, keywords, total_expected, days)
            log.info(f"📋 创建方案 task_id={task_id}，共 {len(keywords)} 个关键词")

            all_collected = 0
            try:
                for i, kw in enumerate(keywords):
                    if i > 0:
                        rest = rand(45, 100)
                        log.info(f"⏸  关键词间隔休息 {rest:.0f}s …")
                        await sleep(rest)

                    notes = await process_keyword(
                        page, capture, client, kw, max_notes, days, task_id
                    )
                    all_collected += len(notes)
                    log.info(f"  关键词「{kw}」完成，采集 {len(notes)} 篇")

                await finish_task(client, task_id, "done")
                log.info(f"🎉 全部完成！共采集 {all_collected} 篇笔记 → task_id={task_id}")

            except KeyboardInterrupt:
                log.info("手动停止，保存当前进度…")
                await finish_task(client, task_id, "stopped")

            except Exception as e:
                log.error(f"运行异常: {e}", exc_info=True)
                await finish_task(client, task_id, "failed")

        capture.detach(page)
        await context.close()


# ─────────────────────────── CLI ─────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="XHS Insight Python 爬虫")
    parser.add_argument(
        "--keywords", "-k", nargs="+", required=True,
        help="采集关键词，可多个，例如: --keywords 职场副业 AI工具",
    )
    parser.add_argument(
        "--max", "-m", type=int, default=20,
        help="每个关键词最多采集笔记数（默认 20，建议不超过 50）",
    )
    parser.add_argument(
        "--days", "-d", type=int, default=0, choices=[0, 1, 7, 180],
        help="发布日期筛选：0=不限 1=1天内 7=1周内 180=半年内（默认 0）",
    )
    parser.add_argument(
        "--backend", default="http://localhost:8000",
        help="后端地址（默认 http://localhost:8000）",
    )
    args = parser.parse_args()

    BACKEND_URL = args.backend

    asyncio.run(main(args.keywords, args.max, args.days))
