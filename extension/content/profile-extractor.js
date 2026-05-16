(function () {
  if (window.__mailivoxProfileExtractorLoaded) return;
  window.__mailivoxProfileExtractorLoaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'extractContactInfo') {
      extractContactInfo()
        .then(sendResponse)
        .catch(err => sendResponse({ email: null, error: err.message }));
      return true;
    }
    return false;
  });

  async function extractContactInfo() {
    const fullName = getProfileName();
    const contactLink = findContactInfoLink();
    if (!contactLink) {
      return { fullName, email: null, error: 'Contact info link not found' };
    }

    contactLink.click();
    await sleep(700);
    await waitForElement('.artdeco-modal, [role="dialog"]', 7000).catch(() => null);

    const emailLink = await waitForEmail(5000).catch(() => null);
    const email = extractEmail(emailLink);
    const company = getCompany();
    const role = getRole();

    closeModal();

    return {
      fullName,
      email,
      company,
      role,
      extractedAt: new Date().toISOString()
    };
  }

  function findContactInfoLink() {
    const direct =
      document.querySelector('a[href*="/overlay/contact-info/"]') ||
      document.querySelector('#top-card-text-details-contact-info');
    if (direct) return direct;

    return Array.from(document.querySelectorAll('a, button'))
      .find(el => /contact\s+info/i.test(el.textContent || ''));
  }

  function getProfileName() {
    const el =
      document.querySelector('.text-heading-xlarge') ||
      document.querySelector('h1.inline') ||
      document.querySelector('main h1');
    return cleanText(el?.textContent || '');
  }

  function getRole() {
    const el =
      document.querySelector('.text-body-medium.break-words') ||
      document.querySelector('.pv-text-details__left-panel .text-body-medium');
    return cleanText(el?.textContent || '');
  }

  function getCompany() {
    const selectors = [
      'button[aria-label*="Current company"]',
      'a[href*="/company/"]',
      '.pv-text-details__right-panel a'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = cleanText(el?.textContent || '');
      if (text && !/contact info/i.test(text)) return text;
    }
    return '';
  }

  function waitForEmail(timeout) {
    return waitForElement(
      '.pv-contact-info__contact-link[href^="mailto:"], section.ci-email a[href^="mailto:"], a[href^="mailto:"]',
      timeout
    );
  }

  function waitForElement(selector, timeout) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(found);
        }
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for ${selector}`));
      }, timeout);

      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function extractEmail(link) {
    const href = link?.getAttribute('href') || '';
    const fromHref = href.replace(/^mailto:/i, '').split('?')[0].trim();
    const fromText = cleanText(link?.textContent || '');
    const candidate = fromHref || fromText;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate.toLowerCase() : null;
  }

  function closeModal() {
    const close =
      document.querySelector('button[aria-label="Dismiss"]') ||
      document.querySelector('button[aria-label="Close"]') ||
      document.querySelector('.artdeco-modal__dismiss');
    if (close) close.click();
  }

  function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
