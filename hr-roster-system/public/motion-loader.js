(function enableOptionalMotionTheme() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('motion') !== '1') return;

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/theme-motion.css';
  document.head.appendChild(stylesheet);
  document.documentElement.classList.add('motion-enabled');
}());
