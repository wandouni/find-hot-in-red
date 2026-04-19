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
 * Inject a fetch/XHR interceptor into the page's MAIN world.
 * XHS stores xsec_token inside its search-result API responses.
 * We capture every response and extract { noteId → fullUrl } pairs,
 * storing them in window.__xhsLinks so background.js can read them.
 *
 * Must run in world:'MAIN' to access the page's real fetch/XHR.
 */
async function injectTokenInterceptor(tabId) {
  // Guard: don't inject into about:blank or other non-XHS pages
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !tab.url.includes('xiaohongshu.com')) {
      console.warn('[XHS] Skipping interceptor injection, tab URL:', tab.url);
      return;
    }
  } catch {
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      if (window.__xhsIntercepted) return;
      window.__xhsIntercepted = true;
      window.__xhsLinks = window.__xhsLinks || {};

      function extractTokens(data) {
        try {
          // Log top-level keys to understand XHS API response structure
          const topKeys = Object.keys(data || {});
          console.log('[XHS-intercept] response keys:', JSON.stringify(topKeys));

          // XHS search API wraps items in data.items or data.data.items
          const items = data?.data?.items ?? data?.items ?? [];
          if (!Array.isArray(items)) {
            console.log('[XHS-intercept] items not array, data.data:', JSON.stringify(data?.data)?.slice(0, 200));
            return;
          }
          console.log('[XHS-intercept] found', items.length, 'items');
          items.forEach((item, i) => {
            // Log first item structure to diagnose token field location
            if (i === 0) {
              console.log('[XHS-intercept] item[0] keys:', JSON.stringify(Object.keys(item || {})));
              console.log('[XHS-intercept] item[0] sample:', JSON.stringify(item)?.slice(0, 300));
            }
            // Token may be at top level or inside note_card
            const id = item?.id || item?.note_id;
            const token = item?.xsec_token ?? item?.note_card?.xsec_token;
            if (id && token) {
              window.__xhsLinks[id] =
                `https://www.xiaohongshu.com/explore/${id}` +
                `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_search`;
              console.log('[XHS-intercept] captured', id, 'token=', token.slice(0, 10) + '...');
            } else {
              if (id) console.log('[XHS-intercept] id', id, 'but no token, item.xsec_token=', item?.xsec_token);
            }
          });
        } catch (e) {
          console.log('[XHS-intercept] extractTokens error:', e.message);
        }
      }

      // Wrap fetch
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const resp = await origFetch.apply(this, args);
        resp.clone().json().then(extractTokens).catch(() => {});
        return resp;
      };

      // Wrap XHR
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__url = url;
        return origOpen.call(this, method, url, ...rest);
      };
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', () => {
          try { extractTokens(JSON.parse(this.responseText)); } catch {}
        });
        return origSend.apply(this, args);
      };
    },
  });
}

/**
 * Read the captured note links from window.__xhsLinks (injected above).
 * Returns an array of { id, url } objects.
 */
async function getCapturedLinks(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const links = window.__xhsLinks || {};
      return Object.entries(links).map(([id, url]) => ({ id, url }));
    },
  });
  return results[0]?.result || [];
}

/**
 * Scroll to the bottom of the page to trigger XHS lazy-loading more results.
 * XHS fires API calls on scroll, which our interceptor captures.
 */
async function scrollAndWait(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.scrollBy({ top: 800, behavior: 'smooth' }),
  });
  await sleep(2500); // wait for XHS API response and render
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
 * Process one keyword.
 *
 * Strategy: inject a fetch interceptor into the search page's MAIN world.
 * XHS's search API returns xsec_token per note in its JSON response.
 * We capture those tokens and navigate directly to the full URL — no
 * clicking required, no isTrusted concerns.
 */
async function processKeyword(tabId, keyword, maxNotes) {
  const searchUrl =
    `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`;

  await chrome.tabs.update(tabId, { url: searchUrl });
  await waitForLoad(tabId);
  await sleep(3000); // wait for initial render + first API call

  // Inject the token interceptor into the page's JS context
  await injectTokenInterceptor(tabId);

  const collected = [];
  const seenIds = new Set();
  let noNewRounds = 0;
  const MAX_NO_NEW = 6;

  while (collected.length < maxNotes) {
    if (stopRequested) break;

    // Read URLs that the interceptor has captured so far
    const links = await getCapturedLinks(tabId);
    console.log(`[XHS] Total captured links: ${links.length}, seenIds: ${seenIds.size}`);
    const newLinks = links.filter(l => !seenIds.has(l.id));

    if (newLinks.length === 0) {
      noNewRounds++;
      if (noNewRounds >= MAX_NO_NEW) {
        console.log('[XHS] No new links after scrolling, done.');
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
      console.log(`[XHS] Navigating to: ${noteUrl}`);

      try {
        // Navigate directly using the full URL (with xsec_token from interceptor)
        await chrome.tabs.update(tabId, { url: noteUrl });
        await waitForLoad(tabId);
        await sleep(2500); // wait for SPA render

        const tab = await chrome.tabs.get(tabId);
        console.log(`[XHS] Landed on: ${tab.url}`);

        if (tab.url && tab.url.includes('/explore/')) {
          const note = await scrapeCurrentPage(tabId, keyword, noteId);
          if (note) {
            collected.push(note);
            console.log(`[XHS] OK: "${note.title}" likes=${note.likes}`);
          } else {
            console.warn('[XHS] Scrape null for:', noteId);
          }
        } else {
          console.warn('[XHS] Not on note page:', tab.url);
        }

        // Return to search page (re-inject interceptor since page reloaded)
        await chrome.tabs.update(tabId, { url: searchUrl });
        await waitForLoad(tabId);
        await sleep(2000);
        await injectTokenInterceptor(tabId); // re-inject after reload

      } catch (e) {
        console.warn('[XHS] Error on note', noteId, ':', e.message);
        await chrome.tabs.update(tabId, { url: searchUrl }).catch(() => {});
        await waitForLoad(tabId);
        await sleep(3000);
        await injectTokenInterceptor(tabId);
      }

      await randomDelay();
    }
  }

  return collected;
}

/**
 * Main task runner — processes all keywords sequentially.
 */
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
          console.error('Backend push failed:', e);
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

// Message handler
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_TASK') {
    runTask(msg.keywords, msg.maxNotes);
  }
  if (msg.type === 'STOP_TASK') {
    stopRequested = true;
  }
});
