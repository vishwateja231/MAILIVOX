// Mailivox Profile Extractor v3 — opens Contact Info and extracts email
// Robust against LinkedIn's variable DOM structure

(() => {
  if (window.__mvxExtractorFn) {
    try { chrome.runtime.onMessage.removeListener(window.__mvxExtractorFn); } catch(e) {}
  }

  window.__mvxExtractorFn = (msg, _sender, sendResponse) => {
    if (msg && msg.action === 'extractContactInfo') {
      extractContactInfo()
        .then(sendResponse)
        .catch(err => sendResponse({ email: null, error: err.message, skipped: true }));
      return true;
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(window.__mvxExtractorFn);

  async function extractContactInfo() {
    // Step 1: Wait for the page to be ready
    await sleep(1000);

    // CRITICAL: Extract profile metadata BEFORE opening contact modal.
    // Once we navigate to /overlay/contact-info, the top card is hidden under the modal
    // so company link, "Current:" text, etc. are no longer accessible.
    const fullName = getProfileName();
    const role = getRole();
    const company = getCompany(); // Must run BEFORE contact info click
    const linkedinUrl = location.href.split('?')[0].split('#')[0].replace(/\/overlay\/contact-info\/?$/, '/');

    // Stash the profile data so it's available even after modal opens
    window.__mvxProfileData = { fullName, role, company, linkedinUrl };

    // Step 2: Check if we're already on the contact info overlay
    const isAlreadyOnContactPage = location.pathname.includes('/overlay/contact-info');
    
    if (!isAlreadyOnContactPage) {
      // Find and click "Contact info" link/button
      const contactLink = findContactInfoLink();
      if (!contactLink) {
        return {
          fullName, role, company, linkedinUrl,
          email: null, skipped: true, reason: 'no_contact_link'
        };
      }
      contactLink.click();
      
      // Wait for the URL to change OR a modal to appear
      await Promise.race([
        waitForUrlChange(/overlay\/contact-info/, 5000),
        waitForElement('.artdeco-modal__content, [role="dialog"]', 5000)
      ]).catch(() => null);
      
      // Give the modal/page time to fully render
      await sleep(1500);
    } else {
      // Already on contact-info overlay, just wait for content
      await sleep(800);
    }

    // Step 3: Extract email — try multiple strategies
    const email = await findEmail();

    // Step 4: Close the modal if it's open
    closeModal();

    if (!email) {
      return {
        fullName: fullName || extractNameFromUrl(linkedinUrl),
        role, company, linkedinUrl,
        email: null, skipped: true, reason: 'no_email_visible'
      };
    }

    return {
      fullName: fullName || extractNameFromUrl(linkedinUrl),
      role, company, linkedinUrl, email,
      extractedAt: new Date().toISOString()
    };
  }

  function findContactInfoLink() {
    // Direct anchor
    const direct = document.querySelector('a[href*="/overlay/contact-info/"]')
      || document.querySelector('#top-card-text-details-contact-info');
    if (direct) return direct;

    // Find by visible text content
    const candidates = document.querySelectorAll('a, button');
    for (const el of candidates) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text === 'contact info' || text === 'contact information') return el;
    }
    return null;
  }

  /**
   * findEmail — Multi-strategy email extraction
   * Tries the most reliable methods first, falls back to text scanning
   */
  async function findEmail() {
    // Try several times because the modal content loads asynchronously
    for (let attempt = 0; attempt < 5; attempt++) {
      const email = scanForEmail();
      if (email) return email;
      await sleep(500);
    }
    return null;
  }

  function scanForEmail() {
    // Strategy 1: mailto: links anywhere on page
    const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
    for (const link of mailtoLinks) {
      const href = link.getAttribute('href') || '';
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (isValidEmail(email)) return email.toLowerCase();
    }

    // Strategy 2: LinkedIn-specific email section selectors
    const linkedInEmailSelectors = [
      '.pv-contact-info__contact-link[href^="mailto:"]',
      'section.ci-email a',
      '.ci-email a',
      'section[data-test*="email"] a',
      '[data-field="email_address"] a',
      'a.pv-contact-info__contact-item',
    ];
    for (const sel of linkedInEmailSelectors) {
      const el = document.querySelector(sel);
      const text = clean(el?.textContent || '');
      if (isValidEmail(text)) return text.toLowerCase();
      const href = el?.getAttribute('href') || '';
      const fromHref = href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (isValidEmail(fromHref)) return fromHref.toLowerCase();
    }

    // Strategy 3: Find any element labeled "Email" and grab the next link/text
    const allHeadings = document.querySelectorAll('h3, h4, span, div');
    for (const heading of allHeadings) {
      const text = (heading.textContent || '').trim();
      if (text === 'Email' || text === 'Email address') {
        // Look at siblings and descendants of the parent
        const parent = heading.parentElement;
        if (parent) {
          const link = parent.querySelector('a');
          if (link) {
            const href = link.getAttribute('href') || '';
            const fromHref = href.replace(/^mailto:/i, '').split('?')[0].trim();
            if (isValidEmail(fromHref)) return fromHref.toLowerCase();
            const linkText = clean(link.textContent || '');
            if (isValidEmail(linkText)) return linkText.toLowerCase();
          }
          // Try sibling text
          const siblingText = clean(parent.textContent.replace(text, ''));
          const m = siblingText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
          if (m && isValidEmail(m[0])) return m[0].toLowerCase();
        }
      }
    }

    // Strategy 4: Brute force — find any email in modal/overlay text
    const overlayContainers = document.querySelectorAll(
      '.artdeco-modal, [role="dialog"], main, .artdeco-modal__content, section.pv-contact-info'
    );
    for (const container of overlayContainers) {
      const text = container.textContent || '';
      const matches = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
      if (matches) {
        for (const m of matches) {
          if (isValidEmail(m)) return m.toLowerCase();
        }
      }
    }

    // Strategy 5: Fallback — search the entire page (last resort)
    const bodyText = document.body.innerText || document.body.textContent || '';
    const matches = bodyText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
    if (matches) {
      for (const m of matches) {
        if (isValidEmail(m)) return m.toLowerCase();
      }
    }

    return null;
  }

  function isValidEmail(email) {
    if (!email) return false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
    // Skip placeholders, LinkedIn internal emails, support emails
    const blocked = /noreply|no-reply|donotreply|example\.|test\.com|@linkedin\.com|sales@|support@|info@|hello@|admin@|webmaster@/i;
    if (blocked.test(email)) return false;
    return true;
  }

  function getProfileName() {
    const selectors = [
      '.text-heading-xlarge',
      'h1.inline',
      'main h1',
      '.pv-text-details__left-panel h1',
      'section.artdeco-card h1'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = clean(el?.textContent || '');
      if (text && text.length > 1 && text.length < 80) return text;
    }
    return '';
  }

  function getRole() {
    const el = document.querySelector('.text-body-medium.break-words')
      || document.querySelector('.pv-text-details__left-panel .text-body-medium')
      || document.querySelector('div.text-body-medium');
    return clean(el?.textContent || '');
  }

  function getCompany() {
    const bodyText = document.body.innerText || '';
    
    // Method 0: OpenGraph and meta tags (LinkedIn sets these)
    const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    const allMeta = ogDescription + ' ' + metaDescription;
    if (allMeta) {
      // Common pattern: "View [Name]'s profile on LinkedIn... [Title] at [Company]..."
      const atMatch = allMeta.match(/(?:^|\s)at\s+([A-Z][A-Za-z0-9\s&.,'\-]+?)(?:\s*[|·.,;]|\s+View|\s+Hyderabad|\s+Bangalore|\s+India|\s+\.|$)/);
      if (atMatch) {
        const c = clean(atMatch[1]);
        if (isValidCompanyName(c)) return c;
      }
    }
    
    // Method 1: Top card company link — most reliable when accessible
    const companyLinks = document.querySelectorAll('a[href*="/company/"]');
    for (const link of companyLinks) {
      const href = link.getAttribute('href') || '';
      if (href.includes('/search/') || href.includes('?')) continue;
      
      const text = clean(link.textContent);
      if (isValidCompanyName(text)) {
        const inTopCard = link.closest('section.pv-top-card, .ph5, .artdeco-card, main section:first-child');
        if (inTopCard) return text;
      }
    }
    // Fallback: any valid company link
    for (const link of companyLinks) {
      const href = link.getAttribute('href') || '';
      if (href.includes('/search/') || href.includes('?')) continue;
      const text = clean(link.textContent);
      if (isValidCompanyName(text)) return text;
    }

    // Method 2: "Current: ..." patterns
    const patterns = [
      /Current:\s*[^\n]*?\s+at\s+([A-Z][A-Za-z0-9\s&.,'\-]+?)(?:\s*\n|\s*[•·]|\s{3,}|$)/,
      /Current:\s*([A-Z][A-Za-z0-9\s&.,'\-]+?)(?:\s*\n|\s*[•·]|\s{3,}|$)/,
    ];
    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match) {
        const company = clean(match[1]);
        if (isValidCompanyName(company)) return company;
      }
    }

    // Method 3: aria-label
    const labeledBtn = document.querySelector('button[aria-label*="Current company"]');
    if (labeledBtn) {
      const text = clean(labeledBtn.textContent);
      if (isValidCompanyName(text)) return text;
    }

    // Method 4: Image alt text
    const topCardImages = document.querySelectorAll(
      'section.pv-top-card img[alt], .ph5 img[alt], section.artdeco-card img[alt]'
    );
    for (const img of topCardImages) {
      const alt = clean(img.getAttribute('alt') || '');
      if (isValidCompanyName(alt) && !/profile|photo|background/i.test(alt)) {
        return alt;
      }
    }

    // Method 5: Headline parsing
    const headline = document.querySelector('.text-body-medium.break-words')
      || document.querySelector('div.text-body-medium');
    if (headline) {
      const headlineText = clean(headline.textContent);
      const atMatch = headlineText.match(/(?:^|\s)(?:at|@)\s+([A-Z][A-Za-z0-9\s&.,'\-]+?)(?:\s*[|·]|$)/i);
      if (atMatch) {
        const c = clean(atMatch[1]);
        if (isValidCompanyName(c)) return c;
      }
    }

    return '';
  }

  function isValidCompanyName(name) {
    if (!name) return false;
    if (name.length < 2 || name.length > 80) return false;
    // Reject obvious non-companies
    const blocked = /^(Contact info|Message|Connect|Follow|View profile|Add note|Private|Linkedin|LinkedIn|Show all|See all|Your|Profile|Edit|More|Hyderabad|Bangalore|Bengaluru|Mumbai|Delhi|Chennai|India|Greater)$/i;
    if (blocked.test(name)) return false;
    // Must start with a letter
    if (!/^[A-Z]/.test(name)) return false;
    // Reject pure location strings
    if (/(India|United States|USA|UK)$/.test(name) && name.split(/\s+/).length <= 3) return false;
    return true;
  }

  function extractNameFromUrl(url) {
    try {
      const m = url.match(/\/in\/([^/?#]+)/);
      if (!m) return '';
      return m[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 60);
    } catch (e) { return ''; }
  }

  function closeModal() {
    const close = document.querySelector('button[aria-label="Dismiss"]')
      || document.querySelector('button[aria-label="Close"]')
      || document.querySelector('.artdeco-modal__dismiss');
    if (close) {
      try { close.click(); } catch (e) {}
    }
  }

  function waitForUrlChange(pattern, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (pattern.test(location.href)) return resolve();
        if (Date.now() - start > timeout) return reject(new Error('URL change timeout'));
        setTimeout(check, 200);
      };
      check();
    });
  }

  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Timeout'));
      }, timeout);

      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
