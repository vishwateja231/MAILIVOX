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
    const cards = getProfileCards();
    const profiles = [];
    const seen = new Set();

    for (const card of cards) {
      const profile = parseCard(card);
      if (!profile.fullName || !profile.linkedinUrl) continue;
      if (profile.fullName.length < 2 || profile.fullName.length > 60) continue;
      const key = `${profile.fullName.toLowerCase()}|${profile.linkedinUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      profiles.push(profile);
    }

    return profiles;
  }

  function getProfileCards() {
    const selectors = [
      '.reusable-search__result-container',
      '[data-chameleon-result-urn]',
      'li[data-view-name*="search"]',
      '.search-results-container li',
      '.scaffold-finite-scroll__content li'
    ];

    const cards = selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)));

    for (const link of document.querySelectorAll('a[href*="/in/"]')) {
      const card =
        link.closest('.reusable-search__result-container') ||
        link.closest('[data-chameleon-result-urn]') ||
        link.closest('li') ||
        link.closest('[data-view-name]') ||
        link.closest('.display-flex') ||
        link.parentElement;
      if (card) cards.push(card);
    }

    return uniqueElements(cards).filter(card => card.querySelector('a[href*="/in/"]'));
  }

  function parseCard(card) {
    const linkEl = findProfileLink(card);
    const nameEl =
      card.querySelector('.entity-result__title-text a span[aria-hidden="true"]') ||
      card.querySelector('.entity-result__title-text a') ||
      card.querySelector('span[dir="ltr"] span[aria-hidden="true"]') ||
      linkEl?.querySelector('span[aria-hidden="true"]') ||
      linkEl;

    const titleEl =
      card.querySelector('.entity-result__primary-subtitle') ||
      card.querySelector('[class*="primary-subtitle"]') ||
      card.querySelector('.t-14.t-black.t-normal');

    const locationEl =
      card.querySelector('.entity-result__secondary-subtitle') ||
      card.querySelector('[class*="secondary-subtitle"]') ||
      card.querySelector('.t-14.t-normal:not(.t-black)');

    // Get raw name text ONLY from the name element (not from the whole card)
    const rawNameText = nameEl?.textContent || '';
    const fullName = sanitizeName(rawNameText);
    
    const roleAndCompany = cleanText(titleEl?.textContent || '');
    const location = cleanText(locationEl?.textContent || '');
    const linkedinUrl = normalizeProfileUrl(linkEl?.href || '');
    const parsed = parseRoleAndCompany(roleAndCompany);

    // Detect connection degree
    const cardText = (card.textContent || '').toLowerCase();
    const degree = cardText.includes('1st') ? '1st' : cardText.includes('2nd') ? '2nd' : cardText.includes('3rd') ? '3rd' : null;

    return {
      fullName,
      role: parsed.role,
      company: parsed.company || inferCompanyFromCard(card),
      location,
      linkedinUrl,
      connectionDegree: degree,
      extractedAt: new Date().toISOString()
    };
  }

  function findProfileLink(card) {
    const links = Array.from(card.querySelectorAll('a[href*="/in/"]'));
    return links.find(link => {
      const text = sanitizeName(link.textContent || '');
      return text.length > 1 && text.length < 50;
    }) || links[0] || null;
  }

  /**
   * sanitizeName — The KEY fix. Extracts ONLY the person's name from LinkedIn text.
   * Strips: connection degree (• 1st, • 2nd), headlines, locations, mutual connections.
   */
  function sanitizeName(rawText) {
    let name = cleanText(rawText);
    
    // Cut at bullet + degree marker: "Name • 1st" or "Name · 2nd"
    name = name.split(/\s*[•·]\s*(?:1st|2nd|3rd|4th|5th)/i)[0].trim();
    
    // Cut at standalone degree: "Name 1st" at end
    name = name.replace(/\s+(?:1st|2nd|3rd)$/i, '').trim();
    
    // Cut at " - " or " | " separators (headline indicators)
    name = name.split(/\s*[\|–—]\s*/)[0].trim();
    
    // Remove "View Name's profile" type suffixes
    name = name.replace(/\s*(View|Open|Connect|Follow|Message).*$/i, '').trim();
    
    // Remove emojis
    name = name.replace(/[\u{1F300}-\u{1FFFF}]/gu, '');
    name = name.replace(/[\u2600-\u27BF\u2700-\u27BF]/gu, '');
    name = name.replace(/[🚀✨💡🔥⭐🎯💻🌟⚡️🏆🎉✅❤️🙏💪🔑📊📈🤝🌍💼]/gu, '');
    
    // Remove verified badge unicode
    name = name.replace(/[\u2713\u2714\u2611\u2705]/g, '').trim();
    
    // Keep only letters, spaces, dots, hyphens, apostrophes
    name = name.replace(/[^a-zA-Z\s.\-']/g, ' ').replace(/\s+/g, ' ').trim();
    
    // If still too long (>5 words), take first 4
    const words = name.split(/\s+/);
    if (words.length > 5) {
      name = words.slice(0, 4).join(' ');
    }
    
    return name;
  }

  function parseRoleAndCompany(text) {
    const cleaned = cleanText(text);
    if (!cleaned) return { role: '', company: '' };

    // "Role at Company" or "Role @ Company"
    const atMatch = cleaned.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (atMatch) {
      return {
        role: atMatch[1].trim(),
        company: cleanCompany(atMatch[2])
      };
    }

    // "Role | Company | Stuff" — take first as role, infer company
    const pipeParts = cleaned.split(/\s*\|\s*/).map(p => p.trim()).filter(Boolean);
    if (pipeParts.length > 1) {
      const companyPart = pipeParts.find(p => looksLikeCompany(p)) || '';
      return { role: pipeParts[0], company: cleanCompany(companyPart) };
    }

    // Check if the text contains a known company name
    const inferred = inferCompany(cleaned);
    return { role: cleaned, company: inferred };
  }

  function inferCompanyFromCard(card) {
    // Look for "Current: Role at Company" pattern in card text
    const text = card.textContent || '';
    const currentMatch = text.match(/Current:\s*(?:.*?\s+at\s+)?([A-Z][A-Za-z0-9\s&.\-]+?)(?:\s*\n|\s{2,}|$)/);
    if (currentMatch) return cleanCompany(currentMatch[1]);

    // Look for company link
    const companyLink = card.querySelector('a[href*="/company/"]');
    if (companyLink) {
      const companyText = cleanText(companyLink.textContent);
      if (companyText && companyText.length > 1) return companyText;
    }

    return '';
  }

  function cleanCompany(text) {
    return cleanText(text)
      .replace(/^current:\s*/i, '')
      .replace(/\s*\|.*$/, '')
      .replace(/\s+-\s+.*$/, '')
      .replace(/\s*·.*$/, '')
      .trim();
  }

  function looksLikeCompany(text) {
    return /(inc|llc|ltd|limited|corp|technologies|systems|solutions|amazon|google|microsoft|meta|apple|honeywell|salesforce|oracle|adobe|wipro|infosys|tcs|cognizant|accenture|flipkart|swiggy|uber|netflix)/i.test(text);
  }

  function inferCompany(text) {
    const known = text.match(/\b(Amazon|Google|Microsoft|Meta|Apple|JPMorgan|Honeywell|Salesforce|Oracle|Adobe|Wipro|Infosys|TCS|Cognizant|Accenture|Flipkart|Netflix|Uber|Stripe|Shopify)\b/i);
    return known ? known[1] : '';
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

  function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }
})();
