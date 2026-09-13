(function exposeFormSubmit(globalScope) {
  async function withSubmitLock(button, task, pendingText = '提交中…') {
    if (!button) return task();
    if (button.dataset.submitting === '1') return undefined;
    const originalText = button.textContent;
    const originalDisabled = button.disabled;
    button.dataset.submitting = '1';
    button.disabled = true;
    button.textContent = pendingText;
    try {
      return await task();
    } finally {
      delete button.dataset.submitting;
      button.disabled = originalDisabled;
      button.textContent = originalText;
    }
  }

  globalScope.withSubmitLock = withSubmitLock;
  if (typeof module !== 'undefined' && module.exports) module.exports = { withSubmitLock };
}(typeof globalThis !== 'undefined' ? globalThis : window));
