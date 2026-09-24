// API 请求、缓存与表格加载状态。logout 在入口脚本加载后才会被实际调用。
const _cache = new Map();
const WEB_AUTH_MESSAGE_KEY = 'hrRosterAuthMessage';

function rememberAuthMessage(message) {
  sessionStorage.setItem(WEB_AUTH_MESSAGE_KEY, String(message || '登录已过期，请重新登录'));
}

function consumeAuthMessage() {
  const message = sessionStorage.getItem(WEB_AUTH_MESSAGE_KEY) || '';
  sessionStorage.removeItem(WEB_AUTH_MESSAGE_KEY);
  return message;
}

function normalizeRequestOptions(options = {}) {
  const normalized = { ...options };
  const context = String(normalized.context || '').trim();
  const suppressAuthFeedback = normalized.suppressAuthFeedback === true;
  delete normalized.context;
  delete normalized.suppressAuthFeedback;
  const isFormData = typeof FormData !== 'undefined' && normalized.body instanceof FormData;
  const isBlob = typeof Blob !== 'undefined' && normalized.body instanceof Blob;
  if (normalized.body && typeof normalized.body === 'object' && !isFormData && !isBlob) {
    normalized.body = JSON.stringify(normalized.body);
  }
  normalized.headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(normalized.headers || {})
  };
  return { normalized, context, suppressAuthFeedback };
}

function operationErrorMessage(message, context = '') {
  const cleanMessage = String(message || '请求失败').trim();
  return context ? `${context}：${cleanMessage}` : cleanMessage;
}

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = Number(status) || 0;
  return error;
}

function createSessionSupersededError() {
  const error = new Error('登录账号已切换，已忽略上一账号的过期响应');
  error.code = 'SESSION_SUPERSEDED';
  return error;
}

function isSessionSupersededError(error) {
  return error?.code === 'SESSION_SUPERSEDED';
}

function assertCurrentSession(requestSessionVersion) {
  if (Number(state.sessionVersion) !== Number(requestSessionVersion)) {
    throw createSessionSupersededError();
  }
}

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
  const requestSessionVersion = state.sessionVersion;
  showLoading();
  const { normalized, context, suppressAuthFeedback } = normalizeRequestOptions(options);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...normalized
    });
    assertCurrentSession(requestSessionVersion);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (response.status === 401) {
        const message = '登录已过期，请重新登录';
        setSystemStatus('auth');
        if (!suppressAuthFeedback) {
          rememberAuthMessage(message);
          logout(false, false);
          if (typeof setLoginError === 'function') setLoginError(message);
        }
        throw createHttpError(operationErrorMessage(message, context), response.status);
      }
      setSystemStatus('error');
      throw createHttpError(
        operationErrorMessage(`接口返回异常（${response.status}），请刷新页面后重试`, context),
        response.status
      );
    }
    const payload = await response.json();
    assertCurrentSession(requestSessionVersion);
    if (!response.ok || payload.code !== 0) {
      const message = payload.message || `请求失败（${response.status}）`;
      if (response.status === 401) {
        setSystemStatus('auth');
        if (!suppressAuthFeedback) {
          rememberAuthMessage(message);
          logout(false, false);
          if (typeof setLoginError === 'function') setLoginError(message);
        }
      } else if (response.status >= 500) {
        setSystemStatus('error');
      }
      throw createHttpError(operationErrorMessage(message, context), response.status);
    }
    return payload.data;
  } catch (error) {
    // 当前请求收到 401 后会主动清理会话，不能再把这次正常退出误判为旧账号响应。
    if (isSessionSupersededError(error) || Number(error?.status) === 401) throw error;
    assertCurrentSession(requestSessionVersion);
    if (error.name === 'TypeError') {
      setSystemStatus('error');
      throw new Error(operationErrorMessage('网络连接失败，请检查网络后重试', context));
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
