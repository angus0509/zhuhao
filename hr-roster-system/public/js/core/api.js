// API 请求、缓存与表格加载状态。logout 在入口脚本加载后才会被实际调用。
const _cache = new Map();

function cachedApi(path, ttl = 30000) {
  const entry = _cache.get(path);
  if (entry && Date.now() - entry.time < ttl) return Promise.resolve(entry.data);
  return api(path).then(data => {
    _cache.set(path, { data, time: Date.now() });
    return data;
  });
}

function clearCache() {
  _cache.clear();
}

function withTableLoading(wrapSelector, fn) {
  return async function (...args) {
    const wrap = $(wrapSelector);
    if (wrap) wrap.classList.add('loading');
    try {
      return await fn.apply(this, args);
    } finally {
      if (wrap) wrap.classList.remove('loading');
    }
  };
}

async function api(path, options = {}) {
  showLoading();
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {})
      },
      ...options
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`接口返回异常（${response.status}），请刷新页面后重试`);
    }
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      if (response.status === 401) logout(false, false);
      throw new Error(payload.message || `请求失败（${response.status}）`);
    }
    return payload.data;
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('网络连接失败，请检查网络后重试');
    }
    throw error;
  } finally {
    hideLoading();
  }
}

// 分页接口统一读取完整权限范围，确保桌面 Web、手机 Web 与小程序统计口径一致。
async function apiAllPages(path, query = '', pageSize = 200) {
  const params = new URLSearchParams(query || '');
  params.set('page', '1');
  params.set('pageSize', String(pageSize));
  const first = await api(`${path}?${params.toString()}`);
  if (!first || !Array.isArray(first.list)) return first;

  const pageCount = Math.ceil(Number(first.total || 0) / pageSize);
  const list = [...first.list];
  for (let startPage = 2; startPage <= pageCount; startPage += 4) {
    const pageNumbers = Array.from(
      { length: Math.min(4, pageCount - startPage + 1) },
      (_, index) => startPage + index
    );
    const pages = await Promise.all(pageNumbers.map(page => {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(page));
      return api(`${path}?${pageParams.toString()}`);
    }));
    pages.forEach(result => list.push(...(result.list || [])));
  }
  return { ...first, page: 1, pageSize, list };
}
