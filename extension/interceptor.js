/**
 * XHS Token Interceptor — runs in MAIN world at document_start,
 * BEFORE any XHS JavaScript loads and caches fetch/XHR references.
 *
 * Wraps window.fetch and XMLHttpRequest so every JSON response is
 * scanned for xsec_token AND publish timestamp.
 *
 * Results stored in window.__xhsLinks: { noteId → { url, time } }
 *   url  — full explore URL with xsec_token
 *   time — publish time as Unix milliseconds (0 if unknown)
 */
(function () {
  window.__xhsLinks = window.__xhsLinks || {};

  /** Normalize XHS timestamp to milliseconds. */
  function toMs(t) {
    if (!t) return 0;
    const n = Number(t);
    if (isNaN(n) || n <= 0) return 0;
    // XHS uses ms timestamps (~13 digits); seconds would be < 10^12
    return n < 1_000_000_000_000 ? n * 1000 : n;
  }

  function extractTokens(data) {
    try {
      const items = data?.data?.items ?? data?.items ?? [];
      if (!Array.isArray(items) || items.length === 0) return;
      let captured = 0;
      items.forEach(item => {
        const id = item?.id || item?.note_id;
        const card = item?.note_card ?? item?.noteCard ?? {};

        const token =
          item?.xsec_token ??
          card?.xsec_token;

        // Publish time: try several known field locations
        const rawTime =
          card?.time ??
          card?.create_time ??
          card?.last_update_time ??
          item?.time ??
          item?.create_time ??
          0;

        if (id && token) {
          window.__xhsLinks[id] = {
            url: 'https://www.xiaohongshu.com/explore/' + id +
                 '?xsec_token=' + encodeURIComponent(token) +
                 '&xsec_source=pc_search',
            time: toMs(rawTime),
          };
          captured++;
        }
      });
      if (captured > 0) {
        console.log('[XHS-intercept] captured ' + captured +
          ' tokens, total=' + Object.keys(window.__xhsLinks).length);
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
