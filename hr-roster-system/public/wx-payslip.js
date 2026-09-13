(() => {
  const landing = document.querySelector('[data-url-scheme]');
  const openButton = document.querySelector('[data-open-miniprogram]');
  if (!landing || !openButton) return;

  const urlScheme = String(landing.getAttribute('data-url-scheme') || '');
  if (!/^weixin:\/\/dl\/business\/\?t=[A-Za-z0-9_-]+$/.test(urlScheme)) return;

  const openMiniProgram = () => {
    window.location.href = urlScheme;
  };
  openButton.addEventListener('click', event => {
    event.preventDefault();
    openMiniProgram();
  });
  window.setTimeout(openMiniProgram, 300);
})();
