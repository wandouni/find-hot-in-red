/**
 * XHS Token Interceptor — runs in MAIN world at document_start,
 * BEFORE any XHS JavaScript loads and caches fetch/XHR references.
 *
 * Wraps window.fetch and XMLHttpRequest so every JSON response is
 * scanned for xsec_token. Results are stored in window.__xhsLinks
 * (a map of noteId → full URL with token) for background.js to read.
 */
(function () {
  window.__xhsLinks = window.__xhsLinks || {};

  function extractTokens(data) {
    try {
      const items = data?.data?.items ?? data?.items ?? [];
      if (!Array.isArray(items) || items.length === 0) return;
      let captured = 0;
      items.forEach(item => {
        const id = item?.id || item?.note_id;
        // XHS places xsec_token at the item top level or inside note_card
        const token =
          item?.xsec_token ??
          item?.note_card?.xsec_token ??
          item?.noteCard?.xsec_token;
        if (id && token) {
          window.__xhsLinks[id] =
            'https://www.xiaohongshu.com/explore/' + id +
            '?xsec_token=' + encodeURIComponent(token) +
            '&xsec_source=pc_search';
          captured++;
        }
      });
      if (captured > 0) {
        console.log('[XHS-intercept] captured ' + captured + ' tokens, total=' +
          Object.keys(window.__xhsLinks).length);
      }
    } catch {}
  }

  /* ── Wrap window.fetch ──────────────────────────────────────────── */
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await _fetch.apply(this, args);
    resp.clone().json().then(extractTokens).catch(() => {});
    return resp;
  };

  /* ── Wrap XMLHttpRequest ────────────────────────────────────────── */
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try { extractTokens(JSON.parse(this.responseText)); } catch {}
    });
    return _send.apply(this, args);
  };
})();
