(function () {
  if (window.__mailivoxConnectionsLoaded) return;
  window.__mailivoxConnectionsLoaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'getConnectionUrls') {
      sendResponse({ connections: getConnectionUrls() });
      return true;
    }
    return false;
  });

  function getConnectionUrls() {
    const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    const urls = [];
    const seen = new Set();

    for (const link of links) {
      const href = normalizeProfileUrl(link.href);
      if (!href || seen.has(href)) continue;
      if (!looksLikeConnection(link)) continue;
      seen.add(href);
      urls.push(href);
    }

    return urls;
  }

  function looksLikeConnection(link) {
    const pagePath = window.location.pathname;
    if (pagePath.includes('/mynetwork/invite-connect/connections')) return true;

    const container = link.closest('li, .mn-connection-card, .reusable-search__result-container');
    const text = (container?.textContent || '').replace(/\s+/g, ' ').toLowerCase();
    return text.includes('1st') || text.includes('message');
  }

  function normalizeProfileUrl(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      const match = parsed.pathname.match(/\/in\/[^/?#]+/);
      return match ? `https://www.linkedin.com${match[0]}/` : '';
    } catch (_) {
      return '';
    }
  }
})();
