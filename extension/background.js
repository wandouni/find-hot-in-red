// Service worker — handles task queue and tab orchestration
// Token interception is handled by interceptor.js (document_start, MAIN world)
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

/** Wait for a tab to reach status='complete', with timeout fallback. */
function waitForLoad(tabId, timeout = 15000) {
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
 * interceptor.js runs in MAIN world at document_start and wraps
 * window.fetch/XHR to extract xsec_token from XHS API responses.
 * We must also use world:'MAIN' here to read from the same window object.
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

/** Scroll down to trigger XHS lazy-loading and new API calls. */
async function scrollAndWait(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.scrollBy({ top: 800, behavior: 'smooth' }),
  }).catch(() => {});
  await sleep(2500);
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

/** POST a batch of notes to the backend. */
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
 * Process one keyword.
 *
 * interceptor.js (document_start, MAIN world) has already wrapped fetch/XHR
 * on this tab and is populating window.__xhsLinks with token URLs as XHS
 * makes its search API calls. We poll that map, then navigate directly.
 */
async function processKeyword(tabId, keyword, maxNotes) {
  const searchUrl =
    `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`;

  await chrome.tabs.update(tabId, { url: searchUrl });
  await waitForLoad(tabId);
  await sleep(3000); // wait for XHS initial API call to complete

  const collected = [];
  const seenIds = new Set();
  let noNewRounds = 0;
  const MAX_NO_NEW = 6;

  while (collected.length < maxNotes) {
    if (stopRequested) break;

    const links = await getCapturedLinks(tabId);
    console.log(`[XHS] Captured=${links.length} seen=${seenIds.size}`);
    const newLinks = links.filter(l => !seenIds.has(l.id));

    if (newLinks.length === 0) {
      noNewRounds++;
      if (noNewRounds >= MAX_NO_NEW) {
        console.log('[XHS] No new links after scrolling, stopping.');
        break;
      }
      await scrollAndWait(tabId);
      continue;
    }

    noNewRounds = 0;

    for (const { id: noteId, url: noteUrl } of newLinks) {
      if (stopRequested || collected.length >= maxNotes) break;
      seenIds.add(noteId);

      sendProgress(`关键词「${keyword}」: 正在抓取 ${collected.length + 1}/${maxNotes}...`);
      console.log(`[XHS] → ${noteUrl.slice(0, 100)}`);

      try {
        await chrome.tabs.update(tabId, { url: noteUrl });
        await waitForLoad(tabId);
        await sleep(2500);

        const tab = await chrome.tabs.get(tabId);
        console.log(`[XHS] Landed: ${tab.url?.slice(0, 100)}`);

        if (tab.url && tab.url.includes('/explore/')) {
          const note = await scrapeCurrentPage(tabId, keyword, noteId);
          if (note) {
            collected.push(note);
            console.log(`[XHS] OK: "${note.title}" likes=${note.likes}`);
          } else {
            console.warn('[XHS] Scrape null:', noteId);
          }
        } else {
          console.warn('[XHS] Not on note page:', tab.url);
        }

        // Return to search page — interceptor.js auto-re-injects on new page load
        await chrome.tabs.update(tabId, { url: searchUrl });
        await waitForLoad(tabId);
        await sleep(2000);

      } catch (e) {
        console.warn('[XHS] Error on note', noteId, ':', e.message);
        await chrome.tabs.update(tabId, { url: searchUrl }).catch(() => {});
        await waitForLoad(tabId);
        await sleep(3000);
      }

      await randomDelay();
    }
  }

  return collected;
}

/** Main task runner — processes all keywords sequentially. */
async function runTask(keywords, maxNotes) {
  stopRequested = false;
  chrome.storage.local.set({ taskRunning: true });

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const tabId = tab.id;
  let totalDone = 0;

  try {
    for (const keyword of keywords) {
      if (stopRequested) break;
      sendProgress(`开始处理关键词「${keyword}」...`);

      const collected = await processKeyword(tabId, keyword, maxNotes);

      if (collected.length > 0) {
        try {
          await pushNotes(collected);
          totalDone += collected.length;
          sendProgress(`关键词「${keyword}」完成，共 ${collected.length} 篇`);
        } catch (e) {
          console.error('[XHS] Backend push failed:', e);
          sendProgress(`关键词「${keyword}」推送后端失败: ${e.message}`);
        }
      } else {
        sendProgress(`关键词「${keyword}」未抓取到数据`);
      }
    }
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
    sendDone(`采集完成！共采集 ${totalDone} 篇笔记`);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_TASK') runTask(msg.keywords, msg.maxNotes);
  if (msg.type === 'STOP_TASK') stopRequested = true;
});
