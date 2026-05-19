// Mailivox Scraper v4 — link-anchored extraction with relaxed card detection

(() => {
  if (window.__mvxScraperFn) {
    try { chrome.runtime.onMessage.removeListener(window.__mvxScraperFn); } catch(e) {}
  }

  window.__mvxScraperFn = (msg, _sender, sendResponse) => {
    if (msg && msg.action === 'scrapeProfiles') {
      try {
        sendResponse({ profiles: scrapeProfiles() });
      } catch (err) {
        sendResponse({ profiles: [], error: err.message });
      }
      return true;
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(window.__mvxScraperFn);

  function scrapeProfiles() {
    // Find every profile link
    const allLinks = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    
    // Map URL → best card container
    const profileMap = new Map();
    
    for (const link of allLinks) {
      const url = normalizeUrl(link.href);
      if (!url) continue;
      
      const card = findCard(link);
      if (!card) continue;
      
      const existing = profileMap.get(url);
      if (!existing || (card.offsetHeight > existing.offsetHeight && card.contains(link))) {
        profileMap.set(url, card);
      }
    }
    
    // Extract data from each card
    const profiles = [];
    const seenNames = new Set();
    
    for (const [url, card] of profileMap) {
      const profile = extractProfile(card, url);
      if (!profile || !profile.fullName || profile.fullName.length < 2) continue;
      
      // Dedupe by URL (most reliable) and name+company combo
      const dedupeKey = `${profile.fullName.toLowerCase()}|${(profile.company || '').toLowerCase()}`;
      if (seenNames.has(dedupeKey)) continue;
      seenNames.add(dedupeKey);
      
      profiles.push(profile);
    }
    
    return profiles;
  }

  function findCard(link) {
    // Walk up the DOM looking for a reasonably-sized container
    let el = link.parentElement;
    let depth = 0;
    while (el && el !== document.body && depth < 15) {
      const tag = el.tagName;
      // Stop at <li> elements (these are typical search result containers)
      if (tag === 'LI') return el;
      
      // Or stop at div containers that have multiple child elements (likely a card)
      if (tag === 'DIV') {
        const text = el.textContent || '';
        // A real card has multi-line content but not the entire page
        if (text.length > 50 && text.length < 2000) {
          // Has only 1-3 profile links inside (avoids matching the whole results list)
          const childLinks = el.querySelectorAll('a[href*="/in/"]').length;
          if (childLinks <= 3) {
            // Check if parent is even bigger and same — go one level up
            const parentText = el.parentElement?.textContent || '';
            if (parentText.length < text.length * 1.5) {
              return el;
            }
          }
        }
      }
      
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function extractProfile(card, url) {
    const text = card.innerText || card.textContent || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    // Detect connection degree
    const degree = detectDegree(text);
    
    // Find the name — usually the first line, or text inside the profile link
    let fullName = '';
    
    // Strategy A: Find name from <a href="/in/..."> link's main text
    const link = card.querySelector('a[href*="/in/"]');
    if (link) {
      const linkText = (link.textContent || '').trim();
      const cleaned = cleanName(linkText);
      if (cleaned && cleaned.length >= 2 && /^[A-Za-z]/.test(cleaned)) {
        fullName = cleaned;
      }
    }
    
    // Strategy B: First line that looks like a name
    if (!fullName) {
      for (const line of lines) {
        const cleaned = cleanName(line);
        if (cleaned && cleaned.length >= 2 && cleaned.length <= 60 && /^[A-Za-z]/.test(cleaned)) {
          fullName = cleaned;
          break;
        }
      }
    }
    
    if (!fullName) return null;
    
    // Find role and company
    let role = '';
    let company = '';
    
    // PRIORITY 1: "Current: Role at Company" pattern
    const currentMatch = text.match(/Current:\s*([^\n]+?)\s+at\s+([^\n|·]+?)(?:\s*[·\n]|$)/i);
    if (currentMatch) {
      role = currentMatch[1].trim();
      company = currentMatch[2].trim().replace(/\s+/g, ' ');
    }
    
    // PRIORITY 2: Find headline (line with role info)
    let headline = '';
    for (const line of lines) {
      if (line === fullName) continue;
      if (/^(1st|2nd|3rd|Connect|Message|Follow|View profile)$/i.test(line)) continue;
      if (/^[•·]\s*(1st|2nd|3rd)/i.test(line)) continue;
      if (isLocationLine(line)) continue;
      if (/^Current:/i.test(line)) continue;
      if (line.length < 5 || line.length > 200) continue;
      
      headline = line;
      break;
    }
    
    if (headline && (!role || !company)) {
      const atMatch = headline.match(/^(.+?)\s+(?:at|@)\s*(.+)$/i);
      if (atMatch) {
        if (!role) role = atMatch[1].trim();
        if (!company) company = atMatch[2].split(/[\|,]/)[0].trim();
      } else if (!role) {
        role = headline.split(/[\|,]/)[0].trim();
        const commaMatch = headline.match(/^(.+?),\s*(.+)$/);
        if (commaMatch && !company) {
          const possibleCompany = commaMatch[2].split(/[\|·]/)[0].trim();
          if (possibleCompany.length < 50) company = possibleCompany;
        }
      }
    }
    
    // PRIORITY 3: Known company names
    if (!company) {
      const known = text.match(/\b(Amazon|Google|Microsoft|Meta|Apple|Netflix|Uber|Flipkart|Infosys|TCS|Wipro|Accenture|Oracle|Adobe|Salesforce|Honeywell|JPMorgan|Goldman|Cisco|IBM|Deloitte|PWC|EY|KPMG|Tesla|Nvidia|Intel|Stripe|Shopify|Cornerstone|Walmart|Target)\b/i);
      if (known) company = known[1];
    }
    
    // Find location
    let location = '';
    for (const line of lines) {
      if (isLocationLine(line) && line.length < 80) {
        location = line;
        break;
      }
    }
    
    return {
      fullName,
      role: (role && role.toLowerCase() !== fullName.toLowerCase()) ? role : '',
      company: cleanCompany(company, fullName),
      location,
      linkedinUrl: url,
      connectionDegree: degree,
      extractedAt: new Date().toISOString()
    };
  }

  function detectDegree(text) {
    if (/[•·]\s*1st\b/i.test(text) || /\s1st\s/.test(text) || /^1st\s/.test(text)) return '1st';
    if (/[•·]\s*2nd\b/i.test(text) || /\s2nd\s/.test(text) || /^2nd\s/.test(text)) return '2nd';
    if (/[•·]\s*3rd\b/i.test(text) || /\s3rd\s/.test(text) || /^3rd\s/.test(text)) return '3rd';
    return null;
  }

  function cleanName(raw) {
    let n = raw;
    n = n.split(/\s*[•·]\s*\d/)[0];
    n = n.replace(/\s+(1st|2nd|3rd)$/i, '');
    n = n.replace(/[\u{1F300}-\u{1FFFF}\u2600-\u27BF\u2700-\u27BF]/gu, '');
    n = n.replace(/[\u2713\u2714\u2705]/g, '');
    n = n.replace(/[^a-zA-Z\s.\-']/g, ' ').replace(/\s+/g, ' ').trim();
    const w = n.split(/\s+/);
    if (w.length > 5) n = w.slice(0, 4).join(' ');
    return n;
  }

  function cleanCompany(name, fullName) {
    if (!name) return '';
    let c = name
      .replace(/\s+/g, ' ')
      .replace(/\s*[·•|].*$/, '')
      .replace(/\s*-\s*.*$/, '')
      .replace(/[^a-zA-Z0-9\s&.\-']/g, '')
      .trim()
      .slice(0, 60);
    // If company name is same as the person's name, it's a parsing error
    if (c && fullName && c.toLowerCase() === fullName.toLowerCase()) return '';
    // If company is a single common person-name word, reject it
    const personWords = ['kumar','singh','sharma','gupta','patel','reddy','rao','nair','yadav','sangam','navudu','saha','raza','khan'];
    if (personWords.includes(c.toLowerCase())) return '';
    return c;
  }

  function isLocationLine(line) {
    return /\b(India|United States|USA|UK|Canada|Australia|Singapore|Germany|France|Hyderabad|Bangalore|Bengaluru|Mumbai|Delhi|Chennai|Pune|Kolkata|Noida|Gurugram|San Francisco|New York|London|Toronto|Sydney|Berlin|Remote|Greater)\b/i.test(line);
  }

  function normalizeUrl(href) {
    try {
      const m = new URL(href, location.origin).pathname.match(/\/in\/[^/?#]+/);
      return m ? `https://www.linkedin.com${m[0]}/` : '';
    } catch (e) {
      return '';
    }
  }
})();
