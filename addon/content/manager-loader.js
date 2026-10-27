/* Runs in the final chrome XHTML document, never in its initial about:blank window. */
(() => {
  let started = false;
  const bridge = window.arguments && window.arguments[0];
  const failure = error => {
    try { bridge?.onFailure?.(error); } catch { /* Display an error even if the parent has closed. */ }
    const app = document.getElementById('app');
    if (app) {
      app.setAttribute('data-smart-tags-state', 'error');
      app.textContent = 'Smart Tags could not connect this window to Zotero. Close it and reopen Smart Tags from the Tools menu. ' + (error?.message || String(error));
    }
  };
  const ready = () => {
    if (started) return;
    started = true;
    try {
      if (!bridge || typeof bridge.onReady !== 'function') throw new Error('The manager window bridge is unavailable.');
      bridge.onReady(window);
    } catch (error) { failure(error); }
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
  window.addEventListener('unload', () => {
    try { bridge?.onClosed?.(window); } catch { /* The extension may have shut down first. */ }
  }, { once: true });
})();
