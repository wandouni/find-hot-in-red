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

/**
 * Read note links captured by interceptor.js (window.__xhsLinks).
 */
async function getCapturedLinks(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const links = window.__xhsLinks || {};
        return Object.entries(links).map(([id, url]) => ({ id, url }));
      },
    });
    return results[0]?.result || [];
  } catch {
    return [];
  }
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

      const dateEl =
        document.querySelector('.note-content .date') ||
        document.querySelector('time') ||
        document.querySelector('[class*="date"]');
      const publishDate = dateEl?.textContent?.trim() || '';

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
  const searchUrl =
    `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`;

  await chrome.tabs.update(tabId, { url: searchUrl });
  await waitForLoad(tabId);
  await settleDelay(3000, 6000); // longer settle — let XHS fire its initial API calls

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

    for (const { id: noteId, url: noteUrl } of newLinks) {
      if (stopRequested || collected.length >= maxNotes) break;
      seenIds.add(noteId);

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
          } else if (dateFilter > 0 && parseDaysAgo(note.publish_date) > dateFilter) {
            console.log(`[XHS] Skip date (>${dateFilter}d): "${note.publish_date}"`);
          } else {
            collected.push(note);
            notesThisKeyword++;
            console.log(`[XHS] OK: "${note.title}" likes=${note.likes}`);
          }
        } else {
          console.warn('[XHS] Not on note page:', tab.url);
        }

        // Return to search page
        await chrome.tabs.update(tabId, { url: searchUrl });
        await waitForLoad(tabId);
        await settleDelay(1500, 4500);

      } catch (e) {
        console.warn('[XHS] Error on note', noteId, ':', e.message);
        await chrome.tabs.update(tabId, { url: searchUrl }).catch(() => {});
        await waitForLoad(tabId);
        await settleDelay(3000, 7000); // longer recovery after error
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
