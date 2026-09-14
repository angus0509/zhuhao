(function exposeNavigationGroups(globalScope) {
  const navigationGroups = [
    {
      id: 'workbench',
      label: '工作台',
      shortLabel: '工作',
      items: [
        { view: 'office', label: '办公中心', permissions: ['office:menu', 'employee:view'] },
        { view: 'dashboard', label: '数据驾驶舱', permissions: ['dashboard:menu', 'employee:view'] }
      ]
    },
    {
      id: 'people',
      label: '人员管理',
      shortLabel: '人员',
      items: [
        { view: 'roster', label: '员工花名册', permissions: ['employee:menu', 'employee:view'] },
        { view: 'recruitmentSources', label: '招聘渠道', permissions: ['employee:menu', 'employee:view'] },
        { view: 'talents', label: '人才库', permissions: ['talent:menu', 'employee:view'] }
      ]
    },
    {
      id: 'delivery',
      label: '客户与驻厂',
      shortLabel: '驻厂',
      items: [
        { view: 'projects', label: '客户项目', permissions: ['project:view'] }
      ]
    },
    {
      id: 'payroll',
      label: '薪资结算',
      shortLabel: '薪资',
      items: [
        { view: 'payroll', label: '工资条发放', permissions: ['payroll:menu', 'payroll:view'] },
        { view: 'advances', label: '预支记录', permissions: ['advance:menu', 'advance:view'] }
      ]
    },
    {
      id: 'attendance',
      label: '考勤管理',
      shortLabel: '考勤',
      items: [{ view: 'attendance', label: '考勤工时', permissions: ['attendance:view'] }]
    },
    {
      id: 'compliance',
      label: '安全管理',
      shortLabel: '安全',
      items: [
        { view: 'blacklist', label: '公司黑名单', permissions: ['blacklist:menu', 'blacklist:view'] }
      ]
    },
    {
      id: 'system',
      label: '系统设置',
      shortLabel: '系统',
      items: [
        { view: 'permissions', label: '权限管理', permissions: ['permission:menu', 'system:role'] },
        { view: 'audit', label: '操作日志', permissions: ['audit:menu', 'audit:view'] }
      ]
    }
  ];

  function buildNavigationModel({ activeView = 'office', permissions = [], isCompanyAdmin = false } = {}) {
    const permissionSet = new Set(permissions);
    return navigationGroups.reduce((groups, group) => {
      const items = group.items.filter(item => {
        if (isCompanyAdmin) return true;
        const requiredPermissions = item.permissions || (item.permission ? [item.permission] : []);
        return requiredPermissions.every(permission => permissionSet.has(permission));
      });
      if (!items.length) return groups;
      const activeItem = items.find(item => item.view === activeView);
      groups.push({
        ...group,
        items,
        active: Boolean(activeItem),
        activeView: activeItem?.view || items[0].view,
        activeLabel: activeItem?.label || items[0].label
      });
      return groups;
    }, []);
  }

  function getNavigationFallbackView(groups) {
    return groups?.[0]?.items?.[0]?.view || 'office';
  }

  function buildMobileNavigationItems(groups = []) {
    const seen = new Set();
    return groups.flatMap(group => group.items.map(item => ({
      ...item,
      groupId: group.id,
      groupLabel: group.label
    }))).filter(item => {
      if (!item.view || seen.has(item.view)) return false;
      seen.add(item.view);
      return true;
    });
  }

  const api = { navigationGroups, buildNavigationModel, getNavigationFallbackView, buildMobileNavigationItems };
  Object.assign(globalScope, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
