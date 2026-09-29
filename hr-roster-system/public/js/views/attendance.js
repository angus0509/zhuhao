const attendanceState = {
  projects: [], projectId: 0, customerId: 0, selectedGeofenceIds: [], listenersBound: false,
  closureStatus: 'OPEN'
};
const attendanceRequestGate = createRequestGate();

function attendanceMinutes(value) {
  const minutes = Number(value || 0);
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}

function attendanceDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function attendanceCan(permission) {
  return Array.isArray(state.user?.permissions) && state.user.permissions.includes(permission);
}

function attendanceErrorMessage(error) {
  return error?.status === 403 || error?.statusCode === 403 ? '项目不存在或无权访问' : (error?.message || '加载失败，请重试');
}

function setAttendanceStatus(message = '', type = '') {
  const element = $('#attendanceWorkspaceStatus');
  if (!element) return;
  element.textContent = message;
  element.className = `attendance-workspace-status${message ? '' : ' hidden'}${type ? ` ${type}` : ''}`;
}

function attendanceEmptyRow(columns, message, retryAction = '') {
  const retry = retryAction ? `<button type="button" class="text-button" data-attendance-retry="${retryAction}">重试</button>` : '';
  return `<tr><td colspan="${columns}" class="attendance-empty">${escapeHtml(message)} ${retry}</td></tr>`;
}

function setAttendanceDisabled(disabled) {
  ['attendanceProjectFilter', 'attendanceDate', 'attendanceMonth', 'attendanceRefresh'].forEach(id => {
    const element = $(`#${id}`); if (element) element.disabled = disabled;
  });
  ['attendanceProjectSettingsForm', 'attendanceCalendarForm', 'attendanceGeofenceForm'].forEach(id => {
    $(`#${id}`)?.querySelectorAll('input,select,button').forEach(control => { control.disabled = disabled; });
  });
}

function renderAttendanceProjectOptions() {
  const customerSelect = $('#attendanceCustomerFilter');
  const projectSelect = $('#attendanceProjectFilter');
  const customers = [...new Map(attendanceState.projects.map(project => [Number(project.customerId), project.customerName])).entries()];
  customerSelect.innerHTML = customers.length
    ? customers.map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('')
    : '<option value="">暂无授权客户</option>';
  if (attendanceState.customerId) customerSelect.value = String(attendanceState.customerId);
  const projects = attendanceState.projects.filter(project => Number(project.customerId) === attendanceState.customerId);
  projectSelect.innerHTML = projects.length
    ? projects.map(project => `<option value="${project.projectId}">${escapeHtml(project.projectName)}</option>`).join('')
    : '<option value="">暂无授权项目</option>';
  if (projects.some(project => Number(project.projectId) === attendanceState.projectId)) projectSelect.value = String(attendanceState.projectId);
}

async function loadAttendanceProjects() {
  const request = attendanceRequestGate.begin('projects');
  try {
    const data = await api('/api/attendance/projects');
    if (!attendanceRequestGate.isCurrent(request)) return;
    attendanceState.projects = data.list || [];
    if (!attendanceState.projects.length) {
      attendanceState.projectId = 0; attendanceState.customerId = 0;
      renderAttendanceProjectOptions(); setAttendanceDisabled(true);
      $('#attendanceProjectContext').textContent = '无授权项目';
      setAttendanceStatus('当前账号暂无授权项目', 'warning');
      return;
    }
    const selected = attendanceState.projects.find(item => Number(item.projectId) === attendanceState.projectId) || attendanceState.projects[0];
    attendanceState.customerId = Number(selected.customerId); attendanceState.projectId = Number(selected.projectId);
    renderAttendanceProjectOptions(); setAttendanceDisabled(false); setAttendanceStatus();
    await selectAttendanceProject(attendanceState.projectId);
  } catch (error) {
    if (!attendanceRequestGate.isCurrent(request)) return;
    setAttendanceStatus(`${attendanceErrorMessage(error)}，请重试`, 'error');
  }
}

async function selectAttendanceProject(projectId) {
  const project = attendanceState.projects.find(item => Number(item.projectId) === Number(projectId));
  if (!project) return;
  attendanceRequestGate.invalidateAll();
  attendanceState.projectId = Number(project.projectId); attendanceState.customerId = Number(project.customerId);
  renderAttendanceProjectOptions();
  $('#attendanceProjectContext').textContent = `${project.customerName} / ${project.projectName}`;
  const date = $('#attendanceDate').value; const month = $('#attendanceMonth').value;
  await loadAttendanceWorkbench(attendanceState.projectId, date);
  await loadAttendanceDaily(attendanceState.projectId, date);
  await loadAttendanceMonthly(attendanceState.projectId, month);
  await loadAttendanceProjectSettings(attendanceState.projectId);
  await loadAttendanceCalendar(attendanceState.projectId, month);
  await loadAttendanceCustomerGeofences(attendanceState.customerId);
  await loadAttendanceCorrections(attendanceState.projectId);
}

function renderAttendanceSummary(target, summary = {}, fields = []) {
  target.innerHTML = fields.map(([key, label]) => `<span><small>${label}</small><strong>${Number(summary[key] || 0)}</strong></span>`).join('');
}

function attendanceClientRequestId(action, projectId, date) {
  return `${action}:${projectId}:${date}:${Date.now().toString(36)}`;
}

function renderAttendanceClosure(closure = {}) {
  const confirmed = closure.status === 'CONFIRMED';
  attendanceState.closureStatus = confirmed ? 'CONFIRMED' : 'OPEN';
  $('#attendanceClosureStatus').textContent = confirmed
    ? `已确认 · 版本 ${Number(closure.versionNo || 0)}`
    : '未确认';
  $('#attendanceConfirmDay')?.classList.toggle('hidden', confirmed);
  $('#attendanceReopenDay')?.classList.toggle('hidden', !confirmed);
  const settlement = $('#attendanceDailySettlementLink');
  if (settlement) {
    settlement.disabled = !confirmed;
    settlement.textContent = confirmed ? '进入日结薪资' : '日结薪资待考勤确认';
  }
}

async function loadAttendanceWorkbench(projectId, date) {
  if (!projectId || !date) return;
  const request = attendanceRequestGate.begin('workbench');
  const body = $('#attendanceExceptionBody');
  body.innerHTML = attendanceEmptyRow(9, '正在加载待处理考勤');
  const status = $('#attendanceExceptionStatusFilter')?.value || 'PENDING';
  const keyword = String($('#attendanceEmployeeKeyword')?.value || '').trim().slice(0, 50);
  try {
    const data = await api(`/api/attendance/workbench?projectId=${encodeURIComponent(projectId)}&date=${encodeURIComponent(date)}&status=${encodeURIComponent(status)}&keyword=${encodeURIComponent(keyword)}`);
    if (!attendanceRequestGate.isCurrent(request)
      || Number(projectId) !== attendanceState.projectId
      || date !== $('#attendanceDate').value) return;
    renderAttendanceClosure(data.closure || {});
    renderAttendanceSummary($('#attendanceExceptionSummary'), data.summary || {}, [
      ['scheduled', '应出勤'], ['present', '已出勤'], ['normal', '正常'],
      ['late', '迟到'], ['earlyLeave', '早退'], ['missingPunch', '缺卡'],
      ['absent', '旷工'], ['geofenceException', '围栏异常'], ['pendingReview', '待核实']
    ]);
    const canReview = attendanceCan('attendance:review');
    const rows = data.list || [];
    body.innerHTML = rows.length ? rows.map(row => {
      const review = canReview && row.pendingReason
        ? `<button class="text-button" type="button" data-review-daily-exception="${Number(row.resultId)}">确认异常</button>`
        : '-';
      return `<tr><td>${escapeHtml(row.name || '-')}</td><td>${escapeHtml(row.firstInAt || '-')}</td><td>${escapeHtml(row.lastOutAt || '-')}</td><td>${attendanceMinutes(row.workedMinutes)}</td><td>${attendanceMinutes(row.approvedMinutes)}</td><td>${escapeHtml(row.resultStatus || '-')}</td><td>${escapeHtml(row.geofenceStatus || '-')}</td><td>${escapeHtml(row.pendingReason || '-')}</td><td>${review}</td></tr>`;
    }).join('') : attendanceEmptyRow(9, status === 'PENDING' ? '当前没有待处理考勤' : '当前筛选条件下暂无考勤数据');
  } catch (error) {
    if (!attendanceRequestGate.isCurrent(request)) return;
    body.innerHTML = attendanceEmptyRow(9, attendanceErrorMessage(error), 'workbench');
  }
}

async function refreshAttendanceDay() {
  const projectId = attendanceState.projectId;
  const date = $('#attendanceDate').value;
  await Promise.all([
    loadAttendanceWorkbench(projectId, date),
    loadAttendanceDaily(projectId, date),
    loadAttendanceCorrections(projectId)
  ]);
}

async function confirmAttendanceDay() {
  const button = $('#attendanceConfirmDay');
  const projectId = attendanceState.projectId;
  const date = $('#attendanceDate').value;
  if (!projectId || !date) return;
  const confirmed = await confirmDialog({
    title: '确认当日考勤',
    message: '确认后才能进入日结薪资。仍有待处理异常时系统会阻止确认。',
    confirmText: '确认考勤'
  });
  if (!confirmed) return;
  await withSubmitLock(button, async () => {
    try {
      await api('/api/attendance/daily-close', {
        method: 'POST',
        body: {
          projectId,
          shiftDate: date,
          clientRequestId: attendanceClientRequestId('confirm', projectId, date)
        }
      });
      toast('当日考勤已确认');
      await refreshAttendanceDay();
    } catch (error) {
      toast(attendanceErrorMessage(error), 'error');
    }
  }, '确认中…');
}

async function reopenAttendanceDay() {
  const button = $('#attendanceReopenDay');
  const projectId = attendanceState.projectId;
  const date = $('#attendanceDate').value;
  const reason = String(window.prompt('请输入重新打开考勤的原因') || '').trim();
  if (!reason) {
    toast('重新打开必须填写原因', 'error');
    return;
  }
  const confirmed = await confirmDialog({
    title: '重新打开当日考勤',
    message: '重新打开后，现有工资计算预览将失效。是否继续？',
    confirmText: '重新打开',
    danger: true
  });
  if (!confirmed) return;
  await withSubmitLock(button, async () => {
    try {
      await api('/api/attendance/daily-reopen', {
        method: 'POST',
        body: {
          projectId,
          shiftDate: date,
          reason: reason.slice(0, 255),
          clientRequestId: attendanceClientRequestId('reopen', projectId, date)
        }
      });
      toast('当日考勤已重新打开');
      await refreshAttendanceDay();
    } catch (error) {
      toast(attendanceErrorMessage(error), 'error');
    }
  }, '处理中…');
}

async function reviewAttendanceDailyException(resultId, button) {
  if (!Number(resultId)) return;
  const reviewComment = String(window.prompt('请输入异常核实说明') || '').trim();
  if (!reviewComment) {
    toast('确认异常必须填写核实说明', 'error');
    return;
  }
  await withSubmitLock(button, async () => {
    try {
      await api(`/api/attendance/daily-results/${resultId}/review`, {
        method: 'PUT',
        body: {
          action: 'CONFIRM_EXCEPTION',
          reviewComment: reviewComment.slice(0, 255),
          clientRequestId: attendanceClientRequestId('review', attendanceState.projectId, $('#attendanceDate').value)
        }
      });
      toast('考勤异常已确认');
      await loadAttendanceWorkbench(attendanceState.projectId, $('#attendanceDate').value);
    } catch (error) {
      toast(attendanceErrorMessage(error), 'error');
    }
  }, '确认中…');
}

async function loadAttendanceDaily(projectId, date) {
  if (!projectId || !date) return;
  const request = attendanceRequestGate.begin('daily');
  const body = $('#attendanceDailyBody');
  body.innerHTML = attendanceEmptyRow(9, '正在加载日报');
  try {
    const data = await api(`/api/attendance/daily?projectId=${encodeURIComponent(projectId)}&date=${encodeURIComponent(date)}`);
    if (!attendanceRequestGate.isCurrent(request)) return;
    const rows = data.list || [];
    renderAttendanceSummary($('#attendanceDailySummary'), data.summary || {}, [
      ['scheduled', '应出勤'], ['normal', '正常'], ['late', '迟到'], ['earlyLeave', '早退'],
      ['missingPunch', '缺卡'], ['absent', '旷工'], ['geofenceException', '围栏异常']
    ]);
    body.innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.name || '-')}</td><td>${escapeHtml(row.firstInAt || '-')}</td><td>${escapeHtml(row.lastOutAt || '-')}</td><td>${attendanceMinutes(row.workedMinutes)}</td><td>${attendanceMinutes(row.approvedNormalMinutes)}</td><td>${row.lateMinutes || 0}</td><td>${row.earlyLeaveMinutes || 0}</td><td>${escapeHtml(row.resultStatus || '-')}</td><td>${escapeHtml(row.geofenceStatus || '-')}</td></tr>`).join('') : attendanceEmptyRow(9, '当前项目当日暂无考勤数据');
  } catch (error) {
    if (!attendanceRequestGate.isCurrent(request)) return;
    body.innerHTML = attendanceEmptyRow(9, attendanceErrorMessage(error), 'daily');
  }
}

async function loadAttendanceMonthly(projectId, month) {
  if (!projectId || !month) return;
  const request = attendanceRequestGate.begin('monthly');
  const body = $('#attendanceMonthlyBody');
  body.innerHTML = attendanceEmptyRow(10, '正在加载月报');
  try {
    const data = await api(`/api/attendance/monthly?projectId=${encodeURIComponent(projectId)}&month=${encodeURIComponent(month)}`);
    if (!attendanceRequestGate.isCurrent(request)) return;
    const rows = data.list || [];
    renderAttendanceSummary($('#attendanceMonthlySummary'), data.summary || {}, [
      ['employeeCount', '员工数'], ['approvedNormalMinutes', '核准正常分钟'], ['approvedOvertimeMinutes', '核准加班分钟']
    ]);
    body.innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.name || '-')}</td><td>${row.scheduledDays || 0}</td><td>${row.attendanceDays || 0}</td><td>${attendanceMinutes(row.approvedNormalMinutes)}</td><td>${attendanceMinutes(row.approvedOvertimeMinutes)}</td><td>${row.lateMinutes || 0}</td><td>${row.earlyLeaveMinutes || 0}</td><td>${row.missingPunchDays || 0}</td><td>${row.absentDays || 0}</td><td>${row.geofenceExceptionCount || 0}</td></tr>`).join('') : attendanceEmptyRow(10, '当前项目本月暂无汇总数据');
  } catch (error) {
    if (!attendanceRequestGate.isCurrent(request)) return;
    body.innerHTML = attendanceEmptyRow(10, attendanceErrorMessage(error), 'monthly');
  }
}

function fillAttendanceSettings(settings = {}) {
  const form = $('#attendanceProjectSettingsForm'); const rule = settings.rules?.[0] || settings.rule || {};
  attendanceState.selectedGeofenceIds = (settings.geofenceIds || []).map(Number);
  for (const name of ['ruleName', 'effectiveFrom', 'workStartTime', 'workEndTime', 'restStartTime', 'restEndTime', 'standardMinutes', 'lateGraceMinutes', 'earlyGraceMinutes', 'overtimeMinMinutes']) {
    if (form.elements[name] && rule[name] != null) form.elements[name].value = String(rule[name]).slice(0, name.toLowerCase().includes('time') ? 5 : undefined);
  }
  const weekdays = new Set((rule.workWeekdays || [1, 2, 3, 4, 5]).map(Number));
  form.querySelectorAll('[name="workWeekdays"]').forEach(input => { input.checked = weekdays.has(Number(input.value)); });
}

async function loadAttendanceProjectSettings(projectId) {
  if (!projectId) return;
  const request = attendanceRequestGate.begin('settings');
  try {
    const data = await api(`/api/attendance/projects/${projectId}/settings`);
    if (!attendanceRequestGate.isCurrent(request)) return;
    fillAttendanceSettings(data);
  } catch (error) {
    if (attendanceRequestGate.isCurrent(request)) setAttendanceStatus(attendanceErrorMessage(error), 'error');
  }
}

async function saveAttendanceProjectSettings(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]');
  await withSubmitLock(button, async () => {
    const values = Object.fromEntries(new FormData(form));
    const body = { ...values,
      workWeekdays: [...form.querySelectorAll('[name="workWeekdays"]:checked')].map(input => Number(input.value)),
      geofenceIds: [...form.querySelectorAll('[name="geofenceIds"]:checked')].map(input => Number(input.value))
    };
    for (const key of ['standardMinutes', 'lateGraceMinutes', 'earlyGraceMinutes', 'overtimeMinMinutes']) body[key] = Number(body[key]);
    try {
      await api(`/api/attendance/projects/${attendanceState.projectId}/settings`, { method: 'PUT', body });
      toast('项目考勤设置已保存'); await loadAttendanceProjectSettings(attendanceState.projectId);
    } catch (error) { toast(attendanceErrorMessage(error), 'error'); }
  }, '保存中…');
}

async function loadAttendanceCalendar(projectId, month) {
  if (!projectId || !month) return;
  const request = attendanceRequestGate.begin('calendar');
  try {
    const data = await api(`/api/attendance/projects/${projectId}/exceptions?month=${encodeURIComponent(month)}`);
    if (!attendanceRequestGate.isCurrent(request)) return;
    const rows = data.list || [];
    $('#attendanceCalendarBody').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.calendarDate)}</td><td>${row.dayType === 'WORKDAY' ? '工作日' : '休息日'}</td><td>${escapeHtml(row.remark || '-')}</td></tr>`).join('') : attendanceEmptyRow(3, '本月无特殊日期');
  } catch (error) {
    if (attendanceRequestGate.isCurrent(request)) $('#attendanceCalendarBody').innerHTML = attendanceEmptyRow(3, attendanceErrorMessage(error), 'calendar');
  }
}

async function saveAttendanceCalendar(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]');
  await withSubmitLock(button, async () => {
    try {
      await api(`/api/attendance/projects/${attendanceState.projectId}/exceptions`, { method: 'PUT', body: Object.fromEntries(new FormData(form)) });
      toast('特殊日期已保存'); await loadAttendanceCalendar(attendanceState.projectId, $('#attendanceMonth').value);
    } catch (error) { toast(attendanceErrorMessage(error), 'error'); }
  }, '保存中…');
}

async function loadAttendanceCustomerGeofences(customerId) {
  if (!customerId) return;
  const request = attendanceRequestGate.begin('geofences');
  try {
    const data = await api(`/api/attendance/geofences?customerId=${encodeURIComponent(customerId)}`);
    if (!attendanceRequestGate.isCurrent(request)) return;
    const rows = data.list || []; const canManage = attendanceCan('attendance:manage');
    $('#attendanceGeofenceBody').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.fenceName)}</td>${canManage ? `<td>${row.latitude}, ${row.longitude}</td>` : ''}<td>${row.radiusMeters} 米</td><td>${row.maxAccuracyMeters} 米</td><td>${Number(row.status) === 1 ? '启用' : '停用'}</td>${canManage ? `<td>${Number(row.status) === 1 ? `<button class="text-button" type="button" data-disable-geofence="${row.id}">停用</button>` : '-'}</td>` : ''}</tr>`).join('') : attendanceEmptyRow(canManage ? 6 : 4, '当前客户暂无围栏');
    const selected = new Set(attendanceState.selectedGeofenceIds);
    $('#attendanceProjectGeofenceOptions').innerHTML = rows.filter(row => Number(row.status) === 1).map(row => `<label><input type="checkbox" name="geofenceIds" value="${row.id}" ${selected.has(Number(row.id)) ? 'checked' : ''}> ${escapeHtml(row.fenceName)}</label>`).join('') || '<span class="muted">当前客户暂无可用围栏</span>';
  } catch (error) {
    if (attendanceRequestGate.isCurrent(request)) $('#attendanceGeofenceBody').innerHTML = attendanceEmptyRow(6, attendanceErrorMessage(error), 'geofences');
  }
}

async function saveAttendanceGeofence(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]');
  await withSubmitLock(button, async () => {
    const values = Object.fromEntries(new FormData(form));
    const body = { ...values, customerId: attendanceState.customerId, latitude: Number(values.latitude), longitude: Number(values.longitude), radiusMeters: Number(values.radiusMeters), maxAccuracyMeters: Number(values.maxAccuracyMeters) };
    try {
      await api('/api/attendance/geofences', { method: 'POST', body });
      toast('电子围栏已保存'); form.reset(); await loadAttendanceCustomerGeofences(attendanceState.customerId);
    } catch (error) { toast(attendanceErrorMessage(error), 'error'); }
  }, '保存中…');
}

async function disableAttendanceGeofence(event) {
  const button = event.target.closest('[data-disable-geofence]'); if (!button) return;
  await withSubmitLock(button, async () => {
    try {
      await api(`/api/attendance/geofences/${button.dataset.disableGeofence}`, { method: 'PUT', body: { status: 0 } });
      toast('电子围栏已停用'); await loadAttendanceCustomerGeofences(attendanceState.customerId);
    } catch (error) { toast(attendanceErrorMessage(error), 'error'); }
  }, '停用中…');
}

async function loadAttendanceCorrections(projectId) {
  if (!attendanceCan('attendance:review') || !projectId) return;
  const request = attendanceRequestGate.begin('corrections');
  try {
    const data = await api(`/api/attendance/corrections?status=PENDING&projectId=${encodeURIComponent(projectId)}`);
    if (!attendanceRequestGate.isCurrent(request)) return;
    const rows = data.list || [];
    $('#attendanceCorrectionBody').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.shiftDate)}</td><td>${escapeHtml(row.geofenceStatus || '-')}</td><td>${row.distanceMeters == null ? '-' : `${row.distanceMeters} 米`}</td><td>${escapeHtml(row.reason)}</td><td><button class="text-button" data-review-correction="${row.id}" data-review-action="APPROVE">通过</button><button class="text-button" data-review-correction="${row.id}" data-review-action="REJECT">驳回</button></td></tr>`).join('') : attendanceEmptyRow(6, '当前项目暂无待审核异常');
  } catch (error) {
    if (attendanceRequestGate.isCurrent(request)) $('#attendanceCorrectionBody').innerHTML = attendanceEmptyRow(6, attendanceErrorMessage(error), 'corrections');
  }
}

async function reviewAttendanceCorrection(event) {
  const button = event.target.closest('[data-review-correction]'); if (!button) return;
  await withSubmitLock(button, async () => {
    try {
      await api(`/api/attendance/corrections/${button.dataset.reviewCorrection}/review`, { method: 'PUT', body: { action: button.dataset.reviewAction, projectId: attendanceState.projectId, reviewComment: 'Web 考勤工作台审核' } });
      toast('审核结果已保存'); await loadAttendanceCorrections(attendanceState.projectId);
    } catch (error) { toast(attendanceErrorMessage(error), 'error'); }
  }, '处理中…');
}

function switchAttendanceTab(tab) {
  $$('[data-attendance-tab]').forEach(button => { const active = button.dataset.attendanceTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  $$('[data-attendance-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.attendancePanel !== tab));
}

function bindAttendanceEvents() {
  if (attendanceState.listenersBound) return; attendanceState.listenersBound = true;
  $('#attendanceCustomerFilter')?.addEventListener('change', event => {
    attendanceState.customerId = Number(event.target.value); attendanceState.projectId = 0; renderAttendanceProjectOptions();
    selectAttendanceProject(Number($('#attendanceProjectFilter').value)).catch(error => toast(attendanceErrorMessage(error), 'error'));
  });
  $('#attendanceProjectFilter')?.addEventListener('change', event => selectAttendanceProject(Number(event.target.value)).catch(error => toast(attendanceErrorMessage(error), 'error')));
  $('#attendanceDate')?.addEventListener('change', event => Promise.all([
    loadAttendanceWorkbench(attendanceState.projectId, event.target.value),
    loadAttendanceDaily(attendanceState.projectId, event.target.value)
  ]));
  $('#attendanceMonth')?.addEventListener('change', event => Promise.all([loadAttendanceMonthly(attendanceState.projectId, event.target.value), loadAttendanceCalendar(attendanceState.projectId, event.target.value)]));
  $('#attendanceRefresh')?.addEventListener('click', () => selectAttendanceProject(attendanceState.projectId));
  $$('[data-attendance-tab]').forEach(button => button.addEventListener('click', () => switchAttendanceTab(button.dataset.attendanceTab)));
  $('#attendanceProjectSettingsForm')?.addEventListener('submit', saveAttendanceProjectSettings);
  $('#attendanceCalendarForm')?.addEventListener('submit', saveAttendanceCalendar);
  $('#attendanceGeofenceForm')?.addEventListener('submit', saveAttendanceGeofence);
  $('#attendanceGeofenceBody')?.addEventListener('click', disableAttendanceGeofence);
  $('#attendanceCorrectionBody')?.addEventListener('click', reviewAttendanceCorrection);
  $('#attendanceExceptionSearch')?.addEventListener('click', () => loadAttendanceWorkbench(attendanceState.projectId, $('#attendanceDate').value));
  $('#attendanceExceptionStatusFilter')?.addEventListener('change', () => loadAttendanceWorkbench(attendanceState.projectId, $('#attendanceDate').value));
  $('#attendanceEmployeeKeyword')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') loadAttendanceWorkbench(attendanceState.projectId, $('#attendanceDate').value);
  });
  $('#attendanceConfirmDay')?.addEventListener('click', confirmAttendanceDay);
  $('#attendanceReopenDay')?.addEventListener('click', reopenAttendanceDay);
  $('#attendanceDailySettlementLink')?.addEventListener('click', () => {
    if (attendanceState.closureStatus !== 'CONFIRMED') return;
    if (typeof viewElements !== 'undefined' && viewElements.dailySettlement) switchView('dailySettlement');
    else toast('日结薪资模块将在下一阶段启用');
  });
  $('#attendanceExceptionBody')?.addEventListener('click', event => {
    const button = event.target.closest('[data-review-daily-exception]');
    if (button) reviewAttendanceDailyException(Number(button.dataset.reviewDailyException), button);
  });
  $('#attendanceView')?.addEventListener('click', event => {
    const retry = event.target.closest('[data-attendance-retry]'); if (!retry) return;
    const actions = { workbench: () => loadAttendanceWorkbench(attendanceState.projectId, $('#attendanceDate').value), daily: () => loadAttendanceDaily(attendanceState.projectId, $('#attendanceDate').value), monthly: () => loadAttendanceMonthly(attendanceState.projectId, $('#attendanceMonth').value), calendar: () => loadAttendanceCalendar(attendanceState.projectId, $('#attendanceMonth').value), geofences: () => loadAttendanceCustomerGeofences(attendanceState.customerId), corrections: () => loadAttendanceCorrections(attendanceState.projectId) };
    actions[retry.dataset.attendanceRetry]?.();
  });
}

async function loadAttendance() {
  const today = attendanceDate();
  if (!$('#attendanceDate').value) $('#attendanceDate').value = today;
  if (!$('#attendanceMonth').value) $('#attendanceMonth').value = today.slice(0, 7);
  bindAttendanceEvents(); await loadAttendanceProjects();
}
