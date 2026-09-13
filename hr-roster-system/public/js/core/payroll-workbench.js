(function payrollWorkbenchModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PayrollWorkbench = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPayrollWorkbench() {
  function normalizedText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function statusKey(item = {}) {
    const smsStatus = normalizedText(item.smsStatusName);
    const errorSummary = normalizedText(item.smsErrorSummary);
    if (smsStatus === '已取消' && errorSummary.includes('已撤回')) return 'withdrawn';
    if (item.displayStatus === '有异议') return 'dispute';
    if (item.displayStatus === '已签收') return 'signed';
    if (item.displayStatus === '待签字') return 'viewed_unsigned';
    if (item.displayStatus === '待查看') return 'unviewed';
    if (item.deliveryStatus === '发放失败' || smsStatus === '发送失败' || smsStatus === '无有效手机号') return 'failed';
    return 'pending';
  }

  function matchesKeyword(item, keyword) {
    const needle = normalizedText(keyword);
    if (!needle) return true;
    return [item.employeeName, item.phoneMasked, item.signedName]
      .some(value => normalizedText(value).includes(needle));
  }

  function filterRows(rows = [], filter = {}) {
    const status = filter.status || 'all';
    return rows.filter(item => (status === 'all' || statusKey(item) === status)
      && matchesKeyword(item, filter.keyword));
  }

  function countStatuses(rows = []) {
    const result = {
      all: rows.length,
      pending: 0,
      unviewed: 0,
      viewed_unsigned: 0,
      signed: 0,
      dispute: 0,
      failed: 0,
      withdrawn: 0
    };
    rows.forEach(item => { result[statusKey(item)] += 1; });
    return result;
  }

  return { statusKey, filterRows, countStatuses };
}));
