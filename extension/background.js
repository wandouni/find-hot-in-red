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
