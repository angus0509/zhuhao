// 通用展示与交互工具。业务视图通过经典脚本共享这些函数。
function debounce(fn, delay = 350) {
  let timer;
  return function (...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), delay);
  };
}

function toast(message, type = '') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show';
  if (type) el.classList.add(type);
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    el.classList.remove('show');
  }, type === 'error' ? 4000 : 2200);
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function animateCounter(el, target, duration = 600) {
  if (!el) return;
  const finalValue = String(target ?? '');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = finalValue;
    return;
  }
  const raw = Number(finalValue.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(raw)) {
    el.textContent = finalValue;
    return;
  }
  const prefix = finalValue.trim().startsWith('¥') ? '¥' : '';
  const suffix = finalValue.trim().endsWith('%') ? '%' : '';
  const start = performance.now();
  const step = now => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(raw * eased);
    el.textContent = `${prefix}${current.toLocaleString('zh-CN')}${suffix}`;
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = finalValue;
  };
  requestAnimationFrame(step);
}

function setAnimatedMetric(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (document.documentElement.classList.contains('motion-enabled')) animateCounter(el, value);
  else el.textContent = value;
}

function optionHtml(rows, valueKey, labelKey) {
  return rows.map(row => `<option value="${escapeHtml(row[valueKey])}">${escapeHtml(row[labelKey])}</option>`).join('');
}

function badge(text, tone = 'green') {
  const safeTone = ['green', 'blue', 'amber', 'red', 'neutral'].includes(tone) ? tone : 'neutral';
  return `<span class="status-pill ${safeTone}">${escapeHtml(text || '-')}</span>`;
}

function contractTone(text) {
  if (text === '已签') return 'green';
  if (text === '即将到期') return 'amber';
  if (text === '未签' || text === '已过期') return 'red';
  return 'blue';
}

function statusTone(status) {
  if (status === 2) return 'green';
  if (status === 1) return 'blue';
  if (status === 3) return 'amber';
  return 'red';
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
