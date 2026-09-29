// public/js/views/daily-settlement.js：日结薪资独立工作区，金额只向薪资授权用户展示。
const dailySettlementState = {
  projects: [], projectId: 0, customerId: 0, shiftDate: '', runId: 0, runStatus: null,
  closureVersion: 0, closureStatus: 'OPEN', rows: [],
  selectedEmployeeIds: new Set(), listenersBound: false
};
const dailySettlementRequestGate = createRequestGate();

function dailySettlementCanManage() {
  return Array.isArray(state.user?.permissions) && state.user.permissions.includes('payroll:manage');
}

function dailySettlementRequestId(action) {
  return `${action}:${dailySettlementState.projectId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function dailySettlementMessage(message = '', type = '') {
  const element = $('#dailySettlementMessage');
  element.textContent = message;
  element.className = `attendance-workspace-status${message ? '' : ' hidden'}${type ? ` ${type}` : ''}`;
}

function dailySettlementProjectOptions() {
  const customers = [...new Map(dailySettlementState.projects.map(row => [Number(row.customerId), row.customerName])).entries()];
  const customer = $('#dailySettlementCustomer');
  customer.innerHTML = customers.length
    ? customers.map(([id, name]) => `<option value="${id}">${escapeHtml(name || '-')}</option>`).join('')
    : '<option value="">暂无授权客户</option>';
  if (!customers.some(([id]) => id === dailySettlementState.customerId)) {
    dailySettlementState.customerId = customers[0]?.[0] || 0;
  }
  customer.value = String(dailySettlementState.customerId || '');
  const projects = dailySettlementState.projects.filter(row => Number(row.customerId) === dailySettlementState.customerId);
  const project = $('#dailySettlementProject');
  project.innerHTML = projects.length
    ? projects.map(row => `<option value="${Number(row.projectId)}">${escapeHtml(row.projectName || '-')}</option>`).join('')
    : '<option value="">暂无授权项目</option>';
  if (!projects.some(row => Number(row.projectId) === dailySettlementState.projectId)) {
    dailySettlementState.projectId = Number(projects[0]?.projectId || 0);
  }
  project.value = String(dailySettlementState.projectId || '');
}

function dailySettlementStatusLabel(row) {
  return ({ READY: '待支付', PAID: '已支付', BLOCKED: `待处理：${row.blockedReason || '考勤异常'}`,
    NO_PAYMENT: '无需支付' })[row.status] || row.status || '-';
}

function renderDailySettlement(data = {}) {
  dailySettlementState.runId = Number(data.runId || 0);
  dailySettlementState.runStatus = data.runStatus || null;
  dailySettlementState.closureVersion = Number(data.closureVersion || 0);
  dailySettlementState.closureStatus = data.closureStatus || 'OPEN';
  dailySettlementState.rows = data.list || [];
  dailySettlementState.selectedEmployeeIds.clear();
  const summary = data.summary || {};
  $('#dailySettlementSummary').innerHTML = [
    ['employeeCount', '员工人数'], ['readyCount', '待支付'], ['blockedCount', '待处理'], ['paidCount', '已支付']
  ].map(([key, label]) => `<article><small>${label}</small><strong>${Number(summary[key] || 0)}</strong></article>`).join('')
    + `<article><small>待支付金额</small><strong>¥${escapeHtml(summary.readyAmount || '0.00')}</strong></article>`
    + `<article><small>已支付金额</small><strong>¥${escapeHtml(summary.paidAmount || '0.00')}</strong></article>`;
  const canManage = dailySettlementCanManage();
  const body = $('#dailySettlementBody');
  body.innerHTML = dailySettlementState.rows.length ? dailySettlementState.rows.map(row => {
    const ready = canManage && dailySettlementState.closureStatus === 'CONFIRMED'
      && dailySettlementState.runStatus === 'PREVIEW' && row.status === 'READY';
    const actions = [
      `<button type="button" class="text-button" data-daily-detail="${Number(row.employeeId)}">明细</button>`,
      ready ? `<button type="button" class="text-button" data-daily-confirm="${Number(row.employeeId)}">确认已支付</button>` : '',
      canManage && row.status === 'PAID' && row.paymentId
        ? `<button type="button" class="text-button" data-daily-revoke="${Number(row.paymentId)}">撤销</button>` : ''
    ].join('');
    return `<tr><td><input type="checkbox" data-daily-select="${Number(row.employeeId)}" aria-label="选择${escapeHtml(row.name || '员工')}" ${ready ? '' : 'disabled'}></td>`
      + `<td>${escapeHtml(row.name || '-')}</td><td>${escapeHtml(row.shiftType || '-')}</td>`
      + `<td>${escapeHtml(row.workedHours || '0.00')}</td><td>${escapeHtml(row.approvedHours || '0.00')}</td>`
      + `<td>¥${escapeHtml(row.hourlyRate || '0.00')}</td><td>¥${escapeHtml(row.baseAmount || '0.00')}</td>`
      + `<td>¥${escapeHtml(row.allowanceAmount || '0.00')}</td><td>¥${escapeHtml(row.earnedAmount || '0.00')}</td>`
      + `<td>${escapeHtml(dailySettlementStatusLabel(row))}</td><td>${actions}</td></tr>`;
  }).join('') : '<tr><td colspan="11" class="attendance-empty">当前条件下暂无日结记录</td></tr>';
  updateDailySettlementSelection();
  if (dailySettlementState.closureStatus !== 'CONFIRMED') dailySettlementMessage('该日期考勤尚未确认，不能标记已支付。', 'warning');
  else if (dailySettlementState.runStatus !== 'PREVIEW' && canManage) dailySettlementMessage('当前没有有效预览，请点击“刷新预览”。', 'warning');
  else dailySettlementMessage();
}

function updateDailySettlementSelection() {
  $('#dailySettlementSelection').textContent = `已选 ${dailySettlementState.selectedEmployeeIds.size} 人`;
  $('#dailySettlementBatchConfirm').disabled = !dailySettlementCanManage()
    || dailySettlementState.closureStatus !== 'CONFIRMED'
    || dailySettlementState.runStatus !== 'PREVIEW'
    || !dailySettlementState.runId || !dailySettlementState.selectedEmployeeIds.size;
}

async function refreshDailySettlement({ preview = false } = {}) {
  const projectId = dailySettlementState.projectId;
  const shiftDate = dailySettlementState.shiftDate;
  if (!projectId || !shiftDate) {
    renderDailySettlement();
    dailySettlementMessage('请选择项目和日期', 'warning');
    return;
  }
  const request = dailySettlementRequestGate.begin('list');
  dailySettlementMessage('正在加载日结记录…');
  try {
    if (preview && dailySettlementCanManage()) {
      await api('/api/wage-daily-settlements/preview', {
        method: 'POST', body: { projectId, shiftDate, clientRequestId: dailySettlementRequestId('preview') }
      });
      if (!dailySettlementRequestGate.isCurrent(request)) return;
    }
    const params = new URLSearchParams({ projectId: String(projectId), shiftDate,
      status: $('#dailySettlementStatus').value, keyword: $('#dailySettlementKeyword').value.trim() });
    const data = await api(`/api/wage-daily-settlements?${params}`);
    if (!dailySettlementRequestGate.isCurrent(request) || projectId !== dailySettlementState.projectId
      || shiftDate !== dailySettlementState.shiftDate) return;
    renderDailySettlement(data);
  } catch (error) {
    if (!dailySettlementRequestGate.isCurrent(request)) return;
    dailySettlementState.selectedEmployeeIds.clear(); updateDailySettlementSelection();
    dailySettlementMessage(error.message || '日结加载失败，请重试', 'error');
  }
}

async function confirmDailySettlementBatch(employeeIds, button) {
  if (!dailySettlementCanManage() || !employeeIds.length || !dailySettlementState.runId
    || dailySettlementState.closureStatus !== 'CONFIRMED'
    || dailySettlementState.runStatus !== 'PREVIEW') return;
  const confirmed = await confirmDialog({ title: '确认已支付',
    message: `确认已向 ${employeeIds.length} 位员工完成支付？此操作会留下审计记录。`, confirmText: '确认已支付' });
  if (!confirmed) return;
  await withSubmitLock(button, async () => {
    try {
      await api('/api/wage-daily-settlements/batch-confirm', { method: 'POST', body: {
        projectId: dailySettlementState.projectId, shiftDate: dailySettlementState.shiftDate,
        runId: dailySettlementState.runId, closureVersion: dailySettlementState.closureVersion,
        employeeIds, clientRequestId: dailySettlementRequestId('paid')
      } });
      toast('日结已确认支付');
      await refreshDailySettlement({ preview: true });
    } catch (error) {
      if (error.status === 409) { dailySettlementState.selectedEmployeeIds.clear(); await refreshDailySettlement({ preview: true }); }
      toast(error.message || '确认失败', 'error');
    }
  }, '确认中…');
}

async function revokeDailySettlement(paymentId, button) {
  if (!dailySettlementCanManage() || !paymentId) return;
  const reason = String(window.prompt('请输入撤销原因') || '').trim();
  if (!reason) { toast('撤销必须填写原因', 'error'); return; }
  const confirmed = await confirmDialog({ title: '撤销已支付记录',
    message: '撤销后保留原支付记录和操作流水。确认撤销？', confirmText: '确认撤销' });
  if (!confirmed) return;
  await withSubmitLock(button, async () => {
    try {
      await api(`/api/wage-daily-settlements/${paymentId}/revoke`, { method: 'POST',
        body: { reason, clientRequestId: dailySettlementRequestId('revoke') } });
      toast('已撤销支付记录'); await refreshDailySettlement({ preview: true });
    } catch (error) {
      if (error.status === 409) await refreshDailySettlement({ preview: true });
      toast(error.message || '撤销失败', 'error');
    }
  }, '撤销中…');
}

async function showDailySettlementDetail(employeeId) {
  const row = dailySettlementState.rows.find(item => Number(item.employeeId) === employeeId);
  if (!row) return;
  const dialog = $('#dailySettlementDetailDialog');
  $('#dailySettlementDetailTitle').textContent = `${row.name || '员工'} · 日结明细`;
  let allowanceItems = [];
  try { allowanceItems = typeof row.allowanceItems === 'string' ? JSON.parse(row.allowanceItems) : (row.allowanceItems || []); }
  catch (_error) { allowanceItems = []; }
  const fields = [
    ['日期', dailySettlementState.shiftDate], ['班次', row.shiftType],
    ['实际工时', `${row.workedHours} 小时`], ['核准工时', `${row.approvedHours} 小时`],
    ['计薪分钟', `${row.payableMinutes || 0} 分钟`], ['时薪', `¥${row.hourlyRate || '0.00'}`],
    ['基础工资', `¥${row.baseAmount || '0.00'}`], ['补贴', `¥${row.allowanceAmount || '0.00'}`],
    ['应得工资', `¥${row.earnedAmount || '0.00'}`], ['状态', dailySettlementStatusLabel(row)]
  ];
  $('#dailySettlementDetailContent').innerHTML = `<div class="daily-settlement-detail-list">${fields.map(([label, value]) =>
    `<div><strong>${escapeHtml(label)}：</strong>${escapeHtml(value || '-')}</div>`).join('')}`
    + `<div><strong>补贴项：</strong>${escapeHtml(Array.isArray(allowanceItems)
      ? allowanceItems.map(item => `${item.name || item.allowanceName || '补贴'} ¥${item.amount || '0.00'}`).join('、') || '无'
      : '无')}</div></div><h3>支付记录</h3><div id="dailySettlementEvents">${row.paymentId ? '加载中…' : '暂无记录'}</div>`;
  dialog.showModal();
  if (!row.paymentId) return;
  try {
    const data = await api(`/api/wage-daily-settlements/${Number(row.paymentId)}/events`);
    if (!dialog.open) return;
    $('#dailySettlementEvents').innerHTML = (data.list || []).length
      ? data.list.map(event => `<p>${escapeHtml(event.operatedAt || '')} · ${escapeHtml(event.actionType || '')} · ¥${escapeHtml(event.amount || '0.00')} · ${escapeHtml(event.remark || '')}</p>`).join('')
      : '暂无记录';
  } catch (error) { if (dialog.open) $('#dailySettlementEvents').textContent = error.message || '支付记录加载失败'; }
}

function bindDailySettlementEvents() {
  if (dailySettlementState.listenersBound) return;
  dailySettlementState.listenersBound = true;
  $('#dailySettlementCustomer').addEventListener('change', event => {
    dailySettlementRequestGate.invalidateAll(); dailySettlementState.customerId = Number(event.target.value);
    dailySettlementState.projectId = 0; dailySettlementProjectOptions(); refreshDailySettlement();
  });
  $('#dailySettlementProject').addEventListener('change', event => {
    dailySettlementRequestGate.invalidateAll(); dailySettlementState.projectId = Number(event.target.value);
    refreshDailySettlement();
  });
  $('#dailySettlementDate').addEventListener('change', event => {
    dailySettlementRequestGate.invalidateAll(); dailySettlementState.shiftDate = event.target.value;
    refreshDailySettlement();
  });
  $('#dailySettlementStatus').addEventListener('change', () => refreshDailySettlement());
  $('#dailySettlementKeyword').addEventListener('keydown', event => {
    if (event.key === 'Enter') refreshDailySettlement();
  });
  $('#dailySettlementRefresh').addEventListener('click', () => refreshDailySettlement({ preview: true }));
  $('#dailySettlementBatchConfirm').addEventListener('click', event =>
    confirmDailySettlementBatch([...dailySettlementState.selectedEmployeeIds], event.currentTarget));
  $('#dailySettlementBody').addEventListener('change', event => {
    const checkbox = event.target.closest('[data-daily-select]');
    if (!checkbox) return;
    const id = Number(checkbox.dataset.dailySelect);
    if (checkbox.checked) dailySettlementState.selectedEmployeeIds.add(id);
    else dailySettlementState.selectedEmployeeIds.delete(id);
    updateDailySettlementSelection();
  });
  $('#dailySettlementBody').addEventListener('click', event => {
    const detail = event.target.closest('[data-daily-detail]');
    const single = event.target.closest('[data-daily-confirm]');
    const revoke = event.target.closest('[data-daily-revoke]');
    if (detail) showDailySettlementDetail(Number(detail.dataset.dailyDetail));
    if (single) confirmDailySettlementBatch([Number(single.dataset.dailyConfirm)], single);
    if (revoke) revokeDailySettlement(Number(revoke.dataset.dailyRevoke), revoke);
  });
  $('#dailySettlementDetailClose').addEventListener('click', () => $('#dailySettlementDetailDialog').close());
}

async function loadDailySettlement() {
  bindDailySettlementEvents();
  $('#dailySettlementRefresh').textContent = dailySettlementCanManage() ? '刷新预览' : '刷新列表';
  if (!dailySettlementState.shiftDate) dailySettlementState.shiftDate = attendanceDate();
  $('#dailySettlementDate').value = dailySettlementState.shiftDate;
  const request = dailySettlementRequestGate.begin('projects');
  try {
    const data = await api('/api/wage-daily-settlements/projects');
    if (!dailySettlementRequestGate.isCurrent(request)) return;
    dailySettlementState.projects = data.list || [];
    const selected = dailySettlementState.projects.find(row => Number(row.projectId) === dailySettlementState.projectId);
    dailySettlementState.customerId = Number(selected?.customerId || dailySettlementState.projects[0]?.customerId || 0);
    dailySettlementProjectOptions();
    await refreshDailySettlement();
  } catch (error) { if (dailySettlementRequestGate.isCurrent(request)) dailySettlementMessage(error.message || '项目加载失败', 'error'); }
}
