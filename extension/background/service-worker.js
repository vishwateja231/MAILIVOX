const DEFAULT_API_URL = 'http://localhost:3000';

let extractionState = {
  running: false,
  mode: null,
  progress: { processed: 0, total: 0, emailsFound: 0 },
  results: [],
  error: null,
  summary: null
};

// Track tabs opened by Mode 2 so we can close them on stop
let activeModeTab = null;

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
    // Close any active tab opened by Mode 2
    if (activeModeTab) {
      try { chrome.tabs.remove(activeModeTab); } catch (_) {}
      activeModeTab = null;
    }
    persistState();
    sendResponse({ stopped: true });
    notify('extractionComplete');
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
    handleMode2(msg.connectionUrls || [], msg.connectionProfiles || []);
    sendResponse({ started: true });
    return false;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureLocalDefaults();
  await configureSidePanel();
});

ensureLocalDefaults();
configureSidePanel();

chrome.action.onClicked.addListener(async (tab) => {
  if (!chrome.sidePanel?.open || !tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

async function storeCapturedToken(token) {
  if (typeof token === 'string' && token.split('.').length === 3) {
    await chrome.storage.local.set({ mailivox_token: token });
  }
}

async function ensureLocalDefaults() {
  const existing = await chrome.storage.local.get(['apiUrl', 'minDelayMs', 'maxDelayMs', 'maxDeepProfiles']);
  const nextApiUrl = !existing.apiUrl || existing.apiUrl.includes('mailivox-backend.onrender.com')
    ? DEFAULT_API_URL
    : existing.apiUrl;

  await chrome.storage.local.set({
    apiUrl: nextApiUrl,
    minDelayMs: existing.minDelayMs || 2500,
    maxDelayMs: existing.maxDelayMs || 5500,
    maxDeepProfiles: existing.maxDeepProfiles || 50
  });
}

async function configureSidePanel() {
  if (!chrome.sidePanel) return;

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (_) {
    // Older Chromium builds may not support this; action.onClicked still opens it.
  }
}

async function handleMode1(profiles, searchUrl) {
  extractionState = freshState(1, profiles.length);
  notify('progressUpdate');

  try {
    if (!Array.isArray(profiles) || profiles.length === 0) {
      throw new Error('No LinkedIn profiles found on this page.');
    }

    const rawText = profilesToLeadIntelligenceText(profiles);
    const body = {
      rawText,
      sessionName: `Chrome Quick Extract ${new Date().toLocaleString()}`,
      excludeInterns: true,
      excludeFreshers: false
    };

    await apiEventStream('/api/run-pipeline', 'POST', body, (event) => {
      if (!extractionState.running) return;

      if (event.type === 'progress') {
        extractionState.progress.processed = event.data?.current || extractionState.progress.processed;
        extractionState.progress.total = event.data?.total || extractionState.progress.total;
      }

      if (event.type === 'profile_done') {
        extractionState.progress.processed = Math.max(
          extractionState.progress.processed,
          Number(event.data?.index || 0) + 1
        );
        extractionState.progress.emailsFound += Number(event.data?.emailCount || 0);
        extractionState.results.push(event.data);
      }

      if (event.type === 'complete') {
        extractionState.progress.processed = event.data?.processed || extractionState.progress.processed;
        extractionState.progress.emailsFound = event.data?.emailsGenerated || extractionState.progress.emailsFound;
        extractionState.summary = event.data;
      }

      notify('progressUpdate');
    });
  } catch (err) {
    extractionState.error = err.message;
  } finally {
    extractionState.running = false;
    await persistState();
    notify('extractionComplete');
  }
}

function profilesToLeadIntelligenceText(profiles) {
  return profiles
    .map(profile => {
      const company = cleanBlockLine(profile.company);
      const role = cleanBlockLine(profile.role);
      const headline = buildLeadIntelligenceHeadline(role, company);
      const lines = [
        cleanBlockLine(profile.fullName),
        headline,
        profile.location ? `Location: ${cleanBlockLine(profile.location)}` : '',
        company ? `Current: ${role ? `${role} at ` : ''}${company}` : '',
        profile.linkedinUrl ? `LinkedIn: ${cleanBlockLine(profile.linkedinUrl)}` : ''
      ].filter(Boolean);

      return lines.join('\n');
    })
    .join('\n\n');
}

function buildLeadIntelligenceHeadline(role, company) {
  if (role && company && !role.toLowerCase().includes(company.toLowerCase())) {
    return `Role: ${role} at ${company}`;
  }
  if (role) return `Role: ${role}`;
  if (company) return `Role: Employee at ${company}`;
  return '';
}

function cleanBlockLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function handleMode2(connectionUrls, connectionProfiles = []) {
  extractionState = freshState(2, connectionUrls.length);
  notify('progressUpdate');

  const results = [];
  
  // Build a map: URL → company info from search results
  // This is the AUTHORITATIVE source of company data — much more reliable
  // than re-scraping each profile page in a background tab.
  const profileMap = new Map();
  for (const p of connectionProfiles) {
    if (p?.linkedinUrl) profileMap.set(p.linkedinUrl, p);
  }
  
  // Create the session UPFRONT so it appears in the dashboard immediately
  const sessionName = `Chrome Deep Extract ${new Date().toLocaleString()}`;

  try {
    if (!Array.isArray(connectionUrls) || connectionUrls.length === 0) {
      throw new Error('No connection profile links found on this page.');
    }

    const settings = await chrome.storage.local.get(['minDelayMs', 'maxDelayMs']);
    const minDelayMs = Number(settings.minDelayMs || 2500);
    const maxDelayMs = Math.max(Number(settings.maxDelayMs || 5500), minDelayMs);

    // Initialize empty session immediately so frontend sees activity
    try {
      await apiJson('/api/extension/batch', 'POST', {
        contacts: [],
        sessionName,
        totalAttempted: connectionUrls.length,
        note: 'Deep extract started'
      });
    } catch (e) {
      console.warn('[mailivox] Initial session create failed:', e.message);
    }

    for (const rawUrl of connectionUrls) {
      if (!extractionState.running) break;

      let tab = null;
      try {
        const url = normalizeLinkedInUrl(rawUrl);
        tab = await chrome.tabs.create({ url, active: false });
        activeModeTab = tab.id;
        await waitForTabLoad(tab.id);
        await sleep(1600);

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/profile-extractor.js']
        });

        const contactInfo = await sendTabMessage(tab.id, { action: 'extractContactInfo' });
        if (contactInfo?.email) {
          // Merge: prefer company from SEARCH RESULTS (more reliable) over profile page
          const searchData = profileMap.get(url) || {};
          const item = {
            ...contactInfo,
            // Search results company is more reliable than profile-page extraction
            company: searchData.company || contactInfo.company || '',
            role: searchData.role || contactInfo.role || '',
            fullName: contactInfo.fullName || searchData.fullName || '',
            linkedinUrl: url
          };
          results.push(item);
          extractionState.results = results;
          extractionState.progress.emailsFound = results.length;

          // STREAM to backend immediately — don't wait for full batch
          try {
            await apiJson('/api/extension/batch', 'POST', {
              contacts: [item],
              sessionName,
              streaming: true
            });
          } catch (e) {
            console.warn('[mailivox] Stream push failed:', e.message);
          }
        }
        // Skip silently if no email
      } catch (err) {
        extractionState.error = err.message;
      } finally {
        extractionState.progress.processed++;
        await persistState();
        notify('progressUpdate');
        if (tab?.id) {
          try { await chrome.tabs.remove(tab.id); } catch (_) {}
          activeModeTab = null;
        }
      }

      const delay = randomInt(minDelayMs, maxDelayMs);
      await sleep(delay);
    }

    // Final summary call
    extractionState.summary = {
      sessionName,
      totalAttempted: connectionUrls.length,
      emailsFound: results.length,
      streamed: true
    };
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
  
  if (!mailivox_token) {
    throw new Error('Not authenticated. Please log in at the dashboard first, then reload the extension.');
  }
  
  const headers = { 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${mailivox_token}`;

  const res = await fetch(`${apiUrl || DEFAULT_API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Authentication expired. Please log in at the dashboard again.');
    }
    throw new Error(data.error || `Request failed with HTTP ${res.status}`);
  }
  return data;
}

async function apiEventStream(endpoint, method, body, onEvent) {
  const { apiUrl, mailivox_token } = await chrome.storage.local.get(['apiUrl', 'mailivox_token']);
  
  if (!mailivox_token) {
    throw new Error('Not authenticated. Please log in at the dashboard first, then reload the extension.');
  }
  
  const headers = { 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${mailivox_token}`;

  const res = await fetch(`${apiUrl || DEFAULT_API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw new Error('Authentication expired. Please log in at the dashboard again.');
    }
    throw new Error(data.error || `Request failed with HTTP ${res.status}`);
  }

  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (extractionState.running) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const dataLine = chunk
        .split('\n')
        .find(line => line.startsWith('data: '));
      if (!dataLine) continue;

      try {
        onEvent(JSON.parse(dataLine.slice(6)));
      } catch (_) {}
    }
  }

  try {
    await reader.cancel();
  } catch (_) {}
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
