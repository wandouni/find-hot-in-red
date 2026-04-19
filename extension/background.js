// Service worker — handles task queue and tab orchestration
// Token interception is handled by interceptor.js (document_start, MAIN world)
importScripts('config.js');

let stopRequested = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Random ms between min and max. */
function rand(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Apply ±factor jitter to a fixed duration, so no sleep is ever exactly
 * the same length. E.g. jitter(3000, 0.4) → 1800–4200ms.
 */
function jitter(ms, factor = 0.35) {
  return ms * (1 + (Math.random() * 2 - 1) * factor);
}

/**
 * Primary between-note delay — the main anti-bot lever.
 * Reads from CONFIG so changing config.js or config.yaml is enough.
 */
function browsingDelay() {
  return sleep(rand(CONFIG.DELAY_MIN_MS, CONFIG.DELAY_MAX_MS));
}

/**
 * Simulate time spent reading a note.
 * Tri-modal: quick glance / normal read / deep read.
 */
function readingDelay() {
  const r = Math.random();
  if (r < 0.55) return sleep(rand(5000, 12000));   // quick–normal read
  if (r < 0.85) return sleep(rand(12000, 22000));  // thorough read
  return sleep(rand(22000, 40000));                // deep / distracted read
}

/**
 * Settle time after landing on a page — replaces the old fixed sleeps.
 * Shorter than readingDelay; just long enough for XHS to finish rendering.
 */
function settleDelay(minMs = 1500, maxMs = 4000) {
  return sleep(rand(minMs, maxMs));
}

/**
 * Break every ~BREAK_EVERY notes to simulate fatigue / distraction.
 * Duration grows slightly with total notes done (longer session → longer break).
 */
const BREAK_EVERY_MIN = 5;
const BREAK_EVERY_MAX = 9;
let nextBreakAt = Math.floor(rand(BREAK_EVERY_MIN, BREAK_EVERY_MAX));

async function maybeRest(totalDone) {
  if (totalDone < nextBreakAt) return;
  nextBreakAt = totalDone + Math.floor(rand(BREAK_EVERY_MIN, BREAK_EVERY_MAX));
  const restMs = rand(25000, 60000); // 25–60s break
  console.log(`[XHS] Rest break ${Math.round(restMs / 1000)}s after ${totalDone} notes`);
  sendProgress(`稍作休息 ${Math.round(restMs / 1000)}s，模拟人工浏览…`);
  await sleep(restMs);
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

/** Wait for a tab to reach status='complete', with timeout fallback. */
function waitForLoad(tabId, timeout = 18000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Maps our dateFilter value to the exact button text on XHS search page
const XHS_DATE_BUTTON = {
  1:   '一天内',
  7:   '一周内',
  180: '半年内',
};

/**
 * Apply XHS's own date filter + "最新" sort by clicking the UI buttons.
 *
 * XHS search page shows a filter panel on the right with sections:
 *   排序依据 | 笔记类型 | 发布时间 | 筛选范围
 *
 * We:
 *  1. Click "选项" (or similar) to open the filter panel if needed
 *  2. Click "最新" sort inside 排序依据
 *  3. Clear window.__xhsLinks (purge pre-filter captures)
 *  4. Find the 发布时间 section and click the matching option
 *  5. Wait for XHS to re-fire the filtered API calls
 */
async function applyXHSDateFilter(tabId, dateFilter) {
  const buttonText = XHS_DATE_BUTTON[dateFilter];
  if (!buttonText) return;

  // Diagnostic: log all short visible texts so we can see what XHS renders
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const texts = new Set();
      for (const el of document.querySelectorAll('span, button, a, li')) {
        const t = el.textContent.trim();
        if (t.length > 0 && t.length < 15 && el.offsetParent !== null) texts.add(t);
      }
      console.log('[XHS-filter-debug] visible short texts:', [...texts].join(' | '));
    },
  }).catch(() => {});

  // ── Step 1: open the filter panel ────────────────────────────────
  // XHS shows a "选项" button (or "筛选") that reveals the filter sidebar.
  // Try several possible trigger texts/attributes.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const triggers = ['选项', '筛选', 'Options', 'Filter'];
      for (const text of triggers) {
        for (const el of document.querySelectorAll('button, span, div, a')) {
          if (el.textContent.trim() === text && el.offsetParent !== null) {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return `clicked: "${text}"`;
          }
        }
      }
      // Also try aria-label
      const byAria = document.querySelector('[aria-label="筛选"], [aria-label="选项"]');
      if (byAria) { byAria.click(); return 'clicked aria'; }
      return 'no trigger';
    },
  }).catch(() => {});
  await sleep(rand(800, 1400));

  // ── Step 2: click "最新" inside the sort section ──────────────────
  const sortResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Look for the sort section (排序依据) and click 最新 within it
      const allEls = [...document.querySelectorAll('span, div, button, a, li')];
      // First try: element whose full text is exactly 最新
      const exact = allEls.filter(el =>
        el.textContent.trim() === '最新' && el.offsetParent !== null
      );
      if (exact.length > 0) {
        // Prefer smaller elements (avoid clicking a container)
        exact.sort((a, b) =>
          (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight)
        );
        exact[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return `最新 clicked (${exact[0].tagName})`;
      }
      return '最新 not found';
    },
  }).catch(() => []);
  console.log(`[XHS] ${sortResult?.[0]?.result}`);
  await sleep(rand(700, 1300));

  // ── Step 3: click the date option inside "发布时间" section ─────────
  // NOTE: Do NOT clear __xhsLinks here. Clearing before the filter click
  // means if the click fails (panel not open for kw2+), no API calls happen
  // and __xhsLinks stays empty → collected=0. The clear happens correctly
  // after returning from each note page (in processKeyword).
  const dateResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: (targetText) => {
      const allEls = [...document.querySelectorAll('span, div, button, a, li, section')];

      // Strategy A: find 发布时间 container, click option within it
      const dateSection = allEls.find(el =>
        el.textContent.includes('发布时间') &&
        el.offsetParent !== null &&
        el.offsetWidth < 600 // not the entire page
      );
      if (dateSection) {
        const opts = [...dateSection.querySelectorAll('span, div, button, a, li')].filter(el =>
          el.textContent.trim() === targetText && el.offsetParent !== null
        );
        if (opts.length > 0) {
          opts[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return `A: clicked in 发布时间 section (${opts[0].tagName}.${opts[0].className})`;
        }
      }

      // Strategy B: full-page search, pick smallest visible element matching text
      const matches = allEls.filter(el =>
        el.textContent.trim() === targetText && el.offsetParent !== null
      );
      if (matches.length === 0) return `not found: "${targetText}"`;
      matches.sort((a, b) =>
        (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight)
      );
      matches[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return `B: clicked globally (${matches[0].tagName}.${matches[0].className})`;
    },
    args: [buttonText],
  }).catch(() => []);
  console.log(`[XHS] Date filter "${buttonText}": ${dateResult?.[0]?.result}`);

  // If date option not found on first try, the panel may not have opened yet.
  // Wait and retry once.
  if (!dateResult?.[0]?.result?.startsWith('A') && !dateResult?.[0]?.result?.startsWith('B')) {
    await sleep(2000);
    const retry = await chrome.scripting.executeScript({
      target: { tabId },
      func: (targetText) => {
        const matches = [...document.querySelectorAll('span, div, button, a, li')].filter(el =>
          el.textContent.trim() === targetText && el.offsetParent !== null
        );
        if (matches.length === 0) return 'retry: not found';
        matches.sort((a, b) => (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight));
        matches[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return `retry: clicked (${matches[0].tagName})`;
      },
      args: [buttonText],
    }).catch(() => []);
    console.log(`[XHS] Date filter retry: ${retry?.[0]?.result}`);
  }

  // ── Step 5: wait for XHS to reload with filter applied ────────────
  await sleep(rand(3500, 5500));
}

/**
 * Read note links captured by interceptor.js (window.__xhsLinks).
 * Returns [{id, url, time}] where time is Unix ms (0 = unknown).
 */
async function getCapturedLinks(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const links = window.__xhsLinks || {};
        return Object.entries(links).map(([id, val]) => ({
          id,
          // Support old string format for safety
          url:  typeof val === 'string' ? val : val.url,
          time: typeof val === 'string' ? 0   : (val.time || 0),
        }));
      },
    });
    return results[0]?.result || [];
  } catch {
    return [];
  }
}

/**
 * Pre-filter a captured link by its API timestamp before visiting.
 * Returns true if the note is within the date range (should be visited).
 * If time is 0 (unknown), we let it through and rely on the post-visit filter.
 */
function passesTimePreFilter(timeMs, dateFilter) {
  if (!dateFilter || !timeMs) return true; // no filter or unknown time
  const cutoff = Date.now() - dateFilter * 24 * 60 * 60 * 1000;
  return timeMs >= cutoff;
}

/**
 * Human-like scrolling: several irregular small scrolls, optional scroll-back.
 * Replaces the old single scrollBy(800).
 */
async function humanScroll(tabId) {
  const passes = 2 + Math.floor(Math.random() * 3); // 2–4 scroll steps
  for (let i = 0; i < passes; i++) {
    const amt = Math.round(rand(250, 750));
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (a) => window.scrollBy({ top: a, behavior: 'smooth' }),
      args: [amt],
    }).catch(() => {});
    await sleep(rand(600, 1600)); // pause between scroll steps
  }
  // 25% chance: scroll back up a little (real user re-reads or misses a card)
  if (Math.random() < 0.25) {
    const up = Math.round(rand(80, 250));
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (a) => window.scrollBy({ top: -a, behavior: 'smooth' }),
      args: [up],
    }).catch(() => {});
    await sleep(rand(400, 900));
  }
  await sleep(rand(800, 2000)); // settle after scroll sequence
}

/**
 * Scrape the note content from the current page.
 */
async function scrapeCurrentPage(tabId, keyword, noteId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (kw, expectedId) => {
      const match = location.pathname.match(/\/explore\/([0-9a-zA-Z]+)/);
      if (!match) return null;
      if (expectedId && match[1] !== expectedId) return null;

      if (location.pathname.includes('/404') ||
          document.title.includes('404') ||
          document.querySelector('.error-page')) {
        return null;
      }

      const noteId = match[1];

      function parseCount(el) {
        if (!el) return 0;
        const text = (el.textContent || '').trim().replace(/[,，]/g, '');
        if (text.endsWith('万')) return Math.round(parseFloat(text) * 10000);
        return parseInt(text) || 0;
      }

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
      const authorIdMatch = authorHref.match(/\/user\/profile\/([0-9a-zA-Z]+)/);
      const authorId = authorIdMatch?.[1] || '';

      const likes = parseCount(
        document.querySelector('.like-wrapper .count') ||
        document.querySelector('[class*="like"] .count')
      );
      const collects = parseCount(
        document.querySelector('.collect-wrapper .count') ||
        document.querySelector('[class*="collect"] .count')
      );

      // Collect candidate date strings; validate they look like XHS date formats
      // before accepting. Avoids picking up geo labels or other garbage text.
      const DATE_RE = /^(刚刚|\d+\s*分钟前|\d+\s*小时前|昨天|\d+\s*天前|\d{1,2}-\d{2}|\d{4}-\d{2}-\d{2})$/;
      let publishDate = '';
      const dateCandidates = [
        document.querySelector('.note-content .date'),
        document.querySelector('time'),
        // Only use class*=date fallback if the extracted text is a real date string
        ...[...document.querySelectorAll('[class*="date"]')],
      ];
      for (const el of dateCandidates) {
        if (!el) continue;
        const t = el.textContent?.trim() || '';
        if (DATE_RE.test(t)) { publishDate = t; break; }
      }

      const commentEls = document.querySelectorAll('.comment-item, .comments-el');
      const comments = [];
      commentEls.forEach((el, idx) => {
        if (idx >= 10) return;
        const c = (
          el.querySelector('.content') ||
          el.querySelector('.comment-content')
        )?.textContent?.trim() || '';
        const cl = parseCount(
          el.querySelector('.like-count') ||
          el.querySelector('[class*="like"]')
        );
        comments.push({
          id: `${noteId}_c_${idx + 1}`,
          note_id: noteId,
          content: c,
          likes: cl,
          rank: idx + 1,
        });
      });

      return {
        id: noteId, keyword: kw, title, content, author, author_id: authorId,
        likes, collects, publish_date: publishDate, url: location.href,
        source: 'dom', comments,
      };
    },
    args: [keyword, noteId],
  });
  return results[0]?.result || null;
}

/**
 * Parse XHS publish_date strings into "days ago" (float).
 */
function parseDaysAgo(publishDate) {
  if (!publishDate) return Infinity;
  const s = publishDate.trim();
  const now = new Date();

  if (s === '刚刚') return 0;

  let m;
  m = s.match(/^(\d+)\s*分钟前$/);
  if (m) return parseInt(m[1]) / (60 * 24);

  m = s.match(/^(\d+)\s*小时前$/);
  if (m) return parseInt(m[1]) / 24;

  if (s === '昨天') return 1;

  m = s.match(/^(\d+)\s*天前$/);
  if (m) return parseInt(m[1]);

  m = s.match(/^(\d{1,2})-(\d{2})$/);
  if (m) {
    const d = new Date(now.getFullYear(), parseInt(m[1]) - 1, parseInt(m[2]));
    if (d > now) d.setFullYear(d.getFullYear() - 1);
    return (now - d) / 86400000;
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    return (now - d) / 86400000;
  }

  return Infinity;
}

/** POST a batch of notes to the backend. */
async function pushNotes(notes, taskId) {
  const body = { notes };
  if (taskId) body.task_id = taskId;
  const resp = await fetch(`${CONFIG.BACKEND_URL}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Backend error: ${resp.status}`);
  return resp.json();
}

/**
 * Process one keyword.
 *
 * Timing per note (approximate):
 *   • readingDelay on note page:  5–40s
 *   • settle after returning:     1.5–4s
 *   • browsingDelay between notes: DELAY_MIN–DELAY_MAX
 *   • occasional rest break:      25–60s every 5–9 notes
 *
 * Per-keyword total for 20 notes ≈ 5–15 minutes.
 */
async function processKeyword(tabId, keyword, maxNotes, dateFilter = 0, totalDoneSoFar = 0) {
  // When date-filtering, add sort=time_descending so XHS returns newest first
  const sortQs = dateFilter > 0 ? '&sort=time_descending' : '';
  const searchUrl =
    `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51${sortQs}`;

  await chrome.tabs.update(tabId, { url: searchUrl });
  await waitForLoad(tabId);
  await settleDelay(3000, 6000); // let XHS fire its initial search API call

  // Click XHS's own date filter so only qualifying notes reach interceptor.js
  if (dateFilter > 0) {
    sendProgress(`关键词「${keyword}」: 正在设置日期筛选…`);
    await applyXHSDateFilter(tabId, dateFilter);
  }

  const collected = [];
  const seenIds = new Set();
  let noNewRounds = 0;
  const MAX_NO_NEW = 8;
  let notesThisKeyword = 0;

  while (collected.length < maxNotes) {
    if (stopRequested) break;

    const links = await getCapturedLinks(tabId);
    console.log(`[XHS] Captured=${links.length} seen=${seenIds.size} collected=${collected.length}`);
    const newLinks = links.filter(l => !seenIds.has(l.id));

    if (newLinks.length === 0) {
      noNewRounds++;
      if (noNewRounds >= MAX_NO_NEW) {
        console.log('[XHS] No new links after scrolling, stopping.');
        break;
      }
      await humanScroll(tabId);
      continue;
    }

    noNewRounds = 0;

    for (const { id: noteId, url: noteUrl, time: noteTime } of newLinks) {
      if (stopRequested || collected.length >= maxNotes) break;
      seenIds.add(noteId);

      // Pre-filter by API timestamp — avoids visiting notes that are already too old
      if (!passesTimePreFilter(noteTime, dateFilter)) {
        const d = noteTime ? new Date(noteTime).toISOString().slice(0, 10) : '?';
        console.log(`[XHS] Pre-skip (API time ${d} > ${dateFilter}d cutoff): ${noteId}`);
        continue;
      }

      // 8% chance: skip this note (simulate user glancing past it)
      if (Math.random() < 0.08) {
        console.log(`[XHS] Skipping (simulated) ${noteId}`);
        continue;
      }

      sendProgress(`关键词「${keyword}」: 正在抓取 ${collected.length + 1}/${maxNotes}…`);
      console.log(`[XHS] → ${noteUrl.slice(0, 100)}`);

      try {
        await chrome.tabs.update(tabId, { url: noteUrl });
        await waitForLoad(tabId);

        // Simulate reading the note
        await readingDelay();

        // 30% chance: scroll down on the note page (reading comments / body)
        if (Math.random() < 0.30) {
          await humanScroll(tabId);
        }

        const tab = await chrome.tabs.get(tabId);
        console.log(`[XHS] Landed: ${tab.url?.slice(0, 100)}`);

        if (tab.url && tab.url.includes('/explore/')) {
          const note = await scrapeCurrentPage(tabId, keyword, noteId);
          if (!note) {
            console.warn('[XHS] Scrape null:', noteId);
          } else {
            const daysAgo = parseDaysAgo(note.publish_date);
            if (dateFilter > 0 && Number.isFinite(daysAgo) && daysAgo > dateFilter) {
              console.log(`[XHS] Skip date (${daysAgo.toFixed(1)}d > ${dateFilter}d): "${note.publish_date}"`);
            } else {
              collected.push(note);
              notesThisKeyword++;
              console.log(`[XHS] OK: "${note.title}" likes=${note.likes}`);
            }
          }
        } else {
          console.warn('[XHS] Not on note page:', tab.url);
        }

        // Return to search page; clear stale links so each round starts fresh
        await chrome.tabs.update(tabId, { url: searchUrl });
        await waitForLoad(tabId);
        if (dateFilter > 0) {
          await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: () => { window.__xhsLinks = {}; },
          }).catch(() => {});
        }
        await settleDelay(1500, 4500);

      } catch (e) {
        console.warn('[XHS] Error on note', noteId, ':', e.message);
        await chrome.tabs.update(tabId, { url: searchUrl }).catch(() => {});
        await waitForLoad(tabId);
        if (dateFilter > 0) {
          await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: () => { window.__xhsLinks = {}; },
          }).catch(() => {});
        }
        await settleDelay(3000, 7000);
      }

      // Main between-note browsing delay
      await browsingDelay();

      // Periodic rest break (based on total notes done across all keywords)
      await maybeRest(totalDoneSoFar + notesThisKeyword);
    }
  }

  return collected;
}

/** Create a task record in the backend. */
async function createTaskRecord(keywords, total, dateFilter) {
  try {
    const resp = await fetch(`${CONFIG.BACKEND_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, total, date_filter: dateFilter || 0 }),
    });
    const data = await resp.json();
    return data.id || null;
  } catch {
    return null;
  }
}

/** Update task progress/status in the backend. */
async function updateTaskRecord(taskId, patch) {
  if (!taskId) return;
  await fetch(`${CONFIG.BACKEND_URL}/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

/** Main task runner — processes all keywords sequentially. */
async function runTask(keywords, maxNotes, dateFilter = 0) {
  stopRequested = false;
  nextBreakAt = Math.floor(rand(BREAK_EVERY_MIN, BREAK_EVERY_MAX)); // reset break counter
  chrome.storage.local.set({ taskRunning: true });

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const tabId = tab.id;
  let totalDone = 0;

  const taskId = await createTaskRecord(keywords, keywords.length * maxNotes, dateFilter);

  try {
    for (let kwIdx = 0; kwIdx < keywords.length; kwIdx++) {
      if (stopRequested) break;
      const keyword = keywords[kwIdx];
      sendProgress(`开始处理关键词「${keyword}」…`);

      const collected = await processKeyword(tabId, keyword, maxNotes, dateFilter, totalDone);

      if (collected.length > 0) {
        try {
          await pushNotes(collected, taskId);
          totalDone += collected.length;
          await updateTaskRecord(taskId, { done: totalDone });
          sendProgress(`关键词「${keyword}」完成，共 ${collected.length} 篇`);
        } catch (e) {
          console.error('[XHS] Backend push failed:', e);
          sendProgress(`关键词「${keyword}」推送后端失败: ${e.message}`);
        }
      } else {
        sendProgress(`关键词「${keyword}」未抓取到数据`);
      }

      // Inter-keyword break (skip after last keyword)
      if (kwIdx < keywords.length - 1 && !stopRequested) {
        const kwBreak = rand(45000, 100000); // 45–100s between keywords
        console.log(`[XHS] Inter-keyword break ${Math.round(kwBreak / 1000)}s`);
        sendProgress(`关键词切换中，休息 ${Math.round(kwBreak / 1000)}s…`);
        await sleep(kwBreak);
      }
    }
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
    await updateTaskRecord(taskId, { status: stopRequested ? 'stopped' : 'done', done: totalDone });
    sendDone(`采集完成！共采集 ${totalDone} 篇笔记`);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_TASK') runTask(msg.keywords, msg.maxNotes, msg.dateFilter || 0);
  if (msg.type === 'STOP_TASK') stopRequested = true;
});
