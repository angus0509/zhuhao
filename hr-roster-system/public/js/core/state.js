// 全局运行状态与基础 DOM 工具。保持经典脚本加载，兼容现有无构建前端。
const state = {
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
  workTasks: [],
  recruiters: [],
  recruitmentSuppliers: [],
  recruitmentChannels: [],
  risks: [],
  riskCases: [],
  selectedRiskId: null,
  selectedRiskProjectId: null,
  rosterViewMode: 'grouped',
  activeView: 'office'
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

let _loadingCount = 0;
let loginSubmitting = false;

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
