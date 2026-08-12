// 视图注册与切换。业务函数在入口脚本加载完成后才会执行。
const viewLoaders = {
  risk: () => loadRiskCenter(),
  dashboard: () => loadDashboard(),
  audit: () => loadAuditLogs(),
  projects: () => loadProjects(),
  talents: () => loadTalents(),
  advances: () => loadAdvances(),
  office: () => loadOffice(),
  payroll: () => loadPayroll(),
  blacklist: () => loadBlacklist(),
  permissions: () => loadPermissions(),
  tasks: () => loadWorkTasks(),
  recruitmentSources: () => loadRecruitmentSources()
};

const viewElements = {
  office: '#officeView',
  roster: '#rosterView',
  dashboard: '#dashboardView',
  risk: '#riskView',
  audit: '#auditView',
  projects: '#projectsView',
  talents: '#talentsView',
  advances: '#advancesView',
  payroll: '#payrollView',
  blacklist: '#blacklistView',
  permissions: '#permissionsView',
  tasks: '#tasksView',
  recruitmentSources: '#recruitmentSourcesView'
};

function switchView(view) {
  const legacyViewMap = {
    riskCases: 'risk',
    insurance: 'risk',
    factory: 'roster',
    factoryStaff: 'roster'
  };
  view = legacyViewMap[view] || view;
  if (!viewElements[view]) {
    const firstVisible = $('.nav-item:not([style*="display: none"]):not([style*="display:none"])');
    view = firstVisible?.dataset.view || 'office';
  }
  const navItem = $(`.nav-item[data-view="${view}"]`);
  if (navItem && navItem.style.display === 'none') {
    const firstVisible = $('.nav-item:not([style*="display: none"]):not([style*="display:none"])');
    if (firstVisible) view = firstVisible.dataset.view;
  }
  state.activeView = view;
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $('#metricStrip').classList.toggle('hidden', view === 'dashboard' || view === 'office');
  Object.entries(viewElements).forEach(([name, selector]) => {
    const el = $(selector);
    if (el) el.classList.toggle('hidden', name !== view);
  });
  $$('.mobile-tabbar button').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  if (typeof applyTopbarActionVisibility === 'function') applyTopbarActionVisibility(view);
  const loader = viewLoaders[view];
  if (loader) loader().catch(error => toast(error.message, 'error'));
  if (view === 'roster' && window.innerWidth <= 760) {
    loadMobileEmployees().catch(error => toast(error.message, 'error'));
  }
  document.dispatchEvent(new CustomEvent('app:viewchange', { detail: { view } }));
}
