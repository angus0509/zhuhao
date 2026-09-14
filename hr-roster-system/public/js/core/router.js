// 视图注册与切换。业务函数在入口脚本加载完成后才会执行。
const viewLoaders = {
  dashboard: () => loadDashboard(),
  audit: () => loadAuditLogs(),
  projects: () => loadProjects(),
  talents: () => loadTalents(),
  advances: () => loadAdvances(),
  office: () => loadOffice(),
  payroll: () => loadPayroll(),
  attendance: () => loadAttendance(),
  blacklist: () => loadBlacklist(),
  permissions: () => loadPermissions(),
  recruitmentSources: () => loadRecruitmentSources()
};

const viewElements = {
  office: '#officeView',
  roster: '#rosterView',
  dashboard: '#dashboardView',
  audit: '#auditView',
  projects: '#projectsView',
  talents: '#talentsView',
  advances: '#advancesView',
  payroll: '#payrollView',
  attendance: '#attendanceView',
  blacklist: '#blacklistView',
  permissions: '#permissionsView',
  recruitmentSources: '#recruitmentSourcesView'
};

function switchView(view) {
  const legacyViewMap = {
    riskCases: 'office',
    insurance: 'office',
    factory: 'roster',
    factoryStaff: 'roster'
  };
  view = legacyViewMap[view] || view;
  const navigationModel = typeof getVisibleNavigationModel === 'function'
    ? getVisibleNavigationModel(view)
    : [];
  const allowedViews = navigationModel.flatMap(group => group.items.map(item => item.view));
  if (!viewElements[view]) {
    view = typeof getNavigationFallbackView === 'function'
      ? getNavigationFallbackView(navigationModel)
      : 'office';
  } else if (allowedViews.length && !allowedViews.includes(view)) {
    view = typeof getNavigationFallbackView === 'function'
      ? getNavigationFallbackView(navigationModel)
      : 'office';
  }
  state.activeView = view;
  if (typeof renderPrimaryNavigation === 'function') renderPrimaryNavigation(view);
  $('#metricStrip').classList.toggle('hidden', view === 'dashboard' || view === 'office');
  Object.entries(viewElements).forEach(([name, selector]) => {
    const el = $(selector);
    if (el) el.classList.toggle('hidden', name !== view);
  });
  if (typeof updateMobileNavigationActive === 'function') updateMobileNavigationActive(view);
  else $$('.mobile-tabbar button').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  if (typeof applyTopbarActionVisibility === 'function') applyTopbarActionVisibility(view);
  const loader = viewLoaders[view];
  if (loader) loader().catch(error => toast(error.message, 'error'));
  if (view === 'roster' && window.innerWidth <= 760) {
    loadMobileEmployees().catch(error => toast(error.message, 'error'));
  }
  document.dispatchEvent(new CustomEvent('app:viewchange', { detail: { view } }));
}
