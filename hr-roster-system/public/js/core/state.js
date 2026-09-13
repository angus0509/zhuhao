// 全局运行状态与基础 DOM 工具。保持经典脚本加载，兼容现有无构建前端。
function createEmptyPayrollImportState() {
  return {
    sourceRows: [],
    headers: [],
    header: null,
    headerSignature: '',
    suggestedMapping: [],
    mapping: [],
    mappingRequired: false,
    parsedRows: [],
    preview: null,
    fileName: '',
    sheetName: '',
    templates: [],
    activeTemplateId: 0
  };
}

const state = {
  sessionVersion: 0,
  bootstrap: null,
  employees: [],
  token: '',
  user: null,
  selectedEmployeeId: null,
  selectedDetail: null,
  editingEmployeeId: null,
  editingMobileEmployeeId: null,
  transferEmployeeId: null,
  resignEmployeeId: null,
  clients: [],
  projects: [],
  talents: [],
  advances: [],
  payrollDisputes: [],
  payrollOverviewData: null,
  payrollWorkspace: 'overview',
  payrollRecordFilter: 'all',
  payrollRecordMonth: '',
  payrollBatchDetail: null,
  payrollDetailFilter: 'all',
  payrollDetailKeyword: '',
  payrollSmsBusy: false,
  payrollSignatureObjectUrl: '',
  payrollImport: {
    sourceRows: [],
    headers: [],
    header: null,
    headerSignature: '',
    suggestedMapping: [],
    mapping: [],
    mappingRequired: false,
    parsedRows: [],
    preview: null,
    fileName: '',
    sheetName: '',
    templates: [],
    activeTemplateId: 0
  },
  recruitmentChannels: [],
  risks: [],
  selectedRiskId: null,
  selectedRiskProjectId: null,
  rosterViewMode: 'grouped',
  activeView: 'office'
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

let _loadingCount = 0;
let loginSubmitting = false;
let pendingLogoutRequest = Promise.resolve();
const sessionCleanupHooks = new Set();

function registerSessionCleanupHook(handler) {
  if (typeof handler === 'function') sessionCleanupHooks.add(handler);
  return () => sessionCleanupHooks.delete(handler);
}

function registerLogoutRequest(request) {
  pendingLogoutRequest = Promise.resolve(request).catch(() => undefined);
  return pendingLogoutRequest;
}

async function waitForLogoutRequest() {
  await pendingLogoutRequest;
}

function showLoading() {
  _loadingCount++;
  const bar = $('#loadingBar');
  if (bar) bar.classList.add('active');
}

function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    const bar = $('#loadingBar');
    if (bar) bar.classList.remove('active');
  }
}

const systemStatusMeta = {
  online: {
    label: '系统在线',
    title: '业务数据连接正常'
  },
  loading: {
    label: '数据同步中',
    title: '正在连接并同步业务数据'
  },
  warning: {
    label: '部分数据异常',
    title: '部分数据加载失败，请根据页面提示重试'
  },
  error: {
    label: '连接异常',
    title: '业务数据连接失败，请检查网络或稍后重试'
  },
  auth: {
    label: '需要登录',
    title: '登录后连接业务数据'
  }
};

function setSystemStatus(status = 'online', message = '') {
  const element = $('#systemStatus');
  if (!element) return;
  const normalizedStatus = systemStatusMeta[status] ? status : 'online';
  const meta = systemStatusMeta[normalizedStatus];
  element.className = `system-status ${normalizedStatus}`;
  element.textContent = message || meta.label;
  element.title = meta.title;
  element.setAttribute('aria-live', 'polite');
}

function renderTableFailure(selector, colspan, title, error, retryView = '') {
  const element = $(selector);
  if (!element) return;
  const message = escapeHtml(error?.message || '数据加载失败，请稍后重试');
  const retryButton = retryView
    ? `<button class="secondary-button table-retry-button" type="button" data-retry-view="${escapeHtml(retryView)}">重新加载</button>`
    : '';
  element.innerHTML = `<tr><td colspan="${Number(colspan) || 1}"><div class="empty-state error-state"><div class="empty-state-icon" aria-hidden="true">!</div><h3>${escapeHtml(title || '数据加载失败')}</h3><p>${message}</p>${retryButton}</div></td></tr>`;
}

const sessionContentSelectors = [
  '#employeeTableBody',
  '#detailContent',
  '#clientCards',
  '#projectCards',
  '#talentTableBody',
  '#advanceTableBody',
  '#payrollKpis',
  '#payrollRecentBatches',
  '#payrollRecordsGroups',
  '#payrollDisputeTableBody',
  '#payrollBatchEmployeeBody',
  '#riskTableBody',
  '#blacklistTableBody',
  '#permissionRoleCards',
  '#permissionUserTableBody',
  '#channelTableBody',
  '#auditTableBody',
  '#mobileEmpList',
  '#channelSummary',
  '#channelEmployeesSummary',
  '#channelEmployeesBody',
  '#riskSummaryKpis',
  '#officeStatline',
  '#officeLifecycleFlow',
  '#employeeOfficeGrid',
  '#financeOfficeGrid',
  '#officeNotices',
  '#dashboardKpis',
  '#departmentChart',
  '#employmentDonut',
  '#employmentLegend',
  '#complianceGauges',
  '#workforceTrend'
];

const sessionOptionSelectors = [
  '#customerSelect',
  '#projectSelect',
  '#formCustomerSelect',
  '#formProjectSelect',
  '#formPositionSelect',
  '#transferCustomerSelect',
  '#transferProjectSelect',
  '#transferPositionSelect',
  '#advanceEmployeeSelect',
  '#advanceCustomerSelect',
  '#advanceProjectSelect',
  '#payrollProjectSelect',
  '#payrollTemplateSelect',
  '#mFormCustomerSelect',
  '#mFormProjectSelect',
  '#mFormPositionSelect',
  '#desktopRecruitmentChannelOptions',
  '#mobileRecruitmentChannelOptions'
];

function clearSessionWorkspace() {
  state.sessionVersion += 1;
  sessionCleanupHooks.forEach(handler => {
    try { handler(); } catch (error) { console.warn('Session cleanup hook failed:', error); }
  });
  const signatureObjectUrl = state.payrollSignatureObjectUrl;
  if (signatureObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(signatureObjectUrl);
  }

  Object.assign(state, {
    bootstrap: null,
    employees: [],
    token: '',
    user: null,
    selectedEmployeeId: null,
    selectedDetail: null,
    editingEmployeeId: null,
    editingMobileEmployeeId: null,
    transferEmployeeId: null,
    resignEmployeeId: null,
    clients: [],
    projects: [],
    talents: [],
    advances: [],
    payrollDisputes: [],
    payrollOverviewData: null,
    payrollWorkspace: 'overview',
    payrollRecordFilter: 'all',
    payrollRecordMonth: '',
    payrollBatchDetail: null,
    payrollDetailFilter: 'all',
    payrollDetailKeyword: '',
    payrollSmsBusy: false,
    payrollSignatureObjectUrl: '',
    payrollImport: createEmptyPayrollImportState(),
    recruitmentChannels: [],
    risks: [],
    selectedRiskId: null,
    selectedRiskProjectId: null,
    rosterViewMode: 'grouped',
    activeView: 'office'
  });

  if (typeof clearCache === 'function') clearCache();
  if (typeof dashboardCharts !== 'undefined') {
    dashboardCharts.forEach(chart => chart?.destroy?.());
    dashboardCharts.clear();
  }

  sessionContentSelectors.forEach(selector => {
    const element = $(selector);
    if (element) element.innerHTML = '';
  });
  sessionOptionSelectors.forEach(selector => {
    const element = $(selector);
    if (element) element.innerHTML = '';
  });
  const metricDefaults = {
    employeeTotal: '0',
    activeTotal: '0',
    unresolvedRiskTotal: '0',
    advanceOutstanding: '¥0'
  };
  Object.entries(metricDefaults).forEach(([id, value]) => {
    const element = $(`#${id}`);
    if (element) element.textContent = value;
  });
  const signatureImage = $('#payrollSignatureImage');
  if (signatureImage) signatureImage.removeAttribute('src');
  const detail = $('#detailContent');
  if (detail) detail.classList.add('hidden');
  const emptyDetail = $('#emptyDetail');
  if (emptyDetail) emptyDetail.classList.remove('hidden');
  $$('dialog[open]').forEach(dialog => dialog.close());
  $$('form').forEach(form => {
    if (form.id !== 'loginForm') form.reset();
  });
  setWorkspaceLocked(true);
}

function setWorkspaceLocked(locked) {
  const workspace = $('.app-shell');
  if (!workspace) return;
  workspace.inert = Boolean(locked);
  if (locked) workspace.setAttribute('aria-hidden', 'true');
  else workspace.removeAttribute('aria-hidden');
}

async function activateAuthenticatedSession(user, token = '', options = {}) {
  const boot = options.boot || bootAuthedApp;
  const reveal = options.reveal || showApp;
  clearSessionWorkspace();
  state.token = token;
  state.user = user;
  try {
    await boot();
    reveal();
  } catch (error) {
    clearSessionWorkspace();
    throw error;
  }
}

function setPanelLoading(selector) {
  const el = $(selector);
  if (el) {
    el.style.opacity = '0.4';
    el.style.pointerEvents = 'none';
  }
}

function setPanelLoaded(selector) {
  const el = $(selector);
  if (el) {
    el.style.opacity = '';
    el.style.pointerEvents = '';
  }
}
