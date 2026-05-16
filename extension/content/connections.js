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
    const pagePath = window.location.pathname;

    // On the connections page — all links are 1st degree
    if (pagePath.includes('/mynetwork/invite-connect/connections') ||
        pagePath.includes('/mynetwork/connections')) {
      return getAllProfileLinks();
    }

    // On search results — only pick profiles with "1st" badge
    if (pagePath.includes('/search/results/people')) {
      return getFirstDegreeFromSearch();
    }

    // Fallback: any page with LinkedIn profiles
    return getFirstDegreeFromAnyPage();
  }

  function getAllProfileLinks() {
    const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    const urls = [];
    const seen = new Set();

    for (const link of links) {
      const href = normalizeProfileUrl(link.href);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      urls.push(href);
    }

    return urls;
  }

  function getFirstDegreeFromSearch() {
    const cards = document.querySelectorAll(
      '.reusable-search__result-container, [data-chameleon-result-urn], li[data-view-name*="search"]'
    );
    const urls = [];
    const seen = new Set();

    for (const card of cards) {
      const cardText = card.textContent || '';
      
      // Check if this card shows "1st" degree connection
      // LinkedIn shows "• 1st" or "· 1st" next to the name, or has a "Message" button
      const isFirstDegree = 
        /[•·]\s*1st/i.test(cardText) ||
        /\b1st\b/i.test(cardText) ||
        card.querySelector('button[aria-label*="Message"]') !== null;

      if (!isFirstDegree) continue;

      const link = card.querySelector('a[href*="/in/"]');
      if (!link) continue;

      const href = normalizeProfileUrl(link.href);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      urls.push(href);
    }

    return urls;
  }

  function getFirstDegreeFromAnyPage() {
    const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    const urls = [];
    const seen = new Set();

    for (const link of links) {
      const container = link.closest('li') ||
        link.closest('.mn-connection-card') ||
        link.closest('.reusable-search__result-container') ||
        link.closest('[data-chameleon-result-urn]');
      
      if (!container) continue;

      const text = (container.textContent || '').toLowerCase();
      const isFirstDegree = 
        text.includes('1st') || 
        text.includes('message') ||
        container.querySelector('button[aria-label*="Message"]') !== null;

      if (!isFirstDegree) continue;

      const href = normalizeProfileUrl(link.href);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      urls.push(href);
    }

    return urls;
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
