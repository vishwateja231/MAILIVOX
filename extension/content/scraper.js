(function () {
  if (window.__mailivoxScraperLoaded) return;
  window.__mailivoxScraperLoaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'scrapeProfiles') {
      sendResponse({ profiles: extractVisibleProfiles() });
      return true;
    }
    return false;
  });

  function extractVisibleProfiles() {
    const selectors = [
      '.reusable-search__result-container',
      '[data-chameleon-result-urn]',
      '.search-results-container li',
      '.scaffold-finite-scroll__content li'
    ];

    const cards = uniqueElements(selectors.flatMap(selector => Array.from(document.querySelectorAll(selector))));
    const profiles = [];
    const seen = new Set();

    for (const card of cards) {
      const profile = parseCard(card);
      if (!profile.fullName || !profile.linkedinUrl) continue;
      const key = `${profile.fullName.toLowerCase()}|${profile.linkedinUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      profiles.push(profile);
    }

    return profiles;
  }

  function parseCard(card) {
    const linkEl = card.querySelector('a[href*="/in/"]');
    const nameEl =
      card.querySelector('.entity-result__title-text a span[aria-hidden="true"]') ||
      card.querySelector('.entity-result__title-text a') ||
      card.querySelector('span[dir="ltr"] span[aria-hidden="true"]') ||
      linkEl;

    const titleEl =
      card.querySelector('.entity-result__primary-subtitle') ||
      card.querySelector('[class*="primary-subtitle"]');

    const locationEl =
      card.querySelector('.entity-result__secondary-subtitle') ||
      card.querySelector('[class*="secondary-subtitle"]');

    const fullName = cleanName(nameEl?.textContent || '');
    const roleAndCompany = cleanText(titleEl?.textContent || '');
    const location = cleanText(locationEl?.textContent || '');
    const linkedinUrl = normalizeProfileUrl(linkEl?.href || '');
    const parsed = parseRoleAndCompany(roleAndCompany);

    return {
      fullName,
      role: parsed.role,
      company: parsed.company,
      location,
      linkedinUrl,
      extractedAt: new Date().toISOString()
    };
  }

  function parseRoleAndCompany(text) {
    const cleaned = cleanText(text);
    if (!cleaned) return { role: '', company: '' };

    const atMatch = cleaned.match(/\s(?:at|@)\s(.+)$/i);
    if (!atMatch) return { role: cleaned, company: '' };

    return {
      role: cleaned.slice(0, atMatch.index).trim(),
      company: atMatch[1].replace(/\s*\|\s*.*$/, '').trim()
    };
  }

  function normalizeProfileUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, window.location.origin);
      const match = parsed.pathname.match(/\/in\/[^/?#]+/);
      return match ? `https://www.linkedin.com${match[0]}/` : parsed.href;
    } catch (_) {
      return url;
    }
  }

  function cleanName(text) {
    return cleanText(text)
      .replace(/\s*(View|Open|Connect|Follow).*$/i, '')
      .replace(/\s+\d+(st|nd|rd|th)$/i, '')
      .trim();
  }

  function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }
})();
