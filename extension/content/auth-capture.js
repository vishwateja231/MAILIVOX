(function () {
  try {
    const token = window.localStorage.getItem('mailivox_token');
    if (token) {
      chrome.runtime.sendMessage({ action: 'MAILIVOX_TOKEN_FOUND', token });
    }
  } catch (_) {}
})();
