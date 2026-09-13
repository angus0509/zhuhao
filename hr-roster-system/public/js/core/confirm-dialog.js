(function exposeConfirmDialog(globalScope) {
  let pendingResolve = null;

  function finish(result) {
    if (!pendingResolve) return;
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve(Boolean(result));
  }

  function confirmDialog(options = {}) {
    const dialog = document.querySelector('#appConfirmDialog');
    if (!dialog) return Promise.resolve(false);

    if (pendingResolve) {
      finish(false);
      if (dialog.open) dialog.close();
    }

    const title = String(options.title || '请确认操作');
    const message = String(options.message || '确认继续执行当前操作吗？');
    const confirmText = String(options.confirmText || '确认');
    const danger = options.danger === true;
    const titleElement = dialog.querySelector('[data-confirm-title]');
    const messageElement = dialog.querySelector('[data-confirm-message]');
    const confirmButton = dialog.querySelector('[data-confirm-accept]');
    const cancelButton = dialog.querySelector('[data-confirm-cancel]');

    titleElement.textContent = title;
    messageElement.textContent = message;
    confirmButton.textContent = confirmText;
    confirmButton.className = danger ? 'danger-button' : 'primary-button';

    return new Promise(resolve => {
      pendingResolve = resolve;
      confirmButton.onclick = () => {
        finish(true);
        dialog.close();
      };
      cancelButton.onclick = () => {
        finish(false);
        dialog.close();
      };
      dialog.oncancel = event => {
        event.preventDefault();
        finish(false);
        dialog.close();
      };
      dialog.onclose = () => finish(false);
      dialog.showModal();
      window.setTimeout(() => confirmButton.focus(), 0);
    });
  }

  globalScope.confirmDialog = confirmDialog;
  if (typeof module !== 'undefined' && module.exports) module.exports = { confirmDialog };
}(typeof globalThis !== 'undefined' ? globalThis : window));
