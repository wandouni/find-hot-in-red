// Injected into xiaohongshu.com pages by manifest content_scripts
// Also called directly via chrome.scripting.executeScript from background.js

/**
 * Scrape the current note detail page.
 * Returns a note object or null if this page is not a note detail page.
 */
function scrapeCurrentNote(keyword) {
  // Note detail URL pattern: /explore/<note_id>
  const match = location.pathname.match(/\/explore\/([a-f0-9]+)/);
  if (!match) return null;

  const noteId = match[1];
  const url = location.href;

  // Title
  const titleEl = document.querySelector('#detail-title') ||
                  document.querySelector('.note-content .title') ||
                  document.querySelector('h1');
  const title = titleEl?.textContent?.trim() || '';

  // Content / body
  const contentEl = document.querySelector('#detail-desc') ||
                    document.querySelector('.note-content .desc') ||
                    document.querySelector('.content');
  const content = contentEl?.textContent?.trim() || '';

  // Author
  const authorEl = document.querySelector('.author-wrapper .name') ||
                   document.querySelector('.username');
  const author = authorEl?.textContent?.trim() || '';

  const authorLinkEl = document.querySelector('.author-wrapper a') ||
                       document.querySelector('a.author');
  const authorHref = authorLinkEl?.href || '';
  const authorIdMatch = authorHref.match(/\/user\/profile\/([a-f0-9]+)/);
  const authorId = authorIdMatch ? authorIdMatch[1] : '';

  // Engagement counts
  function parseCount(el) {
    if (!el) return 0;
    const text = el.textContent?.trim().replace(/[,，]/g, '') || '0';
    if (text.endsWith('万')) return Math.round(parseFloat(text) * 10000);
    return parseInt(text) || 0;
  }

  const likeEl = document.querySelector('.like-wrapper .count') ||
                 document.querySelector('[class*="like"] span');
  const collectEl = document.querySelector('.collect-wrapper .count') ||
                    document.querySelector('[class*="collect"] span');
  const likes = parseCount(likeEl);
  const collects = parseCount(collectEl);

  // Publish date
  const dateEl = document.querySelector('.date') ||
                 document.querySelector('time') ||
                 document.querySelector('[class*="date"]');
  const publishDate = dateEl?.textContent?.trim() || '';

  // Comments (top N by rank in DOM)
  const commentEls = document.querySelectorAll('.comment-item, .comments-el');
  const comments = [];
  commentEls.forEach((el, idx) => {
    if (idx >= 10) return;
    const commentContentEl = el.querySelector('.content, .comment-content');
    const commentLikeEl = el.querySelector('.like-count, [class*="like"]');
    const commentContent = commentContentEl?.textContent?.trim() || '';
    const commentLikes = parseCount(commentLikeEl);
    const commentId = `${noteId}_c_${idx + 1}`;
    comments.push({
      id: commentId,
      note_id: noteId,
      content: commentContent,
      likes: commentLikes,
      rank: idx + 1,
    });
  });

  return {
    id: noteId,
    keyword: keyword || '',
    title,
    content,
    author,
    author_id: authorId,
    likes,
    collects,
    publish_date: publishDate,
    url,
    source: 'dom',
    comments,
  };
}

// Listen for messages from background.js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SCRAPE_NOTE') {
    const note = scrapeCurrentNote(msg.keyword);
    sendResponse({ note });
  }
  return true; // keep channel open for async
});
