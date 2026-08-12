// 花名册列表视图：筛选、导出、客户分组与表格渲染。
async function loadEmployees() {
  const query = [getQueryString(), 'view=activeRoster'].filter(Boolean).join('&');
  $('#exportLink').href = `/api/export/employees.csv${query ? `?${query}` : ''}`;
  $('#exportXlsxLink').href = `/api/export/employees.xlsx${query ? `?${query}` : ''}`;
  const wrap = $('.main-panel .table-wrap');
  if (wrap) wrap.classList.add('loading');
  try {
    const data = await apiAllPages('/api/employees', query);
    state.employees = data.list || [];
    if (!state.employees.some(item => Number(item.id) === Number(state.selectedEmployeeId))) {
      state.selectedEmployeeId = null;
      state.selectedDetail = null;
      $('#detailContent')?.classList.add('hidden');
      $('#emptyDetail')?.classList.remove('hidden');
    }
    renderEmployees();
  } finally {
    if (wrap) wrap.classList.remove('loading');
  }
}

async function exportEmployees(event, format = 'csv') {
  event.preventDefault();
  const query = [getQueryString(), 'view=activeRoster'].filter(Boolean).join('&');
  const response = await fetch(`/api/export/employees.${format}${query ? `?${query}` : ''}`, {
    credentials: 'same-origin',
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
  });

  if (!response.ok) {
    if (response.status === 401) logout(false);
    throw new Error('导出失败');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `employees.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderEmployees() {
  const tbody = $('#employeeTableBody');
  const rosterView = $('#rosterView');
  const permissions = state.user?.permissions || [];
  const canCreateEmployee = permissions.includes('employee:create');
  const canBatchEmployee = permissions.includes('employee:batch');
  renderCustomerRosterRail();
  rosterView?.classList.toggle('detail-collapsed', !state.selectedEmployeeId);
  if (!state.employees.length) {
    tbody.innerHTML = `<tr><td colspan="${rosterVisibleColumnCount()}">
      <div class="empty-entry-wrap">
        <div class="empty-entry-title">
          <span class="empty-entry-emoji" aria-hidden="true">🗂️</span>
          <h3>暂无员工数据</h3>
          <p>选择下方任一方式开始管理员工档案</p>
        </div>
        <div class="empty-entry-cards">
          ${canCreateEmployee ? `<button class="quick-entry-card quick-entry--single" type="button" id="emptyAddEmployee">
            <span class="quick-entry-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            </span>
            <span class="quick-entry-text"><strong>新增单个员工</strong><em>手填表单 · 适合少量补录</em></span>
            <span class="quick-entry-arrow" aria-hidden="true">→</span>
          </button>` : ''}
          ${canBatchEmployee ? `<button class="quick-entry-card quick-entry--batch" type="button" id="emptyBatchEmployee">
            <span class="quick-entry-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
            </span>
            <span class="quick-entry-text"><strong>批量录入 / 上传表格</strong><em>支持 CSV / XLSX · 一次最多 200 人</em></span>
            <span class="quick-entry-arrow" aria-hidden="true">→</span>
          </button>` : ''}
          ${!canCreateEmployee && !canBatchEmployee ? '<p class="muted">当前账号仅有查看权限，暂无新增或批量录入权限。</p>' : ''}
        </div>
      </div>
    </td></tr>`;
    const emptyAdd = $('#emptyAddEmployee');
    const emptyBatch = $('#emptyBatchEmployee');
    if (emptyAdd) emptyAdd.addEventListener('click', () => openEmployeeModal().catch(error => toast(error.message)));
    if (emptyBatch) emptyBatch.addEventListener('click', () => {
      $('#batchEmployeeForm').reset();
      $('#batchEmployeeResult').classList.add('hidden');
      $('#batchEmployeeModal').showModal();
    });
    finalizeRosterTableRender();
    return;
  }

  const statusBadge = row => row.lifecycleStatus === 'OFFBOARDING'
    ? badge('离职交接中', 'amber')
    : badge(row.employeeStatusName, statusTone(row.employeeStatus));
  const leaveText = row => row.leaveDate || (row.employeeStatus === 3 ? '已离职' : '-');
  const channelText = row => row.recruitmentChannelName || (row.recruitmentSourceType === 1
    ? `招聘人｜${row.recruiterName || '-'}`
    : row.recruitmentSourceType === 2 ? `供应商｜${row.supplierName || '-'}` : (row.channelSource || '-'));
  const canEditEmployee = permissions.includes('employee:update');
  const canTransferEmployee = permissions.includes('employee:transfer');
  const canResignEmployee = permissions.includes('employee:resign');

  const renderRow = (row, index) => {
    const selected = row.id === state.selectedEmployeeId ? 'selected' : '';
    return `
      <tr class="${selected}" data-employee-row="${row.id}">
        <td class="col-idx">${index + 1}</td>
        <td class="col-name"><strong>${escapeHtml(row.name)}</strong></td>
        <td class="col-gender">${escapeHtml(row.genderName)}</td>
        <td class="col-edu">${escapeHtml(row.education || '-')}</td>
        <td class="col-idcard">${escapeHtml(row.idCardNo)}</td>
        <td class="col-phone">${escapeHtml(row.phone)}</td>
        <td class="col-customer">${escapeHtml(row.customerName || '-')}</td>
        <td class="col-position">${escapeHtml(row.positionName || '-')}</td>
        <td class="col-wtype">${escapeHtml(row.workTypeName || '-')}</td>
        <td class="col-hire">${escapeHtml(row.hireDate || '-')}</td>
        <td class="col-contract">${escapeHtml(row.contractPeriod || '-')}</td>
        <td class="col-employment">${escapeHtml(row.employmentTypeName || '-')}<br><span class="muted">${statusBadge(row)}</span></td>
        <td class="col-fee">${escapeHtml(row.feeModeName || '-')}</td>
        <td class="col-leave">${escapeHtml(leaveText(row))}</td>
        <td class="col-channel">${escapeHtml(channelText(row))}</td>
        <td class="col-remark" title="${escapeHtml(row.remark || '')}">${escapeHtml(row.remark || '-')}</td>
        <td class="col-ops">
          <div class="row-actions">
            <button class="link-button" type="button" data-action="detail" data-id="${row.id}">查看</button>
            ${canEditEmployee ? `<button class="link-button" type="button" data-action="edit" data-id="${row.id}">编辑</button>` : ''}
            ${canTransferEmployee ? `<button class="link-button" type="button" data-action="transfer" data-id="${row.id}">调岗</button>` : ''}
            ${canResignEmployee ? `<button class="link-button danger" type="button" data-action="resign" data-id="${row.id}">离职</button>` : ''}
          </div>
        </td>
      </tr>`;
  };

  const displayRows = getSortedRosterRows(state.employees);
  if (state.rosterViewMode === 'list') {
    tbody.innerHTML = displayRows.map(renderRow).join('');
    finalizeRosterTableRender();
    return;
  }

  const groups = new Map();
  displayRows.forEach(row => {
    const key = row.customerId ? String(row.customerId) : 'unassigned';
    if (!groups.has(key)) groups.set(key, { name: row.customerName || '未分配客户单位', rows: [] });
    groups.get(key).rows.push(row);
  });
  let rowIndex = 0;
  tbody.innerHTML = Array.from(groups.values()).map(group => {
    const active = group.rows.filter(row => Number(row.employeeStatus) === 2 && row.lifecycleStatus !== 'OFFBOARDING').length;
    const insuranceGap = group.rows.filter(row => Number(row.employeeStatus) === 2 && Number(row.employerInsuranceStatus) !== 1).length;
    const risk = group.rows.reduce((sum, row) => sum + Number(row.riskCount || 0), 0);
    const head = `<tr class="customer-group-row"><td colspan="${rosterVisibleColumnCount()}"><div><strong>${escapeHtml(group.name)}</strong><span>在职 ${active} 人</span><span class="${insuranceGap ? 'risk-text' : ''}">雇主险待增 ${insuranceGap}</span><span class="${risk ? 'risk-text' : ''}">风险 ${risk}</span></div></td></tr>`;
    return head + group.rows.map(row => renderRow(row, rowIndex++)).join('');
  }).join('');
  finalizeRosterTableRender();
}

function renderCustomerRosterRail() {
  const rail = $('#customerRosterRail');
  if (!rail) return;
  const groups = new Map();
  state.employees.forEach(row => {
    const key = row.customerId ? String(row.customerId) : 'unassigned';
    if (!groups.has(key)) groups.set(key, { id: row.customerId || '', name: row.customerName || '未分配客户单位', rows: [] });
    groups.get(key).rows.push(row);
  });
  rail.innerHTML = Array.from(groups.values()).map(group => {
    const active = group.rows.filter(row => Number(row.employeeStatus) === 2 && row.lifecycleStatus !== 'OFFBOARDING').length;
    const insuranceGap = group.rows.filter(row => Number(row.employeeStatus) === 2 && Number(row.employerInsuranceStatus) !== 1).length;
    const risks = group.rows.reduce((sum, row) => sum + Number(row.riskCount || 0), 0);
    return `<button class="customer-roster-card" type="button" data-customer-roster="${group.id}"><span>${escapeHtml(group.name)}</span><strong>${active}<small>人在职</small></strong><div><em class="${insuranceGap ? 'risk' : ''}">雇主险 ${insuranceGap}</em><em class="${risks ? 'risk' : ''}">风险 ${risks}</em></div></button>`;
  }).join('') || '<div class="customer-roster-empty">当前筛选条件下暂无客户员工</div>';
}
