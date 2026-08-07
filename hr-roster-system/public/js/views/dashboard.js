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
    ['待入职', kpis.pendingOnboardTotal, '待完成入职手续'],
    ['高风险', kpis.highOpenRisks, '尚未关闭', 'danger'],
    ['整改闭环率', `${kpis.riskClosureRate}%`, '风险任务关闭比例']
  ];
  $('#dashboardKpis').innerHTML = rows.map(([label, value, note, tone = '']) => `<article class="dashboard-kpi ${tone}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
  if (document.documentElement.classList.contains('motion-enabled')) {
    $$('.dashboard-kpi strong').forEach(el => animateCounter(el, el.textContent));
  }
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

function renderCompliance(compliance) {
  const rows = [['劳动合同', compliance.contractRate], ['雇主险增保', compliance.employerInsuranceRate], ['特殊工种持证', compliance.specialCertRate]];
  if (typeof Chart !== 'undefined') {
    for (const key of [...dashboardCharts.keys()].filter(item => item.startsWith('compliance-'))) destroyDashboardChart(key);
    $('#complianceGauges').innerHTML = rows.map(([label, value], index) => `
      <div class="compliance-item"><div class="compliance-ring chart-ring-host" data-compliance-chart="${index}"><strong>${value}%</strong></div><span>${escapeHtml(label)}</span><small>${value >= 90 ? '健康' : value >= 70 ? '需关注' : '高风险'}</small></div>
    `).join('');
    rows.forEach(([label, value], index) => createDashboardChart(`compliance-${index}`, $(`[data-compliance-chart="${index}"]`), {
      type: 'doughnut',
      data: { datasets: [{ data: [value, Math.max(100 - value, 0)], backgroundColor: ['#2f7d5d', '#e7eef5'], borderWidth: 0 }] },
      options: { accessibilityLabel: `${label}覆盖率${value}%`, cutout: '74%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    }, `<strong>${value}%</strong>`));
    return;
  }
  $('#complianceGauges').innerHTML = rows.map(([label, value]) => `
    <div class="compliance-item"><div class="compliance-ring" style="--rate:${value * 3.6}deg"><strong>${value}%</strong></div><span>${escapeHtml(label)}</span><small>${value >= 90 ? '健康' : value >= 70 ? '需关注' : '高风险'}</small></div>
  `).join('');
}

function renderRiskTypes(rows, highOpenRisks) {
  $('#highRiskSignal').textContent = `${highOpenRisks}项高风险`;
  if (rows.length && createDashboardChart('risk-types', $('#riskTypeChart'), {
    type: 'bar',
    data: {
      labels: rows.map(item => item.name),
      datasets: [
        { label: '未结', data: rows.map(item => item.unresolved), backgroundColor: '#b84735', borderRadius: 5 },
        { label: '已结', data: rows.map(item => item.closed), backgroundColor: '#2f7d5d', borderRadius: 5 }
      ]
    },
    options: {
      accessibilityLabel: '风险类别处置堆叠柱状图',
      indexAxis: 'y',
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } }
    }
  })) return;
  destroyDashboardChart('risk-types');
  const max = Math.max(...rows.map(item => item.unresolved + item.closed), 1);
  $('#riskTypeChart').innerHTML = rows.map(item => `
    <div class="risk-bar-row"><span>${escapeHtml(item.name)}</span><div class="risk-stack"><i class="risk-open" style="width:${(item.unresolved / max) * 100}%"></i><i class="risk-closed" style="width:${(item.closed / max) * 100}%"></i></div><strong>${item.unresolved}<small>未结</small></strong></div>
  `).join('');
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
    renderEmploymentDonut(data.employmentDistribution);
    renderCompliance(data.compliance);
    renderRiskTypes(data.riskByType, data.kpis.highOpenRisks);
    renderTrend(data.trend);
    $('#dashboardUpdatedAt').textContent = new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false });
  } finally {
    setPanelLoaded('#dashboardView');
  }
}
