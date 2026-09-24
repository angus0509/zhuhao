// 大体积浏览器依赖按需加载；同一资源的并发请求复用同一个 Promise。
const lazyScriptPromises = new Map();

function loadScriptOnce(src, globalName, errorMessage) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (lazyScriptPromises.has(src)) return lazyScriptPromises.get(src);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.lazyAsset = globalName;
    script.onload = () => {
      if (window[globalName]) resolve(window[globalName]);
      else reject(new Error(errorMessage));
    };
    script.onerror = () => reject(new Error(errorMessage));
    document.head.appendChild(script);
  });

  lazyScriptPromises.set(src, promise);
  promise.catch(() => lazyScriptPromises.delete(src));
  return promise;
}

function ensureExcelJs() {
  return loadScriptOnce('/vendor/exceljs.min.js', 'ExcelJS', 'Excel 组件加载失败，请检查网络后重试');
}

function ensureChartJs() {
  return loadScriptOnce(
    'https://cdn.bootcdn.net/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
    'Chart',
    '图表组件加载失败'
  );
}
