// Mailivox Auth Capture — syncs JWT token from frontend to extension storage
// Watches localStorage for changes so token is captured after login

(function () {
  let lastToken = null;

  function syncToken() {
    try {
      const token = window.localStorage.getItem('mailivox_token');
      if (token && token !== lastToken && token.split('.').length === 3) {
        lastToken = token;
        chrome.runtime.sendMessage({ action: 'MAILIVOX_TOKEN_FOUND', token }, () => {
          // Swallow errors (extension may not be ready)
          void chrome.runtime.lastError;
        });
      }
    } catch (e) {
      // Storage access denied — give up silently
    }
  }

  // Initial sync
  syncToken();

  // Re-sync periodically (catches login after page load)
  setInterval(syncToken, 2000);

  // Listen for storage changes from same-tab updates
  const origSetItem = window.localStorage.setItem;
  window.localStorage.setItem = function (key, value) {
    origSetItem.apply(this, arguments);
    if (key === 'mailivox_token' && value !== lastToken) {
      lastToken = value;
      try {
        chrome.runtime.sendMessage({ action: 'MAILIVOX_TOKEN_FOUND', token: value }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) {}
    }
  };

  // Listen for cross-tab storage events
  window.addEventListener('storage', (e) => {
    if (e.key === 'mailivox_token' && e.newValue) {
      syncToken();
    }
  });
})();
