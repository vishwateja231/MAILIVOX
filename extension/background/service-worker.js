const DEFAULT_API_URL = 'https://mailivox-backend.onrender.com';

let extractionState = {
  running: false,
  mode: null,
  progress: { processed: 0, total: 0, emailsFound: 0 },
  results: [],
  error: null,
  summary: null
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'MAILIVOX_TOKEN_FOUND') {
    storeCapturedToken(msg.token).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'getStatus') {
    sendResponse(extractionState);
    return false;
  }

  if (msg.action === 'stopExtraction') {
    extractionState.running = false;
    persistState();
    sendResponse({ stopped: true });
    return false;
  }

  if (msg.action === 'startMode1') {
    if (extractionState.running) {
      sendResponse({ started: false, error: 'Extraction already running' });
      return false;
    }
    handleMode1(msg.profiles || [], msg.searchUrl || '');
    sendResponse({ started: true });
    return false;
  }

  if (msg.action === 'startMode2') {
    if (extractionState.running) {
      sendResponse({ started: false, error: 'Extraction already running' });
      return false;
    }
    handleMode2(msg.connectionUrls || []);
    sendResponse({ started: true });
    return false;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['apiUrl', 'minDelayMs', 'maxDelayMs', 'maxDeepProfiles']);
  await chrome.storage.local.set({
    apiUrl: existing.apiUrl || DEFAULT_API_URL,
    minDelayMs: existing.minDelayMs || 2500,
    maxDelayMs: existing.maxDelayMs || 5500,
    maxDeepProfiles: existing.maxDeepProfiles || 50
  });
});

async function storeCapturedToken(token) {
  if (typeof token === 'string' && token.split('.').length === 3) {
    await chrome.storage.local.set({ mailivox_token: token });
  }
}

async function handleMode1(profiles, searchUrl) {
  extractionState = freshState(1, profiles.length);
  notify('progressUpdate');

  try {
    if (!Array.isArray(profiles) || profiles.length === 0) {
      throw new Error('No LinkedIn profiles found on this page.');
    }

    const body = {
      sessionName: `Chrome Quick Extract ${new Date().toLocaleString()}`,
      source: 'chrome_extension',
      searchUrl,
      extractedProfiles: profiles
    };

    const summary = await apiJson('/api/leads/process', 'POST', body);
    extractionState.progress.processed = summary.totalProcessed || profiles.length;
    extractionState.progress.emailsFound = summary.totalEmailsGenerated || 0;
    extractionState.summary = summary;
  } catch (err) {
    extractionState.error = err.message;
  } finally {
    extractionState.running = false;
    await persistState();
    notify('extractionComplete');
  }
}

async function handleMode2(connectionUrls) {
  extractionState = freshState(2, connectionUrls.length);
  notify('progressUpdate');

  const results = [];

  try {
    if (!Array.isArray(connectionUrls) || connectionUrls.length === 0) {
      throw new Error('No connection profile links found on this page.');
    }

    const settings = await chrome.storage.local.get(['minDelayMs', 'maxDelayMs']);
    const minDelayMs = Number(settings.minDelayMs || 2500);
    const maxDelayMs = Math.max(Number(settings.maxDelayMs || 5500), minDelayMs);

    for (const rawUrl of connectionUrls) {
      if (!extractionState.running) break;

      let tab = null;
      try {
        const url = normalizeLinkedInUrl(rawUrl);
        tab = await chrome.tabs.create({ url, active: false });
        await waitForTabLoad(tab.id);
        await sleep(1600);

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/profile-extractor.js']
        });

        const contactInfo = await sendTabMessage(tab.id, { action: 'extractContactInfo' });
        if (contactInfo?.email) {
          const item = {
            ...contactInfo,
            linkedinUrl: url
          };
          results.push(item);
          extractionState.results = results;
          extractionState.progress.emailsFound = results.length;
        }
      } catch (err) {
        extractionState.error = err.message;
      } finally {
        extractionState.progress.processed++;
        await persistState();
        notify('progressUpdate');
        if (tab?.id) {
          try { await chrome.tabs.remove(tab.id); } catch (_) {}
        }
      }

      const delay = randomInt(minDelayMs, maxDelayMs);
      await sleep(delay);
    }

    if (results.length > 0) {
      extractionState.summary = await apiJson('/api/extension/batch', 'POST', {
        contacts: results,
        sessionName: `Chrome Deep Extract ${new Date().toLocaleString()}`
      });
    }
  } catch (err) {
    extractionState.error = err.message;
  } finally {
    extractionState.running = false;
    extractionState.results = results;
    await persistState();
    notify('extractionComplete');
  }
}

function freshState(mode, total) {
  return {
    running: true,
    mode,
    progress: { processed: 0, total, emailsFound: 0 },
    results: [],
    error: null,
    summary: null
  };
}

async function apiJson(endpoint, method, body) {
  const { apiUrl, mailivox_token } = await chrome.storage.local.get(['apiUrl', 'mailivox_token']);
  const headers = { 'Content-Type': 'application/json' };
  if (mailivox_token) headers.Authorization = `Bearer ${mailivox_token}`;

  const res = await fetch(`${apiUrl || DEFAULT_API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed with HTTP ${res.status}`);
  return data;
}

function normalizeLinkedInUrl(url) {
  if (!url) return 'https://www.linkedin.com/';
  if (url.startsWith('https://www.linkedin.com')) return url;
  if (url.startsWith('/')) return `https://www.linkedin.com${url}`;
  return `https://www.linkedin.com/${url.replace(/^\/+/, '')}`;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (tab?.status === 'complete') return resolve();
      const listener = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15000);
    });
  });
}

function sendTabMessage(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(response);
    });
  });
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function persistState() {
  await chrome.storage.local.set({ extractionState });
}

function notify(action) {
  chrome.runtime.sendMessage({ action, state: extractionState }, () => {
    void chrome.runtime.lastError;
  });
}
