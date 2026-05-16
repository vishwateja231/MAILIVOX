// Mailivox Connections v5 — finds 1st-degree connections WITH their company info
// Returns full profile data {url, fullName, role, company} from search results

(() => {
  if (window.__mvxConnFn) {
    try { chrome.runtime.onMessage.removeListener(window.__mvxConnFn); } catch(e) {}
  }

  window.__mvxConnFn = (msg, _sender, sendResponse) => {
    if (msg && msg.action === 'getConnectionUrls') {
      try {
        const connections = findConnections();
        // Backward-compatible: still send array of URLs as 'connections'
        // But also send full profile data as 'connectionProfiles'
        sendResponse({
          connections: connections.map(c => c.linkedinUrl),
          connectionProfiles: connections
        });
      } catch (err) {
        sendResponse({ connections: [], connectionProfiles: [], error: err.message });
      }
      return true;
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(window.__mvxConnFn);

  function findConnections() {
    const path = window.location.pathname;
    
    // On the connections page — every profile is 1st-degree
    if (path.includes('/mynetwork') && (path.includes('connections') || path.includes('invite-connect'))) {
      return getAllProfiles();
    }
    
    return getFirstDegreeProfiles();
  }

  function getAllProfiles() {
    const seen = new Set();
    const profiles = [];
    
    const allLinks = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    for (const link of allLinks) {
      const url = normalizeUrl(link.href);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      
      const card = findCard(link);
      const profile = card ? extractFromCard(card, url) : { linkedinUrl: url, fullName: '', role: '', company: '' };
      profiles.push(profile);
    }
    
    return profiles;
  }

  function getFirstDegreeProfiles() {
    const allLinks = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    const profileMap = new Map();
    
    for (const link of allLinks) {
      const url = normalizeUrl(link.href);
      if (!url) continue;
      
      const card = findCard(link);
      if (!card) continue;
      
      const existing = profileMap.get(url);
      if (!existing || card.offsetHeight > existing.offsetHeight) {
        profileMap.set(url, card);
      }
    }
    
    const profiles = [];
    for (const [url, card] of profileMap) {
      if (isFirstDegree(card)) {
        profiles.push(extractFromCard(card, url));
      }
    }
    
    return profiles;
  }

  function findCard(link) {
    let el = link.parentElement;
    let depth = 0;
    while (el && el !== document.body && depth < 15) {
      const tag = el.tagName;
      if (tag === 'LI') return el;
      
      if (tag === 'DIV') {
        const text = el.textContent || '';
        if (text.length > 50 && text.length < 2000) {
          const childLinks = el.querySelectorAll('a[href*="/in/"]').length;
          if (childLinks <= 3) {
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

  function extractFromCard(card, url) {
    const text = card.innerText || card.textContent || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    // Get name from the link itself or first non-degree line
    let fullName = '';
    const link = card.querySelector('a[href*="/in/"]');
    if (link) {
      const linkText = (link.textContent || '').trim();
      const cleaned = cleanName(linkText);
      if (cleaned && cleaned.length >= 2) fullName = cleaned;
    }
    if (!fullName) {
      for (const line of lines) {
        const cleaned = cleanName(line);
        if (cleaned && cleaned.length >= 2 && cleaned.length <= 60 && /^[A-Za-z]/.test(cleaned)) {
          fullName = cleaned;
          break;
        }
      }
    }
    
    // Extract role and company — multiple patterns
    let role = '';
    let company = '';
    
    // PRIORITY 1: "Current: Role at Company" (the most reliable on search results)
    const currentAtMatch = text.match(/Current:\s*([^\n]+?)\s+at\s+([^\n|·]+?)(?:\s*[·\n]|$)/i);
    if (currentAtMatch) {
      role = clean(currentAtMatch[1]);
      company = clean(currentAtMatch[2]);
    }
    
    // PRIORITY 2: Headline parsing if Current: pattern didn't match
    if (!company || !role) {
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
      
      if (headline) {
        const atMatch = headline.match(/^(.+?)\s+(?:at|@)\s*(.+)$/i);
        if (atMatch) {
          if (!role) role = clean(atMatch[1]);
          if (!company) company = clean(atMatch[2].split(/[\|,]/)[0]);
        } else if (!role) {
          role = clean(headline.split(/[\|,]/)[0]);
        }
      }
    }
    
    // PRIORITY 3: Known company names fallback
    if (!company) {
      const known = text.match(/\b(Amazon|Google|Microsoft|Meta|Apple|Netflix|Uber|Flipkart|Infosys|TCS|Wipro|Accenture|Oracle|Adobe|Salesforce|Honeywell|JPMorgan|Goldman|Cisco|IBM|Deloitte|PwC|EY|KPMG|Tesla|Nvidia|Intel|Stripe|Shopify|Cornerstone|Walmart|Target|Yahoo|LinkedIn|Twitter|Snap|Pinterest)\b/i);
      if (known) company = known[1];
    }
    
    return {
      linkedinUrl: url,
      fullName,
      role: role || '',
      company: cleanCompany(company) || ''
    };
  }

  function isFirstDegree(card) {
    const text = card.innerText || card.textContent || '';
    if (/[•·]\s*1st\b/i.test(text)) return true;
    if (/\s1st\s/.test(text)) return true;
    if (/^1st\s/.test(text)) return true;
    if (/\s1st$/.test(text)) return true;
    if (/\b1st\b/.test(text)) return true;
    
    const btns = card.querySelectorAll('button, a');
    for (const btn of btns) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const txt = (btn.textContent || '').trim().toLowerCase();
      if (label.includes('message') || txt === 'message') return true;
    }
    return false;
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

  function cleanCompany(name) {
    if (!name) return '';
    return name
      .replace(/\s+/g, ' ')
      .replace(/\s*[·•|].*$/, '')
      .replace(/\s*-\s*.*$/, '')
      .replace(/[^a-zA-Z0-9\s&.\-']/g, '')
      .trim()
      .slice(0, 60);
  }

  function isLocationLine(line) {
    return /\b(India|United States|USA|UK|Canada|Australia|Singapore|Germany|France|Hyderabad|Bangalore|Bengaluru|Mumbai|Delhi|Chennai|Pune|Kolkata|Noida|Gurugram|San Francisco|New York|London|Toronto|Sydney|Berlin|Remote|Greater)\b/i.test(line);
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
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
