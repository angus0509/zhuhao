// 数字驾驶舱视图。Chart.js 升级将在本文件内渐进增强，现阶段保留 CSS 降级渲染。
const dashboardSeries = ['#2f7d5d', '#326c8c', '#b7791f', '#7b6651', '#7c6ca8', '#b84735'];
const dashboardCharts = new Map();

function chartMotionDuration() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return document.documentElement.classList.contains('motion-enabled') && !reduced ? 420 : 0;
}

function destroyDashboardChart(key) {
  const chart = dashboardCharts.get(key);
  if (chart) chart.destroy();
  dashboardCharts.delete(key);
}

function createDashboardChart(key, container, config, centerHtml = '') {
  if (typeof Chart === 'undefined' || !container) return false;
  destroyDashboardChart(key);
  container.classList.add('chart-canvas-host');
  container.innerHTML = `<canvas aria-label="${escapeHtml(config.options?.accessibilityLabel || '数据图表')}" role="img"></canvas>${centerHtml}`;
  const chartConfig = {
    ...config,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: chartMotionDuration() },
      ...config.options
    }
  };
  delete chartConfig.options.accessibilityLabel;
  dashboardCharts.set(key, new Chart(container.querySelector('canvas'), chartConfig));
  return true;
}

function renderDashboardKpis(kpis) {
  const rows = [
    ['员工总数', kpis.employeeTotal, '全口径员工档案'],
    ['在职员工', kpis.activeTotal, '当前有效任职'],
    ['待到岗', kpis.pendingOnboardTotal, '确认入职或标记未入职'],
    ['整改闭环率', `${kpis.riskClosureRate}%`, '风险任务关闭比例']
  ];
  $('#dashboardKpis').innerHTML = rows.map(([label, value, note, tone = '']) => `<article class="dashboard-kpi ${tone}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
  if (document.documentElement.classList.contains('motion-enabled')) {
    $$('.dashboard-kpi strong').forEach(el => animateCounter(el, el.textContent));
  }
}

function renderRecruitmentChannelChart(rows) {
  const total = rows.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const totalEl = $('#recruitmentChannelChartTotal');
  if (totalEl) totalEl.textContent = `${total}人`;
  if (rows.length && createDashboardChart('recruitment-channel', $('#recruitmentChannelChart'), {
    type: 'bar',
    data: {
      labels: rows.map(item => item.name),
      datasets: [{ label: '在职人数', data: rows.map(item => item.value), backgroundColor: '#0b8495', borderRadius: 6 }]
    },
    options: {
      accessibilityLabel: '在职人员招聘渠道分布柱状图',
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } }
    }
  })) return;
  destroyDashboardChart('recruitment-channel');
  const max = Math.max(...rows.map(item => Number(item.value || 0)), 1);
  $('#recruitmentChannelChart').innerHTML = rows.length ? rows.map(item => `
    <div class="bar-row"><span>${escapeHtml(item.name)}</span><div class="bar-track supplier-bar-track"><i style="width:${Math.max((item.value / max) * 100, 4)}%"></i></div><strong>${item.value}</strong></div>
  `).join('') : '<p class="muted">暂无招聘渠道数据</p>';
}

function renderDepartmentChart(rows) {
  $('#departmentChartTotal').textContent = `${rows.reduce((sum, item) => sum + item.value, 0)}人`;
  if (rows.length && createDashboardChart('department', $('#departmentChart'), {
    type: 'bar',
    data: {
      labels: rows.map(item => item.name),
      datasets: [{ label: '在职人数', data: rows.map(item => item.value), backgroundColor: '#326c8c', borderRadius: 6 }]
    },
    options: {
      accessibilityLabel: '在职人员客户单位分布柱状图',
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } }
    }
  })) return;
  destroyDashboardChart('department');
  const max = Math.max(...rows.map(item => item.value), 1);
  $('#departmentChart').innerHTML = rows.length ? rows.map(item => `
    <div class="bar-row"><span>${escapeHtml(item.name)}</span><div class="bar-track"><i style="width:${Math.max((item.value / max) * 100, 4)}%"></i></div><strong>${item.value}</strong></div>
  `).join('') : '<p class="muted">暂无部门数据</p>';
}

function renderEmploymentDonut(rows) {
  const total = rows.reduce((sum, item) => sum + item.value, 0);
  const centerHtml = `<div class="chart-center-label"><strong id="employmentTotal">${total}</strong><span>在职</span></div>`;
  const chartCreated = rows.length && createDashboardChart('employment', $('#employmentDonut'), {
    type: 'doughnut',
    data: {
      labels: rows.map(item => item.name),
      datasets: [{ data: rows.map(item => item.value), backgroundColor: rows.map((_item, index) => dashboardSeries[index % dashboardSeries.length]), borderWidth: 0 }]
    },
    options: {
      accessibilityLabel: '用工模式占比环形图',
      cutout: '70%',
      plugins: { legend: { display: false } }
    }
  }, centerHtml);
  if (!chartCreated) {
    destroyDashboardChart('employment');
    $('#employmentDonut').classList.remove('chart-canvas-host');
    $('#employmentDonut').innerHTML = centerHtml;
  }
  let cursor = 0;
  const segments = rows.map((item, index) => {
    const start = cursor;
    cursor += total ? (item.value / total) * 360 : 0;
    return `${dashboardSeries[index % dashboardSeries.length]} ${start}deg ${cursor}deg`;
  });
  $('#employmentDonut').style.background = chartCreated ? 'transparent' : (total ? `conic-gradient(${segments.join(',')})` : 'var(--line)');
  $('#employmentTotal').textContent = total;
  $('#employmentLegend').innerHTML = rows.map((item, index) => `<div><i style="background:${dashboardSeries[index % dashboardSeries.length]}"></i><span>${escapeHtml(item.name)}</span><strong>${item.value}</strong></div>`).join('');
}

function renderTrend(rows) {
  if (rows.length && createDashboardChart('trend', $('#workforceTrend'), {
    type: 'line',
    data: {
      labels: rows.map(item => `${item.month.slice(5)}月`),
      datasets: [
        { label: '入职', data: rows.map(item => item.hires), borderColor: '#2f7d5d', backgroundColor: 'rgba(47,125,93,.12)', fill: true, tension: .35 },
        { label: '离职', data: rows.map(item => item.resignations), borderColor: '#b7791f', backgroundColor: 'rgba(183,121,31,.08)', fill: true, tension: .35 }
      ]
    },
    options: {
      accessibilityLabel: '近六个月入职离职趋势折线图',
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } }
    }
  })) return;
  destroyDashboardChart('trend');
  const max = Math.max(...rows.flatMap(item => [item.hires, item.resignations]), 1);
  $('#workforceTrend').innerHTML = rows.map(item => `
    <div class="trend-column"><div class="trend-bars"><i class="hire-bar" style="height:${Math.max((item.hires / max) * 100, item.hires ? 8 : 0)}%"><span>${item.hires}</span></i><i class="leave-bar" style="height:${Math.max((item.resignations / max) * 100, item.resignations ? 8 : 0)}%"><span>${item.resignations}</span></i></div><small>${item.month.slice(5)}月</small></div>
  `).join('');
}

async function loadDashboard() {
  setPanelLoading('#dashboardView');
  try {
    const data = await cachedApi('/api/analytics/dashboard', 30000);
    renderDashboardKpis(data.kpis);
    renderDepartmentChart(data.customerDistribution);
    renderRecruitmentChannelChart(data.recruitmentChannelDistribution || data.supplierDistribution || []);
    renderEmploymentDonut(data.employmentDistribution);
    renderTrend(data.trend);
    $('#dashboardUpdatedAt').textContent = new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false });
  } finally {
    setPanelLoaded('#dashboardView');
  }
}
