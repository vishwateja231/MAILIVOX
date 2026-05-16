const DEFAULT_API_URL = 'http://localhost:3000';
const DASHBOARD_URL = 'http://localhost:5173';

const els = {
  pageLabel: document.getElementById('pageLabel'),
  connectionDot: document.getElementById('connectionDot'),
  connectionText: document.getElementById('connectionText'),
  profileCount: document.getElementById('profileCount'),
  connectionCount: document.getElementById('connectionCount'),
  quickBtn: document.getElementById('quickBtn'),
  deepBtn: document.getElementById('deepBtn'),
  stopBtn: document.getElementById('stopBtn'),
  optionsBtn: document.getElementById('optionsBtn'),
  dashboardBtn: document.getElementById('dashboardBtn'),
  progressLabel: document.getElementById('progressLabel'),
  progressNumbers: document.getElementById('progressNumbers'),
  progressBar: document.getElementById('progressBar'),
  emailsFound: document.getElementById('emailsFound'),
  message: document.getElementById('message')
};

let activeTab = null;
let detectedProfiles = [];
let detectedConnections = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  await checkBackend();
  await loadActiveTab();
  await refreshCounts();
  await refreshStatus();
}

function bindEvents() {
  els.quickBtn.addEventListener('click', startQuickExtract);
  els.deepBtn.addEventListener('click', startDeepExtract);
  els.stopBtn.addEventListener('click', stopExtraction);
  els.optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.dashboardBtn.addEventListener('click', () => chrome.tabs.create({ url: DASHBOARD_URL }));

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'progressUpdate' || msg.action === 'extractionComplete') {
      renderStatus(msg.state || msg);
      if (msg.action === 'extractionComplete') {
        const state = msg.state || msg;
        setMessage(state.error ? state.error : 'Extraction complete.', state.error ? 'error' : 'success');
      }
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    refreshCurrentTabContext();
  });

  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'complete' && activeTab?.id === tabId) {
      refreshCurrentTabContext();
    }
  });
}

async function refreshCurrentTabContext() {
  await loadActiveTab();
  await refreshCounts();
}

async function getSettings() {
  const stored = await chrome.storage.local.get(['apiUrl']);
  const apiUrl = !stored.apiUrl || stored.apiUrl.includes('mailivox-backend.onrender.com')
    ? DEFAULT_API_URL
    : stored.apiUrl;
  if (apiUrl !== stored.apiUrl) {
    await chrome.storage.local.set({ apiUrl });
  }
  return { apiUrl };
}

async function checkBackend() {
  try {
    const { apiUrl } = await getSettings();
    const res = await fetch(`${apiUrl}/api/extension/ping`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { mailivox_token } = await chrome.storage.local.get('mailivox_token');
    els.connectionDot.className = 'dot ok';
    els.connectionText.textContent = mailivox_token ? 'Backend connected, token saved' : 'Backend connected, token not saved';
  } catch (err) {
    els.connectionDot.className = 'dot bad';
    els.connectionText.textContent = 'Backend unavailable';
    setMessage(err.message, 'error');
  }
}

async function loadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  const url = activeTab?.url || '';
  if (url.includes('linkedin.com')) {
    els.pageLabel.textContent = new URL(url).pathname;
  } else {
    els.pageLabel.textContent = 'Open a LinkedIn page';
  }
}

async function refreshCounts() {
  detectedProfiles = [];
  detectedConnections = [];

  if (!activeTab?.id || !activeTab.url?.includes('linkedin.com')) {
    els.quickBtn.disabled = true;
    els.deepBtn.disabled = true;
    return;
  }

  await ensureContentScripts(activeTab.id);

  const profiles = await sendTabMessage(activeTab.id, { action: 'scrapeProfiles' });
  detectedProfiles = Array.isArray(profiles?.profiles) ? profiles.profiles : [];
  els.profileCount.textContent = String(detectedProfiles.length);

  const connections = await sendTabMessage(activeTab.id, { action: 'getConnectionUrls' });
  detectedConnections = Array.isArray(connections?.connections) ? connections.connections : [];
  els.connectionCount.textContent = String(detectedConnections.length);

  els.quickBtn.disabled = detectedProfiles.length === 0;
  els.deepBtn.disabled = detectedConnections.length === 0;
}

async function ensureContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/scraper.js'] });
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/connections.js'] });
  } catch (_) {}
}

function sendTabMessage(tabId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response);
    });
  });
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(response);
    });
  });
}

async function startQuickExtract() {
  if (detectedProfiles.length === 0) return;
  setMessage(`Sending ${detectedProfiles.length} visible profiles to Lead Intelligence...`);
  await sendRuntimeMessage({
    action: 'startMode1',
    profiles: detectedProfiles,
    searchUrl: activeTab?.url || ''
  });
  await refreshStatus();
}

async function startDeepExtract() {
  if (detectedConnections.length === 0) return;
  const limit = await getDeepLimit();
  const connectionUrls = detectedConnections.slice(0, limit);
  setMessage(`Starting deep extract for ${connectionUrls.length} connections...`);
  await sendRuntimeMessage({
    action: 'startMode2',
    connectionUrls
  });
  await refreshStatus();
}

async function getDeepLimit() {
  const { maxDeepProfiles } = await chrome.storage.local.get('maxDeepProfiles');
  const parsed = Number(maxDeepProfiles || 50);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

async function stopExtraction() {
  await sendRuntimeMessage({ action: 'stopExtraction' });
  setMessage('Stopped. All extraction activities halted.', 'error');
  // Reset UI immediately
  els.stopBtn.disabled = true;
  els.quickBtn.disabled = detectedProfiles.length === 0;
  els.deepBtn.disabled = detectedConnections.length === 0;
  els.progressLabel.textContent = 'Stopped';
}

async function refreshStatus() {
  const state = await sendRuntimeMessage({ action: 'getStatus' }).catch(() => null);
  if (state) renderStatus(state);
}

function renderStatus(state) {
  const progress = state.progress || { processed: 0, total: 0, emailsFound: 0 };
  const total = progress.total || 0;
  const processed = progress.processed || 0;
  const pct = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  els.progressLabel.textContent = state.running ? `Mode ${state.mode} running` : 'Idle';
  els.progressNumbers.textContent = `${processed}/${total}`;
  els.progressBar.style.width = `${pct}%`;
  els.emailsFound.textContent = state.mode === 1
    ? `Emails generated: ${progress.emailsFound || 0}`
    : `Emails found: ${progress.emailsFound || 0}`;
  els.stopBtn.disabled = !state.running;
  els.quickBtn.disabled = state.running || detectedProfiles.length === 0;
  els.deepBtn.disabled = state.running || detectedConnections.length === 0;
}

function setMessage(text, kind = '') {
  els.message.textContent = text || '';
  els.message.className = `message ${kind}`.trim();
}
