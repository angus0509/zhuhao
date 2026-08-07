(function initializeInteractionPolish() {
  const viewMeta = {
    office: ['办公中心', '劳务运营总览'],
    dashboard: ['HR数字驾驶舱', '经营与合规数据'],
    roster: ['员工花名册', '客户单位人员管理'],
    tasks: ['驻厂待办中心', '现场交付任务'],
    recruitmentSources: ['招聘来源管理', '渠道与供应商归档'],
    blacklist: ['公司黑名单', '全公司风险共享'],
    projects: ['客户项目', '客户与项目经营'],
    talents: ['人才库', '招聘线索沉淀'],
    advances: ['工资预支', '申请、审批与放款'],
    payroll: ['工资发放', '工资批次与签收'],
    risk: ['风险预警', '用工合规扫描'],
    riskCases: ['用工风险管理', '整改与复核闭环'],
    audit: ['操作日志', '关键操作留痕'],
    permissions: ['权限管理', '角色与数据范围']
  };
  const actionSelector = '.primary-button,.secondary-button,.danger-button,.table-button,.quick-entry-card,.office-action,.mobile-tabbar button';
  const revealSelector = '.operations-pulse,.office-section,.rail-panel,.business-panel,.chart-panel,.main-panel,.detail-panel,.risk-panel,.role-card';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function updateViewHeading(view) {
    const meta = viewMeta[view] || ['优益数字化管理系统', '劳务运营全生命周期'];
    const title = document.querySelector('#currentViewTitle');
    const context = document.querySelector('#currentViewContext');
    const topbar = document.querySelector('.topbar');
    if (title) title.textContent = meta[0];
    if (context) context.textContent = `优益数字化管理系统 · ${meta[1]}`;
    if (topbar && !reducedMotion) {
      topbar.classList.remove('ui-title-change');
      requestAnimationFrame(() => topbar.classList.add('ui-title-change'));
    }
    const selector = typeof viewElements === 'object' ? viewElements[view] : null;
    const active = selector ? document.querySelector(selector) : null;
    if (active && !reducedMotion) {
      active.classList.remove('ui-view-enter');
      requestAnimationFrame(() => active.classList.add('ui-view-enter'));
    }
  }

  function bindPressFeedback() {
    document.addEventListener('pointerdown', event => {
      const target = event.target.closest(actionSelector);
      if (!target || target.disabled) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--press-x', `${event.clientX - rect.left}px`);
      target.style.setProperty('--press-y', `${event.clientY - rect.top}px`);
      target.classList.remove('ui-press');
      requestAnimationFrame(() => target.classList.add('ui-press'));
      window.setTimeout(() => target.classList.remove('ui-press'), 480);
    }, { passive: true });
  }

  function bindScrollState() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const update = () => topbar.classList.toggle('is-scrolled', window.scrollY > 14);
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  function bindRevealObserver() {
    if (reducedMotion || !('IntersectionObserver' in window)) return;
    const observed = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('ui-reveal-pending');
        entry.target.classList.add('ui-reveal-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .06, rootMargin: '0px 0px -24px' });
    const scan = root => {
      const descendants = typeof root.querySelectorAll === 'function'
        ? Array.from(root.querySelectorAll(revealSelector))
        : [];
      const nodes = typeof root.matches === 'function' && root.matches(revealSelector)
        ? [root, ...descendants]
        : descendants;
      nodes.forEach(node => {
        if (observed.has(node)) return;
        observed.add(node);
        node.classList.add('ui-reveal-pending');
        observer.observe(node);
      });
    };
    scan(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }))).observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('app:viewchange', event => updateViewHeading(event.detail?.view));
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.classList.add('ui-polish-ready');
    bindPressFeedback();
    bindScrollState();
    bindRevealObserver();
    updateViewHeading('office');
  });
}());
