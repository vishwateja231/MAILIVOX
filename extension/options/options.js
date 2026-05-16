const DEFAULTS = {
  apiUrl: 'https://mailivox-backend.onrender.com',
  minDelayMs: 2500,
  maxDelayMs: 5500,
  maxDeepProfiles: 50
};

const fields = {
  apiUrl: document.getElementById('apiUrl'),
  token: document.getElementById('token'),
  minDelayMs: document.getElementById('minDelayMs'),
  maxDelayMs: document.getElementById('maxDelayMs'),
  maxDeepProfiles: document.getElementById('maxDeepProfiles'),
  status: document.getElementById('status')
};

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('saveBtn').addEventListener('click', saveSettings);
document.getElementById('dashboardBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://mailivox.vercel.app' });
});

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    'apiUrl',
    'mailivox_token',
    'minDelayMs',
    'maxDelayMs',
    'maxDeepProfiles'
  ]);

  fields.apiUrl.value = stored.apiUrl || DEFAULTS.apiUrl;
  fields.token.value = stored.mailivox_token || '';
  fields.minDelayMs.value = stored.minDelayMs || DEFAULTS.minDelayMs;
  fields.maxDelayMs.value = stored.maxDelayMs || DEFAULTS.maxDelayMs;
  fields.maxDeepProfiles.value = stored.maxDeepProfiles || DEFAULTS.maxDeepProfiles;
}

async function saveSettings() {
  const apiUrl = fields.apiUrl.value.trim().replace(/\/+$/, '') || DEFAULTS.apiUrl;
  const token = fields.token.value.trim();
  const minDelayMs = Number(fields.minDelayMs.value || DEFAULTS.minDelayMs);
  const maxDelayMs = Number(fields.maxDelayMs.value || DEFAULTS.maxDelayMs);
  const maxDeepProfiles = Number(fields.maxDeepProfiles.value || DEFAULTS.maxDeepProfiles);

  if (maxDelayMs < minDelayMs) {
    fields.status.textContent = 'Max delay must be greater than or equal to min delay.';
    return;
  }

  await chrome.storage.local.set({
    apiUrl,
    mailivox_token: token,
    minDelayMs,
    maxDelayMs,
    maxDeepProfiles
  });

  fields.status.textContent = 'Settings saved.';
}
