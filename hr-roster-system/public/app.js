async function uploadAttachment(file, bizType, bizId) {
  if (!file) return null;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('bizType', bizType);
  formData.append('bizId', String(bizId));
  showLoading();
  try {
    const response = await fetch('/api/attachments', {
      method: 'POST',
      credentials: 'same-origin',
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
      body: formData
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || '附件上传失败');
    return payload.data;
  } finally {
    hideLoading();
  }
}

async function uploadSavedAttachment(file, bizType, bizId) {
  if (!file) return true;
  try {
    await uploadAttachment(file, bizType, bizId);
    return true;
  } catch (error) {
    toast(`业务记录已保存，但附件上传失败：${error.message}`, 'error');
    return false;
  }
}

async function downloadAttachment(id, filename) {
  showLoading();
  try {
    const response = await fetch(`/api/attachments/${id}/download`, {
      credentials: 'same-origin',
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || '附件下载失败');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || '合规附件';
    link.click();
    URL.revokeObjectURL(url);
  } finally {
    hideLoading();
  }
}

function selectedAttachment(form) {
  return form.querySelector('[data-attachment-input]')?.files?.[0] || null;
}

function renderAttachmentRows(rows) {
  if (!rows?.length) return '<span class="muted">暂无合规附件</span>';
  return rows.map(row => `
    <div class="attachment-row">
      <div><strong>${escapeHtml(row.originalName)}</strong><span>${escapeHtml(row.categoryName)} · ${(Number(row.fileSize || 0) / 1024).toFixed(1)}KB · ${escapeHtml(row.createdAt || '')}</span></div>
      <button class="table-button" type="button" data-download-attachment="${row.id}" data-filename="${escapeHtml(row.originalName)}">下载</button>
    </div>
  `).join('');
}

function canViewSensitiveEmployee() {
  return (state.user?.permissions || []).includes('employee:sensitive:view');
}

function configureSensitiveEmployeeFields(form, editing) {
  const allowed = canViewSensitiveEmployee();
  for (const name of ['idCardNo', 'address', 'phone', 'bankCardNo', 'emergencyPhone']) {
    const input = form?.elements?.[name];
    if (!input) continue;
    if (!input.dataset.defaultPlaceholder) input.dataset.defaultPlaceholder = input.placeholder || '';
    const requiredOnCreate = ['idCardNo', 'phone'].includes(name);
    input.required = !editing && requiredOnCreate;
    if (editing && !allowed) {
      input.value = '';
      input.placeholder = '无敏感信息权限，留空保持原值';
    } else {
      input.placeholder = input.dataset.defaultPlaceholder;
    }
  }
  form.dataset.canViewSensitiveEmployee = allowed ? '1' : '0';
}

function removeUnavailableSensitiveFields(form, body, editing) {
  if (!editing || form.dataset.canViewSensitiveEmployee === '1') return body;
  for (const name of ['idCardNo', 'address', 'phone', 'bankCardNo', 'emergencyPhone']) delete body[name];
  return body;
}

/* ==================== 空状态和行数工具 ==================== */
function emptyRow(colspan, title = '暂无数据', desc = '') {
  return `<tr><td colspan="${colspan}"><div class="empty-state"><div class="empty-state-icon">📋</div><h3>${title}</h3>${desc ? `<p>${desc}</p>` : ''}</div></td></tr>`;
}
function tableFooter(count, label = '条记录') {
  return `<div class="table-footer"><span>共 <strong>${count}</strong> ${label}</span><span>每页 100 条</span></div>`;
}

function parseBatchTable(text, columns, firstHeader) {
  // 只去掉 \r，不 trim 整行——否则 Excel 复制时末尾空单元格的 tab 会被砍掉导致列数不足
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\r/g, ''))
    .filter(line => line.trim().length > 0);
  if (lines[0]) {
    const firstCell = lines[0].split(lines[0].includes('\t') ? '\t' : ',')[0].trim();
    if (firstCell === firstHeader) lines.shift();
  }
  if (!lines.length) throw new Error('请粘贴至少一行数据');
  if (lines.length > 200) throw new Error('单次最多录入200行');
  return lines.map((line, index) => {
    const sep = line.includes('\t') ? '\t' : ',';
    const cells = line.split(sep).map(cell => cell.trim());
    if (cells.length === 1 && columns.length > 1) {
      throw new Error(`第${index + 1}行未检测到制表符或逗号分隔，请从 Excel 直接复制整行或使用模板上传`);
    }
    // Excel/CSV 末尾空单元格的分隔符常被丢掉，自动补齐到所需列数
    while (cells.length < columns.length) cells.push('');
    return Object.fromEntries(columns.map((column, columnIndex) => [column, cells[columnIndex] || '']));
  });
}

function downloadCsvTemplate(filename, headers, example) {
  const csv = `\uFEFF${headers.join(',')}\n${example.join(',')}\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadXlsxTemplate(filename, headers, example) {
  if (typeof XLSX === 'undefined') { toast('XLSX 库未加载，请刷新页面重试'); return; }
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws['!cols'] = headers.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '批量录入');
  XLSX.writeFile(wb, filename);
}

function rowsToTabText(rows) {
  return rows.map(row => row.map(cell => String(cell == null ? '' : cell)).join('\t')).join('\n');
}

function excelSerialToDate(serial) {
  // Excel 序列号：1 = 1900-01-01（Excel 1900 闰年 bug 用 +1 修正）
  // 25569 = 1970-01-01 的序列号
  const days = Math.floor(serial);
  if (days < 25569) return null;
  const ms = (days - 25569) * 86400 * 1000;
  return new Date(ms);
}

function excelCellToText(value) {
  // XLSX cellDates:true 成功 → Date 对象
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // XLSX cellDates:true 失败 → 数字序列号（1970~2119 = 25569~73050）
  if (typeof value === 'number' && value >= 25569 && value < 73050) {
    const date = excelSerialToDate(value);
    if (date) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  if (value && typeof value === 'object' && value.richText) {
    return value.richText.map(part => part.text || '').join('');
  }
  return value == null ? '' : String(value);
}

function renderBatchColumnPreview(previewEl, expectedHeaders, actualHeaders, dataRow) {
  if (!previewEl) return;
  if (!Array.isArray(actualHeaders) || !actualHeaders.length) {
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
    return;
  }
  const same = actualHeaders.length === expectedHeaders.length;
  const diff = expectedHeaders.length - actualHeaders.length;
  let statusTone = 'ok';
  let statusText = `✓ 列数匹配（${actualHeaders.length}列）`;
  if (!same) {
    statusTone = 'bad';
    statusText = `⚠ 列数不匹配：标准模板 ${expectedHeaders.length} 列（${expectedHeaders.join('、')}），实际 ${actualHeaders.length} 列${diff > 0 ? `，缺少 ${diff} 列` : `，多出 ${-diff} 列`}。请按下方对照表调整，或使用本系统下载的模板。`;
  }
  // 渲染对照表
  const cells = expectedHeaders.map((std, idx) => {
    const actual = actualHeaders[idx];
    let tone = 'ok';
    let mark = '✓';
    if (actual === undefined) { tone = 'missing'; mark = '⚠ 缺失'; }
    else if (actual == null || String(actual).trim() === '') { tone = 'missing'; mark = '⚠ 空'; }
    else if (same && String(actual).trim() !== String(std).trim()) { tone = 'shift'; mark = '↔ 错位'; }
    const sample = (dataRow && dataRow[idx] != null) ? `  样例：<code>${escapeHtml(String(dataRow[idx]).slice(0, 24))}</code>` : '';
    return `<div class="batch-col-row ${tone}"><span class="batch-col-num">${idx + 1}</span><span class="batch-col-std">${escapeHtml(std)}</span><span class="batch-col-arrow">←</span><span class="batch-col-actual">${escapeHtml(actual == null ? '' : String(actual)) || '<em>空</em>'}</span><span class="batch-col-mark">${mark}${sample}</span></div>`;
  }).join('');
  previewEl.className = `batch-column-preview ${statusTone}`;
  previewEl.innerHTML = `<div class="batch-column-head">${escapeHtml(statusText)}</div>${cells}`;
  previewEl.classList.remove('hidden');
}

function handleBatchFile(file, textarea, fileNameEl, options = {}) {
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  const expectedHeaders = options.expectedHeaders || [];
  const previewEl = options.previewEl || null;
  if (!/\.(csv|xlsx|xls)$/.test(name)) { toast('仅支持 .csv / .xlsx / .xls 文件'); return; }
  if (fileNameEl) fileNameEl.textContent = `解析中：${file.name} …`;
  if (previewEl) { previewEl.classList.add('hidden'); previewEl.innerHTML = ''; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      let text = '';
      let actualHeaders = [];
      let firstDataRow = [];
      if (name.endsWith('.csv')) {
        text = String(reader.result || '').replace(/\r\n?/g, '\n').replace(/\uFEFF/g, '').trim();
        if (text) {
          const firstLine = text.split('\n')[0];
          const sep = firstLine.includes('\t') ? '\t' : ',';
          actualHeaders = firstLine.split(sep).map(c => c.trim());
        }
      } else {
        if (typeof XLSX === 'undefined') throw new Error('XLSX 库未加载，请刷新页面重试');
        const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // raw:true + cellDates:true 才能把日期单元格转回 JS Date 对象（raw:false 会按 m/d/yy 格式字符串输出）
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', cellDates: true }).map(r => r.map(excelCellToText));
        if (!rows.length) throw new Error('文件为空');
        actualHeaders = (rows[0] || []).map(c => String(c || '').trim());
        firstDataRow = rows[1] || [];
        text = rowsToTabText(rows);
      }
      if (!text) throw new Error('未解析到数据');
      textarea.value = text;
      const dataRowCount = Math.max(0, (text.split('\n').length - 1));
      if (fileNameEl) fileNameEl.textContent = `已载入：${file.name}（共 ${dataRowCount} 行）`;
      // 列数预检
      if (expectedHeaders.length) {
        renderBatchColumnPreview(previewEl, expectedHeaders, actualHeaders, firstDataRow);
        if (actualHeaders.length !== expectedHeaders.length) {
          toast(`表格列数不符：应为 ${expectedHeaders.length} 列，实际 ${actualHeaders.length} 列。请参考上方对照表调整，或使用本系统下载的模板重新录入。`, 'error');
        }
      }
      textarea.focus();
    } catch (err) {
      if (fileNameEl) fileNameEl.textContent = '';
      toast(err.message || '文件解析失败');
    }
  };
  reader.onerror = () => { if (fileNameEl) fileNameEl.textContent = ''; toast('文件读取失败'); };
  if (name.endsWith('.csv')) reader.readAsText(file, 'utf-8');
  else reader.readAsArrayBuffer(file);
}

function bindBatchFileZone(zoneId, inputId, formId, fileNameId, expectedHeaders) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const form = document.getElementById(formId);
  const fileNameEl = document.getElementById(fileNameId);
  if (!zone || !input || !form) return;
  const textarea = form.elements.tableData;
  if (!textarea) return;
  // employeeFileZone -> employeeColumnPreview
  const previewId = zoneId.replace('FileZone', '') + 'ColumnPreview';
  const previewEl = document.getElementById(previewId);
  const trigger = () => handleBatchFile(input.files[0], textarea, fileNameEl, { expectedHeaders, previewEl });
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
  input.addEventListener('change', trigger);
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, event => { event.preventDefault(); zone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, event => { event.preventDefault(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', event => {
    const file = event.dataTransfer && event.dataTransfer.files[0];
    if (file) { input.value = ''; handleBatchFile(file, textarea, fileNameEl, { expectedHeaders, previewEl }); }
  });
}

function showBatchResult(element, result) {
  const errors = result.errors || [];
  const warnings = result.warnings || [];
  const warnBlock = warnings.length
    ? `<div class="batch-warn-block">${warnings.map(item => `第${item.row}行 ${escapeHtml(item.name || '')}：${item.messages.map(escapeHtml).join('；')}`).join('<br>')}</div>`
    : '';
  element.classList.remove('hidden');
  const summary = `<strong>共${result.total}行：成功${result.successCount}行，失败${result.failureCount}行${warnings.length ? `，自动纠错${warnings.length}行` : ''}</strong>`;
  const detail = errors.length
    ? `<div class="batch-error-block">${errors.map(item => `第${item.row}行 ${escapeHtml(item.name || '')}：${escapeHtml(item.message)}`).join('<br>')}</div>`
    : '<div>全部录入成功。</div>';
  element.innerHTML = summary + warnBlock + detail;
}

async function submitEmployeeBatch(event) {
  event.preventDefault();
  const columns = ['name', 'gender', 'education', 'idCardNo', 'address', 'phone', 'customerName', 'projectName', 'positionName', 'workType', 'hireDate', 'employmentType', 'feeMode', 'channelSource', 'remark', 'bankName', 'bankCardNo', 'emergencyContact', 'emergencyPhone', 'employeeStatus'];
  const rows = parseBatchTable(event.currentTarget.elements.tableData.value, columns, '姓名');
  const result = await api('/api/employees/batch', { method: 'POST', body: JSON.stringify({ rows }) });
  showBatchResult($('#batchEmployeeResult'), result);
  await Promise.all([loadEmployees(), loadSummary(), loadOffice()]);
  if (!result.failureCount) {
    event.currentTarget.reset();
    window.setTimeout(() => $('#batchEmployeeModal').close(), 900);
  }
}

async function submitBlacklistBatch(event) {
  event.preventDefault();
  const columns = ['name', 'idCardNo', 'reason', 'riskLevel', 'phone', 'source'];
  const rows = parseBatchTable(event.currentTarget.elements.tableData.value, columns, '姓名');
  const result = await api('/api/blacklist/batch', { method: 'POST', body: JSON.stringify({ rows }) });
  showBatchResult($('#batchBlacklistResult'), result);
  await loadBlacklist();
  if (!result.failureCount) {
    event.currentTarget.reset();
    window.setTimeout(() => $('#batchBlacklistModal').close(), 900);
  }
}

function updateEmployeeProjectOptions(form, selectedValue = '') {
  const select = form?.elements?.projectId;
  if (!select || !state.bootstrap) return;
  const customerId = Number(form.elements.customerId?.value || 0);
  const projects = (state.bootstrap.projects || []).filter(item => Number(item.customerId) === customerId);
  const allowLegacyUnassigned = form.dataset.allowLegacyUnassigned === '1'
    && Number(form.dataset.legacyCustomerId || 0) === customerId;
  const employeeStatus = Number(form.elements.employeeStatus?.value || form.dataset.employeeStatus || 1);
  const projectRequired = employeeStatus !== 6 && Number(state.user?.dataScope) === 5 && !allowLegacyUnassigned;
  select.required = projectRequired;
  select.innerHTML = `<option value="">${projectRequired ? '请选择所属项目' : '暂不关联项目'}</option>${optionHtml(projects, 'id', 'projectName')}`;
  if (selectedValue && projects.some(item => Number(item.id) === Number(selectedValue))) select.value = String(selectedValue);
}

function activeEmployeeOptionHtml() {
  return state.employees
    .filter(item => item.employeeStatus === 2)
    .map(item => `<option value="${item.id}">${escapeHtml(item.name)} / ${escapeHtml(item.customerName || '未分配客户')}</option>`)
    .join('');
}

function populateAdvanceProjectOptions() {
  const customerSelect = $('#advanceCustomerSelect');
  const projectSelect = $('#advanceProjectSelect');
  if (!customerSelect || !projectSelect) return;
  const customerId = Number(customerSelect.value || 0);
  const projects = state.projects.filter(item => Number(item.customerId) === customerId && [1, 2].includes(Number(item.status)));
  const projectRequired = Number(state.user?.dataScope) === 5;
  if (!customerId) {
    projectSelect.innerHTML = '<option value="">请先选择客户单位</option>';
    projectSelect.disabled = true;
    projectSelect.required = false;
    return;
  }
  projectSelect.disabled = false;
  projectSelect.required = projectRequired;
  projectSelect.innerHTML = `${projectRequired ? '<option value="">请选择授权项目</option>' : '<option value="">暂不关联具体项目</option>'}${optionHtml(projects, 'id', 'projectName')}`;
  if (!projects.length) {
    projectSelect.innerHTML = `<option value="">${projectRequired ? '该客户暂无可用授权项目' : '该客户尚未创建具体项目'}</option>`;
  }
}

function syncAdvanceCustomerFromEmployee() {
  const employee = state.employees.find(item => Number(item.id) === Number($('#advanceEmployeeSelect')?.value || 0));
  if (employee?.customerId) $('#advanceCustomerSelect').value = String(employee.customerId);
  populateAdvanceProjectOptions();
}

function localDateTimeInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function prepareAdvanceForm() {
  await Promise.all([loadProjects(), loadEmployees()]);
  const form = $('#advanceForm');
  form.reset();
  $('#advanceEmployeeSelect').innerHTML = activeEmployeeOptionHtml();
  $('#advanceCustomerSelect').innerHTML = optionHtml(state.clients, 'id', 'clientName');
  form.elements.advanceAt.value = localDateTimeInputValue();
  syncAdvanceCustomerFromEmployee();
  $('#advanceModal').showModal();
}

async function loadBootstrap() {
  state.bootstrap = await cachedApi('/api/bootstrap', 60000);
  const customers = state.bootstrap.customers || [];
  const projects = state.bootstrap.projects || [];
  const positions = [...(state.bootstrap.positions || [])].sort((left, right) => {
    if (left.positionName === '普工') return -1;
    if (right.positionName === '普工') return 1;
    return Number(left.id || 0) - Number(right.id || 0);
  });
  state.bootstrap.customers = customers;
  state.bootstrap.projects = projects;
  state.bootstrap.positions = positions;
  $('#customerSelect').innerHTML = `<option value="">全部</option>${optionHtml(customers, 'id', 'customerName')}`;
  $('#formCustomerSelect').innerHTML = `<option value="">请选择工作单位</option>${optionHtml(customers, 'id', 'customerName')}`;
  $('#transferCustomerSelect').innerHTML = optionHtml(customers, 'id', 'customerName');
  $('#transferProjectSelect').innerHTML = `<option value="">仅调整客户/岗位</option>${optionHtml(projects, 'id', 'projectName')}`;
  $('#formPositionSelect').innerHTML = `<option value="">请选择岗位</option>${optionHtml(positions, 'id', 'positionName')}`;
  $('#transferPositionSelect').innerHTML = optionHtml(positions, 'id', 'positionName');
  updateTransferProjectOptions();
  /* 移动端表单下拉框 */
  const mCust = $('#mFormCustomerSelect');
  const mPos = $('#mFormPositionSelect');
  if (mCust) mCust.innerHTML = `<option value="">请选择工作单位</option>${optionHtml(customers, 'id', 'customerName')}`;
  if (mPos) mPos.innerHTML = `<option value="">请选择岗位</option>${optionHtml(positions, 'id', 'positionName')}`;
  updateEmployeeProjectOptions($('#employeeForm'));
  updateEmployeeProjectOptions($('#mobileEmployeeForm'));
}

function updateTransferProjectOptions() {
  const select = $('#transferProjectSelect');
  if (!select || !state.bootstrap) return;
  const customerId = Number($('#transferCustomerSelect')?.value || 0);
  const projects = (state.bootstrap.projects || []).filter(item => !customerId || Number(item.customerId) === customerId);
  select.innerHTML = `<option value="">仅调整客户/岗位</option>${optionHtml(projects, 'id', 'projectName')}`;
}

async function login(event) {
  event.preventDefault();
  if (loginSubmitting) return;
  loginSubmitting = true;
  setLoginError('');
  const submitButton = $('#loginSubmitButton');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = '登录中...';
  }
  const body = formToObject(event.currentTarget);
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    // 仅保存在当前页面内存中；生产环境同时使用 HttpOnly Cookie，原型环境使用 Bearer Token。
    state.token = data.token || '';
    state.user = data.user;
    showApp();
    toast('登录成功', 'success');
    await bootAuthedApp();
  } catch (error) {
    setLoginError(error.message || '登录失败，请稍后重试');
    throw error;
  } finally {
    loginSubmitting = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = '登录系统';
    }
  }
}

function setLoginError(message) {
  const errorElement = $('#loginError');
  if (!errorElement) return;
  errorElement.textContent = message || '';
  errorElement.classList.toggle('hidden', !message);
}

function logout(showMessage = true, revokeServer = true) {
  if (revokeServer) {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  }
  state.token = '';
  state.user = null;
  // 清理旧版本遗留的可被脚本读取的会话数据。
  localStorage.removeItem('hrRosterToken');
  localStorage.removeItem('hrRosterUser');
  $('#loginScreen').classList.remove('hidden');
  $('#userPill').textContent = '未登录';
  if (showMessage) toast('已退出登录');
}

function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#userPill').textContent = state.user ? `${state.user.realName} / ${state.user.roles?.[0]?.roleName || '用户'}` : '已登录';
  applyNavVisibility();
}

/* 角色驱动的导航菜单显隐 */
function applyNavVisibility() {
  const perms = state.user?.permissions || [];
  const isCompanyAdmin = (state.user?.roles || []).some(r => r.roleCode === 'company_admin');
  $$('.nav-item').forEach(item => {
    const requiredPerm = item.dataset.perm;
    if (!requiredPerm || isCompanyAdmin || perms.includes(requiredPerm)) {
      item.style.display = '';
    } else {
      item.style.display = 'none';
    }
  });
  $$('[data-action-perm]').forEach(item => {
    const requiredPerms = String(item.dataset.actionPerm || '').split(',').filter(Boolean);
    item.style.display = isCompanyAdmin || requiredPerms.every(permission => perms.includes(permission)) ? '' : 'none';
  });
  configureMetricRiskAccess();
  applyTopbarActionVisibility(state.activeView);
  /* 移动端 tabbar 也按权限显隐 */
  $$('.mobile-tabbar button').forEach(item => {
    const view = item.dataset.view;
    const navItem = $(`.nav-item[data-view="${view}"]`);
    if (navItem) item.style.display = navItem.style.display;
  });
}

function applyTopbarActionVisibility(view = state.activeView) {
  const permissions = state.user?.permissions || [];
  const isCompanyAdmin = (state.user?.roles || []).some(role => role.roleCode === 'company_admin');
  $$('[data-topbar-views]').forEach(item => {
    const views = String(item.dataset.topbarViews || '').split(',').map(value => value.trim()).filter(Boolean);
    const requiredPermissions = String(item.dataset.actionPerm || '').split(',').filter(Boolean);
    const hasPermission = isCompanyAdmin || requiredPermissions.every(permission => permissions.includes(permission));
    item.style.display = views.includes(view) && hasPermission ? '' : 'none';
  });
}

async function loadSummary() {
  const summary = await api('/api/summary');
  setAnimatedMetric('employeeTotal', summary.employeeTotal);
  setAnimatedMetric('activeTotal', summary.activeTotal);
  setAnimatedMetric('unresolvedRiskTotal', summary.unresolvedRiskTotal);
  setAnimatedMetric('unsignedTotal', summary.unsignedTotal);
  setAnimatedMetric('advanceOutstanding', `¥${Number(summary.advanceOutstanding || 0).toLocaleString('zh-CN')}`);
}

function getQueryString() {
  const params = new URLSearchParams(new FormData($('#filterForm')));
  params.set('page', '1');
  params.set('pageSize', '200');
  for (const [key, value] of Array.from(params.entries())) {
    if (!value) params.delete(key);
  }
  return params.toString();
}

async function selectEmployee(id) {
  state.selectedEmployeeId = Number(id);
  renderEmployees();
  const detail = await api(`/api/employees/${id}`);
  state.selectedDetail = detail;
  renderDetail(detail);
}

function renderDetail(detail) {
  $('#emptyDetail').classList.add('hidden');
  const content = $('#detailContent');
  content.classList.remove('hidden');
  const basic = detail.basicInfo;
  const riskRows = detail.riskAlertList || [];
  const permissions = state.user?.permissions || [];

  content.innerHTML = `
    <div class="profile-head">
      <div class="profile-title">
        <div>
          <strong>${escapeHtml(basic.name)}</strong>
          <span>${escapeHtml(basic.genderName)} / ${escapeHtml(basic.customerName || '未分配客户单位')}</span>
        </div>
        ${badge(basic.employeeStatusName, statusTone(basic.employeeStatus))}
      </div>
      <div class="topbar-actions">
        ${permissions.includes('employee:update') ? `<button class="secondary-button" type="button" data-action="edit" data-id="${basic.id}">编辑</button>` : ''}
        ${permissions.includes('employee:transfer') ? `<button class="secondary-button" type="button" data-action="transfer" data-id="${basic.id}">调岗</button>` : ''}
        ${permissions.includes('contract:manage') && permissions.includes('social:manage') && Number(basic.employeeStatus) === 2 ? `<button class="primary-button" type="button" data-action="compliance" data-id="${basic.id}">一键确认合同和雇主险</button>` : ''}
        ${permissions.includes('contract:manage') ? `<button class="secondary-button" type="button" data-action="contract" data-id="${basic.id}">合同</button>` : ''}
        ${permissions.includes('social:manage') ? `<button class="secondary-button" type="button" data-action="social" data-id="${basic.id}">雇主险</button>` : ''}
        ${permissions.includes('cert:manage') ? `<button class="secondary-button" type="button" data-action="certificate" data-id="${basic.id}">证件</button>` : ''}
        ${permissions.includes('employee:resign') ? `<button class="danger-button" type="button" data-action="resign" data-id="${basic.id}">离职</button>` : ''}
      </div>
    </div>

    <section class="detail-section">
      <h3>基础信息</h3>
      <div class="info-grid">
        ${infoItem('手机号', basic.phone)}
        ${infoItem('身份证号', basic.idCardNo)}
        ${infoItem('地址', basic.address || '-')}
        ${infoItem('学历', basic.education || '-')}
        ${infoItem('银行卡', basic.bankCardNo || '-')}
        ${infoItem('紧急联系人', basic.emergencyContact || '-')}
        ${infoItem('紧急电话', basic.emergencyPhone || '-')}
      </div>
    </section>

    <section class="detail-section">
      <h3>当前任职</h3>
      <div class="info-grid">
        ${infoItem('客户单位', basic.customerName)}
        ${infoItem('岗位', basic.positionName)}
        ${infoItem('用工模式', basic.employmentTypeName)}
        ${infoItem('费用模式', basic.feeModeName || '-')}
        ${infoItem('工资类型', basic.workTypeName)}
        ${infoItem('入职日期', basic.hireDate)}
        ${infoItem('雇主险状态', basic.employerInsuranceStatusName || '未增保')}
      </div>
    </section>

    <section class="detail-section">
      <h3>合同记录</h3>
      <div class="timeline">
        ${renderContracts(detail.contractList)}
      </div>
    </section>

    <section class="detail-section">
      <h3>证件资料</h3>
      <div class="timeline">
        ${renderCertificates(detail.certificateList)}
      </div>
    </section>

    <section class="detail-section">
      <h3>合规附件</h3>
      <div class="attachment-list">${renderAttachmentRows(detail.attachmentList)}</div>
    </section>

    <section class="detail-section">
      <h3>未处理风险</h3>
      <div class="timeline">
        ${
          riskRows.length
            ? riskRows.map(risk => `<button type="button" class="timeline-item risk-link-item" data-risk-jump="${risk.id}"><strong>${escapeHtml(risk.riskTitle)}</strong><span>${escapeHtml(risk.riskDesc)}</span><small>查看风险详情 →</small></button>`).join('')
            : '<span class="muted">暂无风险</span>'
        }
      </div>
    </section>
  `;
}

function infoItem(label, value) {
  return `<div class="info-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
}

function renderContracts(rows) {
  if (!rows || !rows.length) return '<span class="muted">暂无合同记录</span>';
  return rows
    .map(
      row => `
        <div class="timeline-item">
          <strong>${row.contractNo} ${badge(row.contractStatusName, contractTone(row.contractStatusName))}</strong>
          <span>${row.startDate || '-'} 至 ${row.endDate || '无固定期限'} / ${row.signStatusName}</span>
        </div>
      `
    )
    .join('');
}

function renderCertificates(rows) {
  if (!rows || !rows.length) return '<span class="muted">暂无证件资料</span>';
  return rows
    .map(
      row => `
        <div class="timeline-item">
          <strong>${row.certTypeName}</strong>
          <span>${row.certNo || '-'} / 到期：${row.expireDate || '长期'} / ${row.verifyStatusName}</span>
        </div>
      `
    )
    .join('');
}

function buildOnboardingComplianceRows(risks = state.risks || []) {
  const employees = new Map();
  for (const risk of risks) {
    const employeeId = Number(risk.employeeId);
    if (!employees.has(employeeId)) {
      employees.set(employeeId, {
        employeeId,
        employeeName: risk.employeeName || risk.employeeNo,
        employeeNo: risk.employeeNo || '',
        customerName: risk.customerName || '',
        projectId: risk.projectId || null,
        projectName: risk.projectName || '',
        positionName: risk.positionName || '',
        hireDate: risk.hireDate || '',
        contractSigned: Boolean(risk.contractSigned),
        employerInsuranceActive: Boolean(risk.employerInsuranceActive),
        alerts: []
      });
    }
    const employee = employees.get(employeeId);
    employee.contractSigned = employee.contractSigned || Boolean(risk.contractSigned);
    employee.employerInsuranceActive = employee.employerInsuranceActive || Boolean(risk.employerInsuranceActive);
    employee.alerts.push(risk);
  }
  return [...employees.values()].map(employee => ({
    ...employee,
    completed: employee.contractSigned && employee.employerInsuranceActive,
    pendingCount: Number(!employee.contractSigned) + Number(!employee.employerInsuranceActive)
  })).sort((left, right) => right.pendingCount - left.pendingCount || Number(right.employeeId) - Number(left.employeeId));
}

function applyRiskPreset(preset) {
  const filter = $('#riskComplianceFilter');
  if (!filter) return;
  const mapped = { open: 'pending', high: 'pending', contract: 'contract', insurance: 'insurance', completed: 'completed' };
  filter.value = mapped[preset] || 'all';
  renderRiskCenter();
}

function renderRiskCenter() {
  const filter = $('#riskComplianceFilter')?.value || 'pending';
  const keyword = ($('#riskKeywordInput')?.value || '').trim().toLowerCase();
  const all = buildOnboardingComplianceRows();
  const contractPending = all.filter(row => !row.contractSigned);
  const insurancePending = all.filter(row => !row.employerInsuranceActive);
  const pending = all.filter(row => !row.completed);
  const completed = all.filter(row => row.completed);
  $('#complianceKpis').innerHTML = [
    ['open', '待完善员工', pending.length, '查看名单'],
    ['contract', '合同待签', contractPending.length, '登记合同'],
    ['insurance', '雇主险待增', insurancePending.length, '办理增保'],
    ['completed', '两项已完成', completed.length, '合规完成']
  ].map(([preset, labelText, value, hint]) => `<button type="button" class="risk-command-kpi ${preset !== 'completed' && value ? 'danger' : ''}" data-risk-preset="${preset}"><span>${labelText}</span><strong>${value}</strong><small>${hint} →</small></button>`).join('');

  const filtered = all.filter(row => {
    if (filter === 'pending' && row.completed) return false;
    if (filter === 'contract' && row.contractSigned) return false;
    if (filter === 'insurance' && row.employerInsuranceActive) return false;
    if (filter === 'completed' && !row.completed) return false;
    if (state.selectedRiskProjectId && Number(row.projectId) !== Number(state.selectedRiskProjectId)) return false;
    if (keyword && !`${row.employeeName} ${row.employeeNo} ${row.customerName} ${row.projectName} ${row.positionName}`.toLowerCase().includes(keyword)) return false;
    return true;
  });
  $('#riskQueueCount').textContent = `${filtered.length} 人`;
  const list = $('#riskList');
  if (!filtered.length) {
    list.innerHTML = '<div class="risk-command-empty"><strong>当前范围没有员工</strong><p>切换查看范围，或点击“重新检查”同步最新合同和雇主险状态。</p></div>';
    $('#riskDetailPanel').innerHTML = '<div class="risk-detail-empty"><span>ONBOARDING FILE</span><strong>暂无待处理事项</strong><p>新员工入职后会自动进入这里。</p></div>';
    return;
  }
  if (!filtered.some(row => Number(row.employeeId) === Number(state.selectedRiskId))) state.selectedRiskId = filtered[0].employeeId;
  list.innerHTML = filtered.map(row => `<article class="risk-command-card ${Number(row.employeeId) === Number(state.selectedRiskId) ? 'selected' : ''} ${row.completed ? 'completed' : 'high'}" data-risk-detail="${row.employeeId}" tabindex="0" role="button">
    <div class="risk-command-card-top"><span class="risk-severity-code">${row.completed ? '✓' : row.pendingCount}</span><div><strong>${escapeHtml(row.employeeName)}</strong><small>${escapeHtml(row.customerName || '未分配客户')} · ${escapeHtml(row.projectName || row.positionName || '未关联项目')}</small></div>${badge(row.completed ? '合规完成' : `待完成 ${row.pendingCount} 项`, row.completed ? 'green' : 'amber')}</div>
    <div class="onboarding-status-pair"><span class="${row.contractSigned ? 'done' : 'pending'}">合同 ${row.contractSigned ? '已签订' : '待签订'}</span><span class="${row.employerInsuranceActive ? 'done' : 'pending'}">雇主险 ${row.employerInsuranceActive ? '保障中' : '待增保'}</span></div>
    <div class="risk-card-foot"><span>入职日期 ${escapeHtml(row.hireDate || '-')}</span><span>${escapeHtml(row.positionName || '未关联岗位')}</span></div>
  </article>`).join('');
  renderRiskDetail(filtered.find(row => Number(row.employeeId) === Number(state.selectedRiskId)));
}

function renderRiskDetail(row) {
  const panel = $('#riskDetailPanel');
  if (!row) return;
  const permissions = state.user?.permissions || [];
  const canContract = permissions.includes('contract:manage');
  const canInsurance = permissions.includes('social:manage');
  const canCompliance = canContract && canInsurance;
  panel.innerHTML = `<div class="risk-detail-head"><div><span>EMPLOYEE #${row.employeeId}</span><h3>${escapeHtml(row.employeeName)}</h3></div>${badge(row.completed ? '入职合规完成' : '入职事项待完善', row.completed ? 'green' : 'amber')}</div>
    <div class="risk-detail-context onboarding-person-context">
      ${infoItem('客户单位', row.customerName || '未分配')}
      ${infoItem('所属项目', row.projectName || '未关联')}
      ${infoItem('岗位', row.positionName || '未关联')}
      ${infoItem('入职日期', row.hireDate || '-')}
    </div>
    <section class="onboarding-check-list">
      <article class="onboarding-check-card ${row.contractSigned ? 'done' : 'pending'}"><div><i>${row.contractSigned ? '✓' : '1'}</i><span><strong>劳动合同</strong><small>${row.contractSigned ? '已登记已签署合同' : '尚未登记已签署合同'}</small></span></div>${row.contractSigned ? badge('已签订', 'green') : canContract ? `<button class="primary-button" type="button" data-action="contract" data-id="${row.employeeId}">登记合同</button>` : badge('待签订', 'amber')}</article>
      <article class="onboarding-check-card ${row.employerInsuranceActive ? 'done' : 'pending'}"><div><i>${row.employerInsuranceActive ? '✓' : '2'}</i><span><strong>雇主险</strong><small>${row.employerInsuranceActive ? '当前雇主险保障有效' : '尚未办理有效雇主险增保'}</small></span></div>${row.employerInsuranceActive ? badge('保障中', 'green') : canInsurance ? `<button class="primary-button" type="button" data-action="social" data-id="${row.employeeId}" data-insurance-action="ADD">办理增保</button>` : badge('待增保', 'amber')}</article>
    </section>
    <div class="onboarding-result ${row.completed ? 'done' : ''}"><strong>${row.completed ? '两项均已完成' : `还有 ${row.pendingCount} 项需要办理`}</strong><p>${row.completed ? '系统已自动完成入职合规闭环。' : '办理完成后系统会自动更新状态，无需建立整改任务。'}</p></div>
    ${!row.completed && canCompliance ? `<button class="primary-button" type="button" data-action="compliance" data-id="${row.employeeId}">一键确认合同和雇主险</button>` : ''}
    <div class="risk-detail-actions"><button class="secondary-button" type="button" data-risk-employee="${row.employeeId}">查看员工档案</button></div>`;
}

async function loadRiskCenter() {
  setPanelLoading('#riskView');
  try {
    state.risks = await api('/api/risk-alerts');
    state.riskCases = [];
    renderRiskCenter();
  } finally { setPanelLoaded('#riskView'); }
}

async function loadRisks() { return loadRiskCenter(); }
async function loadRiskCases() { return loadRiskCenter(); }

function configureRiskStatusOptions(select, currentStatus) {
  const status = Number(currentStatus || 0);
  const options = status === 0
    ? [[0, '待整改：已指派，尚未开始'], [1, '整改中：责任人已开始处理']]
    : status === 1
      ? [[1, '整改中：继续处理'], [2, '提交复核：整改完成并已提供证据']]
      : status === 2
        ? [[2, '继续待复核：尚未作出决定'], [1, '退回整改：证据或结果不符合要求'], [3, '复核通过：关闭并归档风险']]
        : [[3, '已关闭：风险已归档']];
  select.innerHTML = options.map(([value, labelText]) => `<option value="${value}">${labelText}</option>`).join('');
  select.value = String(status);
}

async function openRiskCaseModal(id, mode = 'create') {
  const form = $('#riskCaseForm');
  form.reset();
  $$('.case-progress-field').forEach(item => item.classList.toggle('hidden', mode === 'create'));
  if (mode === 'create') {
    const risk = state.risks.find(item => item.id === Number(id));
    if (!risk) throw new Error('风险预警不存在');
    form.elements.sourceAlertId.value = risk.id;
    form.elements.deadline.value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    configureRiskStatusOptions(form.elements.status, 0);
    $('#riskCaseModalTitle').textContent = '建立整改任务';
    $('#riskCaseSubmitButton').textContent = '创建并指派整改';
    $('#riskCaseSource').innerHTML = `<strong>${escapeHtml(risk.riskTitle)}</strong><span>${escapeHtml(risk.employeeName)} · ${escapeHtml(risk.customerName || '未分配客户')}：${escapeHtml(risk.riskDesc)}</span>`;
  } else {
    const row = state.riskCases.find(item => item.id === Number(id));
    if (!row) throw new Error('整改任务不存在');
    configureRiskStatusOptions(form.elements.status, row.status);
    const values = { caseId: row.id, sourceAlertId: row.sourceAlertId, ownerName: row.ownerName, ownerDept: row.ownerDept, deadline: row.deadline, correctiveMeasure: row.correctiveMeasure, status: row.status, evidenceNote: row.evidenceNote, reviewNote: row.reviewNote };
    for (const [key, value] of Object.entries(values)) form.elements[key].value = value ?? '';
    $('#riskCaseModalTitle').textContent = Number(row.status) === 2 ? '复核整改结果' : '更新整改进度';
    $('#riskCaseSubmitButton').textContent = Number(row.status) === 2 ? '保存复核结果' : '保存整改进度';
    $('#riskCaseSource').innerHTML = `<strong>${escapeHtml(row.riskTitle)}</strong><span>${escapeHtml(row.employeeName)} · ${escapeHtml(row.customerName || '未分配客户')}：${escapeHtml(row.riskDesc)}</span>`;
  }
  updateRiskStatusHelp();
  $('#riskCaseModal').showModal();
}

function updateRiskStatusHelp() {
  const status = Number($('#riskCaseForm')?.elements?.status?.value || 0);
  const messages = {
    0: '待整改：任务已指派，但责任人尚未开始处理。',
    1: '整改中：正在处理风险问题，可持续补充整改措施。',
    2: '待复核：必须填写整改结果或证据说明，等待有权限人员复核。',
    3: '已关闭：必须填写整改证据和复核结论，保存后风险正式归档。'
  };
  $('#riskStatusHelp').textContent = messages[status];
}

async function saveRiskCase(event) {
  event.preventDefault();
  const attachment = selectedAttachment(event.currentTarget);
  const body = formToObject(event.currentTarget);
  const caseId = Number(body.caseId || 0);
  const status = Number(body.status || 0);
  if (status >= 2 && !String(body.evidenceNote || '').trim()) {
    throw new Error('提交复核前，请填写整改结果或证据说明');
  }
  if (status === 3 && !String(body.reviewNote || '').trim()) {
    throw new Error('关闭风险前，请填写复核结论');
  }
  if (caseId && status === 3 && !window.confirm('确认整改证据有效且风险已经消除？关闭后将进入归档状态。')) return;
  const result = await api(caseId ? `/api/risk-cases/${caseId}` : '/api/risk-cases', { method: caseId ? 'PUT' : 'POST', body: JSON.stringify(body) });
  const attachmentUploaded = await uploadSavedAttachment(attachment, 'risk_case', result.caseId);
  $('#riskCaseModal').close();
  if (attachmentUploaded) toast(caseId ? '整改进度已更新' : '整改任务已创建并指派');
  state.selectedRiskId = Number(body.sourceAlertId || state.selectedRiskId);
  await Promise.all([loadRiskCenter(), loadSummary()]);
}

const actionNames = {
  create: '新增',
  update: '编辑',
  transfer: '调岗',
  resign: '离职',
  upsert: '维护',
  handle: '处理',
  change_password: '修改密码'
  ,create_case: '创建整改任务'
  ,update_case: '更新整改任务'
  ,close_case: '复核关闭风险'
};

async function loadAuditLogs() {
  setPanelLoading('#auditTableBody');
  try {
  const rows = await api('/api/audit-logs');
  const tbody = $('#auditTableBody');
  if (!rows.length) {
    tbody.innerHTML = emptyRow(6, '暂无操作记录', '系统操作日志会在员工、合同、雇主险等关键操作后自动记录');
    return;
  }
  tbody.innerHTML = rows
    .map(row => `
      <tr>
        <td>${new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
        <td>${row.operatorName}</td>
        <td>${row.moduleName}</td>
        <td>${badge(actionNames[row.actionType] || row.actionType, 'blue')}</td>
        <td>${row.bizId || '-'}</td>
        <td>${row.detail || '-'}</td>
      </tr>
    `)
    .join('');
  } finally { setPanelLoaded('#auditTableBody'); }
}

async function changePassword(event) {
  event.preventDefault();
  const body = formToObject(event.currentTarget);
  await api('/api/auth/password', { method: 'PUT', body: JSON.stringify(body) });
  $('#passwordModal').close();
  event.currentTarget.reset();
  logout(false);
  toast('密码已修改，请使用新密码重新登录');
}

function applyEmployeeFormDefaults(form) {
  if (!form || !state.bootstrap) return;
  const generalWorker = (state.bootstrap.positions || []).find(item =>
    item.positionCode === 'OP' || item.positionName === '普工'
  );
  if (form.elements.positionId && generalWorker) {
    form.elements.positionId.value = String(generalWorker.id);
  }
  if (form.elements.workType) form.elements.workType.value = '1';
  if (form.elements.employeeStatus) form.elements.employeeStatus.value = '6';
  if (form.elements.hireDate) form.elements.hireDate.value = new Date().toISOString().slice(0, 10);
}

function syncEmployeeFormRequirements(form, statusValue = '') {
  if (!form) return;
  const employeeStatus = Number(statusValue || form.elements.employeeStatus?.value || form.dataset.employeeStatus || 1);
  const interview = employeeStatus === 6;
  for (const name of ['idCardNo', 'customerId', 'positionId']) {
    if (form.elements[name]) form.elements[name].required = !interview;
  }
  // 用工与计费、招聘来源和备注均允许后续补齐。
  for (const name of ['employmentType', 'feeMode', 'workType', 'hireDate', 'channelSource', 'remark']) {
    if (form.elements[name]) form.elements[name].required = false;
  }
  updateEmployeeProjectOptions(form);
  if (interview && form.elements.projectId) form.elements.projectId.required = false;
}

async function openEmployeeModal(id = null) {
  await ensureRecruitmentChannelOptions();
  state.editingEmployeeId = id;
  const form = $('#employeeForm');
  form.reset();
  delete form.dataset.allowLegacyUnassigned;
  delete form.dataset.legacyCustomerId;
  delete form.dataset.employeeStatus;
  updateEmployeeProjectOptions(form);
  $('#employeeModalTitle').textContent = id ? '编辑员工' : '新增员工';
  $('#employeeStatusField')?.classList.toggle('hidden', Boolean(id));
  if (!id) applyEmployeeFormDefaults(form);
  configureSensitiveEmployeeFields(form, Boolean(id));
  syncEmployeeFormRequirements(form);

  if (id) {
    const detailUrl = canViewSensitiveEmployee()
      ? `/api/employees/${id}?showSensitive=1&reason=${encodeURIComponent('编辑员工档案')}`
      : `/api/employees/${id}`;
    const detail = await api(detailUrl);
    const row = detail.basicInfo;
    const allowLegacyUnassigned = !row.projectId && Number(row.createdBy) === Number(state.user?.id);
    form.dataset.allowLegacyUnassigned = allowLegacyUnassigned ? '1' : '0';
    form.dataset.legacyCustomerId = String(row.customerId || '');
    const values = {
      name: row.name,
      gender: row.gender,
      education: row.education,
      idCardNo: canViewSensitiveEmployee() ? row.idCardNo : '',
      address: canViewSensitiveEmployee() ? row.address : '',
      phone: canViewSensitiveEmployee() ? row.phone : '',
      customerId: row.customerId,
      projectId: row.projectId,
      positionId: row.positionId,
      workType: row.workType,
      hireDate: row.hireDate,
      employmentType: row.employmentType,
      feeMode: row.feeMode,
      channelSource: row.recruitmentChannelName || row.channelSource,
      remark: row.remark,
      bankName: row.bankName,
      bankCardNo: canViewSensitiveEmployee() ? row.bankCardNo : '',
      emergencyContact: row.emergencyContact,
      emergencyPhone: canViewSensitiveEmployee() ? row.emergencyPhone : ''
    };
    form.dataset.employeeStatus = String(row.employeeStatus || '');
    for (const [key, value] of Object.entries(values)) {
      if (key === 'projectId') continue;
      if (form.elements[key]) form.elements[key].value = value || '';
    }
    updateEmployeeProjectOptions(form, values.projectId);
    syncEmployeeFormRequirements(form, row.employeeStatus);
  }

  $('#employeeModal').showModal();
}

function openTransferModal(id) {
  state.transferEmployeeId = Number(id);
  $('#transferForm').reset();
  $('#transferModal').showModal();
}

function openResignModal(id) {
  state.resignEmployeeId = Number(id);
  const form = $('#resignForm');
  form.reset();
  const now = new Date();
  form.elements.leaveDate.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const covered = Number(state.selectedDetail?.socialSecurity?.employerInsuranceStatus || 0) === 1;
  form.elements.terminateEmployerInsurance.checked = false;
  form.elements.terminateEmployerInsurance.disabled = !covered;
  form.elements.terminateEmployerInsurance.required = covered;
  $('#resignInsuranceHint').textContent = covered
    ? '办理减保后勾选“已减保”，再确认员工离职'
    : '当前未投保或已终止，无需办理减保';
  $('#resignModal').showModal();
}

function openContractModal(id) {
  state.selectedEmployeeId = Number(id);
  const form = $('#contractForm');
  form.reset();
  form.elements.signStatus.value = '1';
  const now = new Date();
  form.elements.contractDate.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $('#contractModal').showModal();
}

function openComplianceModal(id) {
  state.selectedEmployeeId = Number(id);
  const form = $('#complianceForm');
  form.reset();
  const now = new Date();
  const date = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  form.elements.contractDate.value = date;
  form.elements.insuranceStartDate.value = date;
  $('#complianceModal').showModal();
}

function openSocialModal(id, requestedAction = '') {
  state.selectedEmployeeId = Number(id);
  const form = $('#socialForm');
  form.reset();
  const social = Number(state.selectedDetail?.basic?.id) === Number(id) ? state.selectedDetail?.socialSecurity : null;
  const explicitAction = ['ADD', 'REMOVE'].includes(requestedAction) ? requestedAction : '';
  form.elements.employerInsuranceAction.value = explicitAction || (Number(social?.employerInsuranceStatus) === 1 ? 'REMOVE' : 'ADD');
  $('#socialModal').showModal();
}

function openCertificateModal(id) {
  state.selectedEmployeeId = Number(id);
  $('#certificateForm').reset();
  $('#certificateModal').showModal();
}

async function saveEmployee(event) {
  event.preventDefault();
  const id = state.editingEmployeeId;
  const body = removeUnavailableSensitiveFields(event.currentTarget, formToObject(event.currentTarget), Boolean(id));
  if (id) delete body.employeeStatus;
  const path = id ? `/api/employees/${id}` : '/api/employees';
  const method = id ? 'PUT' : 'POST';
  const result = await api(path, { method, body: JSON.stringify(body) });
  $('#employeeModal').close();
  toast(id ? '员工信息已保存' : '员工已新增');
  await refreshEmployeeWorkspace();
  await selectEmployee(result.employeeId);
}

async function submitTransfer(event) {
  event.preventDefault();
  const body = formToObject(event.currentTarget);
  const result = await api(`/api/employees/${state.transferEmployeeId}/job-transfer`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  $('#transferModal').close();
  toast(result.changeStatus ? '转岗申请已提交，等待目标项目接收' : '调岗成功');
  await refreshEmployeeWorkspace();
  await selectEmployee(state.transferEmployeeId);
}

async function submitResign(event) {
  event.preventDefault();
  const body = formToObject(event.currentTarget);
  if (!window.confirm('确认完成离职？保存后员工将转入花名册“已离职”，并同步进入人才库。')) return;
  const result = await api(`/api/employees/${state.resignEmployeeId}/resign`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  $('#resignModal').close();
  toast(result.completed ? '离职已办结，员工已归档并同步人才库' : '离职信息已保存');
  await refreshEmployeeWorkspace();
  await selectEmployee(state.resignEmployeeId);
}

async function submitContract(event) {
  event.preventDefault();
  const attachment = selectedAttachment(event.currentTarget);
  const body = formToObject(event.currentTarget);
  const result = await api(`/api/employees/${state.selectedEmployeeId}/contracts`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const attachmentUploaded = await uploadSavedAttachment(attachment, 'contract', result.contractId);
  $('#contractModal').close();
  if (attachmentUploaded) toast('合同已登记');
  await refreshEmployeeWorkspace();
  await selectEmployee(state.selectedEmployeeId);
}

async function submitSocial(event) {
  event.preventDefault();
  const body = formToObject(event.currentTarget);
  await api(`/api/employees/${state.selectedEmployeeId}/social-security`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
  $('#socialModal').close();
  toast(body.employerInsuranceAction === 'ADD' ? '雇主险增保已登记' : '雇主险减保已登记');
  await refreshEmployeeWorkspace();
  await selectEmployee(state.selectedEmployeeId);
}

async function submitOnboardingCompliance(event) {
  event.preventDefault();
  const body = formToObject(event.currentTarget);
  if (!window.confirm('确认该员工劳动合同已签署，且雇主险已完成增保？')) return;
  await api(`/api/employees/${state.selectedEmployeeId}/onboarding-compliance/confirm`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  $('#complianceModal').close();
  toast('合同和雇主险已一键确认');
  await refreshEmployeeWorkspace();
  await selectEmployee(state.selectedEmployeeId);
}

async function submitCertificate(event) {
  event.preventDefault();
  const attachment = selectedAttachment(event.currentTarget);
  const body = formToObject(event.currentTarget);
  const result = await api(`/api/employees/${state.selectedEmployeeId}/certificates`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const attachmentUploaded = await uploadSavedAttachment(attachment, 'certificate', result.certificateId);
  $('#certificateModal').close();
  if (attachmentUploaded) toast('证件已添加');
  await refreshEmployeeWorkspace();
  await selectEmployee(state.selectedEmployeeId);
}

async function scanRisks() {
  const data = await api('/api/risk-alerts/scan', { method: 'POST' });
  toast(`入职合规检查完成，新增 ${data.created} 项待办`);
  await refreshEmployeeWorkspace();
}

async function handleRisk(id, status) {
  if (Number(status) === 3 && !window.confirm('确认忽略该风险？忽略表示当前无需整改，但操作会被记录。')) return;
  await api(`/api/risk-alerts/${id}/handle`, {
    method: 'PUT',
    body: JSON.stringify({
      handleStatus: Number(status),
      handleRemark: status === '2' ? '已完成处理并确认风险消除' : '经确认当前无需整改，已忽略'
    })
  });
  toast(status === '2' ? '风险已处理' : '风险已忽略');
  await Promise.all([loadRiskCenter(), loadSummary()]);
}

async function loadProjects() {
  setPanelLoading('#projectCards');
  try {
  const userPermissions = state.user?.permissions || [];
  const isCompanyAdmin = (state.user?.roles || []).some(role => role.roleCode === 'company_admin');
  const canViewCustomers = isCompanyAdmin || userPermissions.includes('customer:view');
  const [clientResult, projectResult] = await Promise.all([
    canViewCustomers ? api('/api/clients') : Promise.resolve({ list: [] }),
    api('/api/projects')
  ]);
  const clients = (clientResult.list || clientResult).map(item => ({
    ...item,
    clientName: item.clientName || item.customerName || ''
  }));
  const projects = (projectResult.list || projectResult).map(item => ({
    ...item,
    clientName: item.clientName || item.customerName || '',
    worksiteName: item.worksiteName || item.factoryName || '-',
    serviceType: typeof item.serviceType === 'number' ? ({ 1: '劳务派遣', 2: '岗位外包', 3: '灵活用工', 4: 'RPO招聘' }[item.serviceType] || '其他') : item.serviceType,
    managerName: item.onsiteManagerNames || item.managerName || '未派驻厂',
    activeCount: Number(item.activeCount || item.onsiteCount || 0)
  }));
  state.clients = clients;
  state.projects = projects;
  const canManageClientProjects = isCompanyAdmin
    || (userPermissions.includes('customer:manage') && userPermissions.includes('project:manage'));
  const canAssignOnsite = isCompanyAdmin
    || userPermissions.includes('system:role');
  const canViewRisk = isCompanyAdmin
    || userPermissions.includes('risk:view');
  const healthTotals = projects.reduce((summary, item) => ({
    onsite: summary.onsite + Number(item.activeCount || 0),
    contract: summary.contract + Number(item.unsignedContractCount || 0),
    insurance: summary.insurance + Number(item.uninsuredCount || 0),
    risk: summary.risk + Number(item.openRiskCount || 0),
    outstanding: summary.outstanding + Number(item.advanceOutstanding || 0)
  }), { onsite: 0, contract: 0, insurance: 0, risk: 0, outstanding: 0 });
  $('#projectHealthKpis').innerHTML = [
    ['生效项目', projects.filter(item => [1, 2].includes(Number(item.status))).length, 'neutral'],
    ['当前在岗', healthTotals.onsite, 'good'],
    ['合同缺口', healthTotals.contract, healthTotals.contract ? 'danger' : 'good'],
    ['雇主险待增', healthTotals.insurance, healthTotals.insurance ? 'danger' : 'good'],
    ['未关闭风险', healthTotals.risk, healthTotals.risk ? 'danger' : 'good'],
    ['预支未结', money(healthTotals.outstanding), healthTotals.outstanding ? 'warning' : 'good']
  ].map(([label, value, tone]) => `<article class="mini-kpi ${tone}"><span>${label}</span><strong>${value}</strong></article>`).join('');
  $('#clientCards').innerHTML = clients.map(item => {
    const scale = Math.min(Number(item.activeCount || 0) / 50, 1);
    return `
    <article class="entity-card client-card-enhanced ${canManageClientProjects ? 'client-card-manageable' : ''}" ${canManageClientProjects ? `data-manage-client="${item.id}" tabindex="0" role="button"` : ''}>
      <div class="entity-index">C${String(item.id).padStart(2, '0')}</div>
      <div>
        <div class="client-card-head"><h4>${escapeHtml(item.clientName)}</h4>${badge('已生效', 'green')}</div>
        <p>${escapeHtml(item.contactName || '-')} · ${escapeHtml(item.contactPhone || '-')}</p>
        <div class="client-scale"><span>在岗规模</span><div class="scale-bar"><div class="scale-fill" style="width:${scale * 100}%"></div></div><strong>${item.activeCount || 0}人</strong></div>
        <div class="entity-meta"><span>${item.settlementCycle || '按月结算'}</span><strong>${item.projectCount || 0}个项目</strong></div>
        ${canManageClientProjects ? '<div class="client-manage-hint">点击查看并修改客户项目 →</div>' : ''}
      </div>
    </article>`;
  }).join('') || '<p class="empty-copy">暂无客户</p>';
  $('#projectCards').innerHTML = projects.map(item => `
    <article class="entity-card project-card health-card">
      <div class="entity-index">P${String(item.id).padStart(2, '0')}</div>
      <div>
        <div class="project-card-title"><div><h4>${escapeHtml(item.projectName)}</h4><p>${escapeHtml(item.clientName)} · ${escapeHtml(item.worksiteName)}</p></div>${badge([1, 2].includes(Number(item.status)) ? '已生效' : '停用', [1, 2].includes(Number(item.status)) ? 'green' : 'amber')}</div>
        <div class="project-health-grid">
          <span><i>在岗人数</i><b>${item.activeCount}</b></span>
          <span class="${item.unsignedContractCount ? 'risk' : ''}"><i>合同缺口</i><b>${item.unsignedContractCount || 0}</b></span>
          <span class="${item.uninsuredCount ? 'risk' : ''}"><i>雇主险待增</i><b>${item.uninsuredCount || 0}</b></span>
          <span class="${item.openRiskCount ? 'risk' : ''}"><i>未结风险</i><b>${item.openRiskCount || 0}</b></span>
        </div>
        <div class="project-money-row"><span>预支未结 ${money(item.advanceOutstanding)}</span><strong>累计实发 ${money(item.payrollNet)}</strong></div>
        <div class="entity-meta"><span>${escapeHtml(item.serviceType)}</span><strong>${escapeHtml(item.managerName)}</strong></div>
        <div class="project-quick-actions">
          ${canAssignOnsite ? `<button class="quick-btn" type="button" data-action="assign-onsite" data-project="${item.id}">派遣驻厂</button>` : ''}
          ${canViewRisk ? `<button class="quick-btn ${item.openRiskCount ? 'warn' : ''}" type="button" data-action="goto-risk" data-project="${item.id}">查看风险</button>` : ''}
        </div>
      </div>
    </article>
  `).join('') || '<p class="empty-copy">暂无项目</p>';
  if ($('#advanceCustomerSelect')) {
    $('#advanceCustomerSelect').innerHTML = optionHtml(clients, 'id', 'clientName');
    populateAdvanceProjectOptions();
  }
  } finally { setPanelLoaded('#projectCards'); }
}

async function openProjectOnsiteModal(projectId) {
  const project = state.projects.find(item => Number(item.id) === Number(projectId));
  if (!project) throw new Error('未找到当前项目，请刷新后重试');
  const form = $('#projectOnsiteForm');
  form.reset();
  form.elements.projectId.value = String(projectId);
  $('#projectOnsiteTitle').textContent = `派遣驻厂 · ${project.projectName}`;
  $('#projectOnsiteContext').textContent = `${project.clientName} / ${project.worksiteName || '未填写用工地点'}`;
  $('#projectOnsiteAssigneeList').innerHTML = '<p class="muted">正在加载驻厂专员...</p>';
  $('#projectOnsiteModal').showModal();

  const result = await api(`/api/system/projects/${projectId}/onsite-assignees`);
  const users = result.users || [];
  $('#projectOnsiteAssigneeList').innerHTML = users.length
    ? users.map(user => `
      <label class="checkbox-item">
        <input type="checkbox" name="userIds" value="${user.userId}" ${user.assigned ? 'checked' : ''} />
        <span>${escapeHtml(user.realName)}</span>
        <small>${escapeHtml(user.username)}${user.phone ? ` · ${escapeHtml(user.phone)}` : ''}</small>
      </label>
    `).join('')
    : '<p class="empty-copy">暂无可派遣的驻厂专员，请先在权限管理中创建“驻厂专员”账号。</p>';
}

async function saveProjectOnsiteAssignment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const projectId = Number(form.elements.projectId.value);
  if (!projectId) throw new Error('项目参数无效，请关闭弹窗后重试');
  const userIds = [...form.querySelectorAll('input[name="userIds"]:checked')].map(input => Number(input.value));
  await api(`/api/system/projects/${projectId}/onsite-assignees`, {
    method: 'PUT',
    body: JSON.stringify({ userIds })
  });
  $('#projectOnsiteModal').close();
  toast(userIds.length ? '驻厂专员已派遣，可查看该客户项目' : '已取消该项目的驻厂派遣', 'success');
  await loadProjects();
}

function customerProjectEditorHtml(project = {}) {
  const status = Number(project.status || 2);
  return `<fieldset class="customer-project-editor" data-project-id="${project.id || ''}">
    <legend>${project.id ? `项目：${escapeHtml(project.projectName)}` : '新增项目'}</legend>
    <div class="form-grid">
      <label><span>项目名称</span><input name="projectName" value="${escapeHtml(project.projectName || '')}" required /></label>
      <label><span>厂区/用工地点</span><input name="worksiteName" value="${escapeHtml(project.worksiteName || '')}" /></label>
      <label><span>服务类型</span><select name="serviceType">
        <option value="2" ${Number(project.serviceType || 2) === 2 ? 'selected' : ''}>岗位外包</option>
        <option value="1" ${Number(project.serviceType) === 1 ? 'selected' : ''}>劳务派遣</option>
        <option value="3" ${Number(project.serviceType) === 3 ? 'selected' : ''}>灵活用工</option>
        <option value="4" ${Number(project.serviceType) === 4 ? 'selected' : ''}>RPO招聘</option>
      </select></label>
      <label><span>项目状态</span><select name="status">
        <option value="1" ${status === 1 ? 'selected' : ''}>筹备</option>
        <option value="2" ${status === 2 ? 'selected' : ''}>进行中</option>
        <option value="3" ${status === 3 ? 'selected' : ''}>暂停</option>
        <option value="4" ${status === 4 ? 'selected' : ''}>结束</option>
      </select></label>
    </div>
  </fieldset>`;
}

async function openClientManagement(customerId) {
  const data = await api(`/api/customers/${customerId}`);
  const form = $('#clientManageForm');
  form.reset();
  $('#clientManageId').value = customerId;
  $('#clientManageTitle').textContent = `${data.customer.customerName} · 客户项目管理`;
  form.customerName.value = data.customer.customerName || '';
  form.contactName.value = data.customer.contactName || '';
  form.contactPhone.value = data.customer.contactPhone || '';
  form.settlementCycle.value = data.customer.settlementCycle || '月结30天';
  form.address.value = data.customer.address || '';
  $('#customerProjectsEditor').innerHTML = (data.projects || []).map(customerProjectEditorHtml).join('')
    || customerProjectEditorHtml();
  $('#clientManageModal').showModal();
}

function collectCustomerProjects() {
  return [...$('#customerProjectsEditor').querySelectorAll('.customer-project-editor')].map(editor => ({
    id: Number(editor.dataset.projectId || 0) || undefined,
    projectName: editor.querySelector('[name="projectName"]').value,
    worksiteName: editor.querySelector('[name="worksiteName"]').value,
    serviceType: Number(editor.querySelector('[name="serviceType"]').value),
    status: Number(editor.querySelector('[name="status"]').value)
  }));
}

async function loadTalents() {
  setPanelLoading('#talentTableBody');
  try {
  state.talents = await api('/api/talents');
  $('#talentTableBody').innerHTML = state.talents.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.phone)}</small></td>
      <td>${badge(item.talentSourceTypeName, item.talentSourceType === 'RESIGNED' ? 'amber' : item.talentSourceType === 'UNJOINED' ? 'blue' : 'neutral')}</td>
      <td>${escapeHtml(item.customerName)}<small>${escapeHtml(item.projectName)}</small></td>
      <td>${escapeHtml(item.positionName)}<small>${escapeHtml(item.recruitmentChannelName)}</small></td>
      <td>${badge(item.employeeStatusName, Number(item.employeeStatus) === 2 ? 'green' : Number(item.employeeStatus) === 3 ? 'amber' : Number(item.employeeStatus) === 5 ? 'blue' : 'neutral')}</td>
      <td>${badge(item.followStatus, item.followStatus === '待入职' ? 'green' : 'blue')}</td>
      <td>${badge(item.availableStatusName, Number(item.availableStatus) === 3 ? 'green' : 'neutral')}</td>
      <td>${escapeHtml(item.flowedAt ? new Date(item.flowedAt).toLocaleString('zh-CN', { hour12: false }) : '-')}<small>${escapeHtml(item.resignationReason || '-')}</small></td>
      <td>${escapeHtml(item.ownerName)}</td>
    </tr>
  `).join('') || emptyRow(9, '暂无人才数据', '未入职和完成离职的员工会自动流转到这里，也可快速录入招聘线索');
  } finally { setPanelLoaded('#talentTableBody'); }
}

async function loadWorkTasks() {
  const status = $('#taskStatusFilter')?.value ?? '0';
  const risk = $('#taskRiskFilter')?.value || '';
  const query = new URLSearchParams();
  if (status !== '') query.set('taskStatus', status);
  if (risk) query.set('riskLevel', risk);
  state.workTasks = await api(`/api/work-tasks?${query.toString()}`);
  const pending = state.workTasks.filter(item => item.taskStatus === 0).length;
  const processing = state.workTasks.filter(item => item.taskStatus === 1).length;
  const overdue = state.workTasks.filter(item => item.overdue).length;
  const high = state.workTasks.filter(item => item.riskLevel === 3 && item.taskStatus < 2).length;
  $('#taskKpis').innerHTML = [['待处理', pending, 'warning'], ['处理中', processing, 'neutral'], ['已逾期', overdue, 'danger'], ['高风险', high, 'danger']]
    .map(([label, value, tone]) => `<article class="mini-kpi ${tone}"><span>${label}</span><strong>${value}</strong></article>`).join('');
  const statusNames = { 0: '待处理', 1: '处理中', 2: '已完成', 3: '已关闭' };
  const permissions = state.user?.permissions || [];
  const canManageOffboard = permissions.includes('employee:resign');
  const canHandleTransfer = permissions.includes('employee:transfer');
  const canUpdateTask = permissions.includes('employee:update');
  const canContract = permissions.includes('contract:manage');
  const canInsurance = permissions.includes('social:manage');
  const canCertificate = permissions.includes('cert:manage');
  const taskView = { INSURANCE: 'roster', INSURANCE_TERMINATION: 'roster', ARRIVAL: 'roster', CONTRACT: 'roster', ONBOARDING_COMPLIANCE: 'roster', DOCUMENT: 'roster', OFFBOARD: 'roster', TRANSFER_ACCEPTANCE: 'tasks' };
  $('#taskTableBody').innerHTML = state.workTasks.map(item => {
    const tone = item.riskLevel === 3 ? 'red' : item.riskLevel === 2 ? 'amber' : 'blue';
    const transferAction = item.taskType === 'TRANSFER_ACCEPTANCE' && canHandleTransfer
      ? `<button class="table-button" data-handle-transfer="${item.sourceId}" data-approved="1">接收</button> <button class="table-button danger" data-handle-transfer="${item.sourceId}" data-approved="0">拒绝</button>`
      : '';
    const offboardAction = item.taskType === 'OFFBOARD' && canManageOffboard
      ? `<button class="table-button" data-open-offboard="${item.employeeId}">打开离职办理</button>`
      : '';
    const businessAction = item.taskType === 'ONBOARDING_COMPLIANCE' && canContract && canInsurance
      ? `<button class="table-button primary" data-action="compliance" data-id="${item.employeeId}">一键确认办理</button>`
      : item.taskType === 'CONTRACT' && canContract
      ? `<button class="table-button primary" data-action="contract" data-id="${item.employeeId}">直接登记合同</button>`
      : item.taskType === 'INSURANCE' && canInsurance
        ? `<button class="table-button primary" data-action="social" data-id="${item.employeeId}" data-insurance-action="ADD">直接办理增保</button>`
        : item.taskType === 'INSURANCE_TERMINATION' && canManageOffboard
          ? `<button class="table-button primary" data-open-offboard="${item.employeeId}">确认已减保并离职</button>`
          : item.taskType === 'DOCUMENT' && canCertificate
            ? `<button class="table-button primary" data-action="certificate" data-id="${item.employeeId}">直接补资料</button>`
            : '';
    const genericAction = canUpdateTask
      ? (item.taskStatus === 0
          ? `<button class="table-button" data-start-task="${item.id}">开始处理</button>`
          : `<button class="table-button" data-view="${taskView[item.taskType] || 'roster'}">进入业务</button>${item.riskLevel < 3 ? ` <button class="table-button" data-complete-task="${item.id}">完成</button>` : ''}`)
      : '<span class="muted">等待有权限人员处理</span>';
    const action = item.taskStatus >= 2 ? '<span class="muted">已结束</span>'
      : transferAction || offboardAction || businessAction || genericAction;
    return `<tr><td>${badge(item.riskLevel === 3 ? '高' : item.riskLevel === 2 ? '中' : '低', tone)}${item.overdue ? '<small class="money-risk">已逾期</small>' : ''}</td><td><strong>${escapeHtml(item.taskTitle)}</strong><small>${escapeHtml(item.taskContent || item.taskTypeName)}</small></td><td>${escapeHtml(item.employeeName || '-')}<small>${escapeHtml(item.customerName || '-')} · ${escapeHtml(item.positionName || '-')}</small></td><td>${escapeHtml(item.assignedUserName)}</td><td>${item.deadline ? new Date(item.deadline).toLocaleString('zh-CN', { hour12: false }) : '-'}</td><td>${badge(statusNames[item.taskStatus], item.taskStatus === 2 ? 'green' : item.taskStatus === 1 ? 'blue' : 'amber')}</td><td>${action}</td></tr>`;
  }).join('') || emptyRow(7, '暂无待办', '员工入职、雇主险、转岗或离职后会自动生成');
}

async function loadRecruitmentSources() {
  const [channels, recruiters, suppliers] = await Promise.all([api('/api/recruitment-channels'), api('/api/recruiters'), api('/api/recruitment-suppliers')]);
  state.recruitmentChannels = channels;
  state.recruiters = recruiters;
  state.recruitmentSuppliers = suppliers;
  const enabledChannels = channels.filter(item => Number(item.status) === 1);
  const channelOptions = enabledChannels.map(item => `<option value="${escapeHtml(item.channelName)}">${escapeHtml(item.channelTypeName)}</option>`).join('');
  ['#desktopRecruitmentChannelOptions', '#mobileRecruitmentChannelOptions'].forEach(selector => { if ($(selector)) $(selector).innerHTML = channelOptions; });
  $('#channelRecruiterSelect').innerHTML = '<option value="">不关联</option>' + recruiters.filter(item => Number(item.status) === 1).map(item => `<option value="${item.id}">${item.recruiterName}</option>`).join('');
  $('#channelSupplierSelect').innerHTML = '<option value="">不关联</option>' + suppliers.filter(item => Number(item.status) === 1).map(item => `<option value="${item.id}">${item.supplierName}</option>`).join('');
  const totalEmployees = channels.reduce((sum, item) => sum + Number(item.employeeCount || 0), 0);
  $('#channelSummary').innerHTML = `<span>启用 <strong>${enabledChannels.length}</strong></span><span>归档员工 <strong>${totalEmployees}</strong></span>`;
  $('#channelTableBody').innerHTML = channels.map(item => {
    const related = item.recruiterName ? `招聘人｜${item.recruiterName}` : item.supplierName ? `供应商｜${item.supplierName}` : '未关联';
    return `<tr><td><strong>${escapeHtml(item.channelName)}</strong><small>${escapeHtml(item.remark || '自动归档渠道')}</small></td><td>${escapeHtml(item.channelTypeName)}<small>${escapeHtml(related)}</small></td><td><strong>${item.employeeCount} 人</strong><small>在职 ${item.activeEmployeeCount} · ${escapeHtml(item.employeeNames || '暂无员工')}</small></td><td><strong>${item.customerCount} 家</strong><small>${escapeHtml(item.customerNames || '暂无客户单位')}</small></td><td>${escapeHtml(item.feeModes || '-')}</td><td>${badge(item.status === 1 ? '启用' : '停用', item.status === 1 ? 'green' : 'amber')}</td><td><button class="table-button" data-view-channel-employees="${item.id}">关联明细</button> <button class="table-button" data-edit-channel="${item.id}">编辑</button></td></tr>`;
  }).join('') || emptyRow(7, '暂无招聘渠道', '新增员工时填写的渠道会自动沉淀到这里');
  $('#recruiterTableBody').innerHTML = recruiters.map(item => `<tr><td>${item.recruiterNo}</td><td><strong>${item.recruiterName}</strong></td><td>${item.phone || '-'}</td><td>${badge(item.status === 1 ? '启用' : '停用', item.status === 1 ? 'green' : 'amber')}</td><td><button class="table-button" data-edit-recruiter="${item.id}">编辑</button></td></tr>`).join('') || emptyRow(5, '暂无招聘人');
  $('#supplierTableBody').innerHTML = suppliers.map(item => {
    const expired = item.contractEndDate && item.contractEndDate < new Date().toISOString().slice(0, 10);
    return `<tr><td><strong>${item.supplierName}</strong><small>${item.supplierNo}</small></td><td>${item.contactName || '-'}<small>${item.contactPhone || '-'}</small></td><td>${item.contractStartDate || '-'} 至 ${item.contractEndDate || '-'}${expired ? '<small class="money-risk">合同已到期</small>' : ''}</td><td>${badge(item.riskLevel === 3 ? '高' : item.riskLevel === 2 ? '中' : '低', item.riskLevel === 3 ? 'red' : item.riskLevel === 2 ? 'amber' : 'green')}</td><td>${badge(item.status === 1 ? '启用' : '停用', item.status === 1 ? 'green' : 'amber')}</td><td><button class="table-button" data-edit-supplier="${item.id}">编辑</button></td></tr>`;
  }).join('') || emptyRow(6, '暂无供应商');
}

async function openChannelEmployees(channelId) {
  const data = await api(`/api/recruitment-channels/${channelId}/employees`);
  $('#channelEmployeesTitle').textContent = `${data.channelName} · 关联员工`;
  const active = data.rows.filter(item => Number(item.employeeStatus) === 2).length;
  const customers = new Set(data.rows.map(item => item.customerName).filter(Boolean)).size;
  const feeModes = new Set(data.rows.map(item => item.feeMode).filter(Boolean)).size;
  $('#channelEmployeesSummary').innerHTML = `<span>员工 <strong>${data.rows.length}</strong></span><span>在职 <strong>${active}</strong></span><span>客户单位 <strong>${customers}</strong></span><span>费用模式 <strong>${feeModes}</strong></span>`;
  const statusNames = { 1: '待入职', 2: '在职', 3: '离职', 4: '黑名单', 5: '未入职', 6: '面试' };
  $('#channelEmployeesBody').innerHTML = data.rows.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.customerName || '未分配')}</td><td>${escapeHtml(item.positionName || '-')}</td><td>${escapeHtml(item.feeMode || '-')}</td><td>${escapeHtml(item.hireDate || '-')}</td><td>${badge(statusNames[item.employeeStatus] || '未知', Number(item.employeeStatus) === 2 ? 'green' : Number(item.employeeStatus) === 1 ? 'amber' : 'neutral')}</td><td><button class="table-button" data-channel-employee-detail="${item.id}">查看员工</button></td></tr>`).join('') || emptyRow(7, '该渠道暂无权限范围内的关联员工');
  $('#channelEmployeesModal').showModal();
}

async function ensureRecruitmentChannelOptions() {
  if (!state.recruitmentChannels.length) state.recruitmentChannels = await api('/api/recruitment-channels');
  const options = state.recruitmentChannels.filter(item => Number(item.status) === 1)
    .map(item => `<option value="${item.channelName}">${item.channelTypeName || ''}</option>`).join('');
  ['#desktopRecruitmentChannelOptions', '#mobileRecruitmentChannelOptions'].forEach(selector => {
    if ($(selector)) $(selector).innerHTML = options;
  });
}

function openChannelModal(id = 0) {
  const form = $('#channelForm');
  form.reset();
  $('#channelModalTitle').textContent = id ? '编辑招聘渠道' : '新增招聘渠道';
  const item = state.recruitmentChannels.find(row => Number(row.id) === Number(id));
  if (item) Object.entries(item).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ''; });
  form.elements.id.value = id || '';
  $('#channelModal').showModal();
}

function openRecruiterModal(id = 0) {
  const form = $('#recruiterForm');
  form.reset();
  $('#recruiterModalTitle').textContent = id ? '编辑招聘人' : '新增招聘人';
  const item = state.recruiters.find(row => Number(row.id) === Number(id));
  if (item) Object.entries(item).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ''; });
  form.elements.id.value = id || '';
  $('#recruiterModal').showModal();
}

function openSupplierModal(id = 0) {
  const form = $('#supplierForm');
  form.reset();
  $('#supplierModalTitle').textContent = id ? '编辑供应商' : '新增供应商';
  const item = state.recruitmentSuppliers.find(row => Number(row.id) === Number(id));
  if (item) Object.entries(item).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ''; });
  form.elements.id.value = id || '';
  $('#supplierModal').showModal();
}

async function saveRecruitmentSource(form, type) {
  const body = formToObject(form);
  const id = Number(body.id || 0);
  delete body.id;
  const base = type === 'recruiter' ? '/api/recruiters' : type === 'supplier' ? '/api/recruitment-suppliers' : '/api/recruitment-channels';
  await api(id ? `${base}/${id}` : base, { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
  $(`#${type === 'recruiter' ? 'recruiterModal' : type === 'supplier' ? 'supplierModal' : 'channelModal'}`).close();
  clearCache('/api/bootstrap');
  await Promise.all([loadRecruitmentSources(), loadBootstrap()]);
  toast('招聘来源已保存', 'success');
}

async function loadAdvances() {
  setPanelLoading('#advanceTableBody');
  try {
  const result = await apiAllPages('/api/advances');
  const statusMap = { 1: ['PENDING_APPROVAL', '历史待审批'], 2: ['APPROVED', '历史待放款'], 3: ['REJECTED', '已驳回'], 4: ['PAID', '已登记'], 5: ['REPAID', '已扣回'], 6: ['CANCELLED', '已取消'] };
  state.advances = (result.list || result).map(item => ({
    ...item,
    advanceNo: item.advanceNo || item.applyNo,
    status: item.status || statusMap[item.advanceStatus]?.[0] || 'UNKNOWN',
    statusName: item.statusName || statusMap[item.advanceStatus]?.[1] || '未知',
    paidAmount: Number(item.paidAmount || (item.advanceStatus === 4 ? item.approvedAmount : 0) || 0),
    outstandingAmount: Number(item.outstandingAmount || 0),
    advanceAtText: String(item.advanceAt || '').replace('T', ' ').slice(0, 16) || '-',
    recordedByName: item.recordedByName || item.recordedByUsername || '-'
  }));
  const outstanding = state.advances.reduce((sum, item) => sum + item.outstandingAmount, 0);
  const today = localDateTimeInputValue().slice(0, 10);
  const todayRows = state.advances.filter(item => String(item.advanceAt || '').slice(0, 10) === today && [4, 5].includes(Number(item.advanceStatus)));
  const paid = state.advances.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
  $('#advanceKpis').innerHTML = [
    ['今日登记', todayRows.length, 'neutral'], ['累计预支', money(paid), 'neutral'], ['未结余额', money(outstanding), 'danger']
  ].map(([label, value, tone]) => `<article class="mini-kpi ${tone}"><span>${label}</span><strong>${value}</strong></article>`).join('');
  const canApprove = (state.user?.permissions || []).includes('advance:approve');
  const canPay = (state.user?.permissions || []).includes('advance:pay');
  $('#advanceTableBody').innerHTML = state.advances.map(item => {
    const actions = item.status === 'PENDING_APPROVAL' && canApprove
      ? `<button class="table-button" data-action="approve-advance" data-id="${item.id}">审批通过</button>`
      : item.status === 'APPROVED' && canPay ? `<button class="table-button" data-action="pay-advance" data-id="${item.id}">登记放款</button>` : '-';
    return `<tr><td><strong>${escapeHtml(item.advanceAtText)}</strong><small>${escapeHtml(item.advanceNo)}</small></td><td><strong>${escapeHtml(item.employeeName)}</strong></td><td><strong>${escapeHtml(item.customerName || '-')}</strong><small>${escapeHtml(item.projectName || '暂未关联具体项目')}</small></td><td><strong>${money(item.applyAmount)}</strong></td><td>${escapeHtml(item.applyReason || '-')}</td><td>${escapeHtml(item.recordedByName)}</td><td><strong class="money-risk">${money(item.outstandingAmount)}</strong></td><td>${badge(item.statusName, item.status === 'PENDING_APPROVAL' ? 'amber' : item.status === 'REJECTED' ? 'red' : 'green')}</td><td>${actions}</td></tr>`;
  }).join('');
  $('#advanceEmployeeSelect').innerHTML = activeEmployeeOptionHtml();
  } finally { setPanelLoaded('#advanceTableBody'); }
}

async function submitSimpleForm(form, path, successMessage, modalId, reload) {
  await api(path, { method: 'POST', body: JSON.stringify(formToObject(form)) });
  $(`#${modalId}`).close();
  form.reset();
  toast(successMessage);
  await reload();
  await loadSummary();
}

async function approveAdvance(id) {
  const advance = state.advances.find(item => Number(item.id) === Number(id));
  await api(`/api/advances/${id}/approve`, { method: 'PUT', body: JSON.stringify({ status: 2, approvedAmount: advance?.applyAmount || 0 }) });
  toast('预支审批通过，已进入待放款');
  await loadAdvances();
}

async function payAdvance(id) {
  await api(`/api/advances/${id}/pay`, { method: 'PUT', body: '{}' });
  toast('放款已登记，系统已形成未结余额');
  await Promise.all([loadAdvances(), loadSummary()]);
}

const officeEmployeeActions = [
  ['人员录入', '新增员工档案', '＋', 'blue', 'employee-create'],
  ['人员安排', '客户与项目分配', '排', 'cyan', 'employee-arrange'],
  ['我的员工', '在职员工档案', '人', 'green', 'employees'],
  ['人才库', '候选人与离职回流', '才', 'gold', 'talents'],
  ['黑名单', '风险人员管控', '禁', 'charcoal', 'blacklist'],
  ['员工统计', '结构与流动分析', '统', 'orange', 'dashboard'],
  ['用工记录', '入职调动历史', '录', 'cyan', 'employment-records'],
  ['离职申请', '结算与雇主险减保', '离', 'blue', 'offboarding'],
  ['员工反馈', '考勤与工资异议', '言', 'gold', 'feedback']
];

const officeFinanceActions = [
  ['登记预支', '记录时间、金额和用途', '记', 'blue', 'advance-create'],
  ['预支台账', '按客户查看现场记录', '账', 'cyan', 'advances'],
  ['未结查询', '核对待扣回余额', '余', 'green', 'advances'],
  ['还款管理', '工资扣回与还款', '还', 'blue', 'advances'],
  ['预支统计', '项目预支趋势', '统', 'gold', 'advances'],
  ['工资发放', '批次、工资条与签收', '薪', 'orange', 'payroll']
];

const officeActionPermissions = {
  'employee-create': ['employee:create'],
  'employee-arrange': ['project:view'],
  employees: ['employee:view'],
  talents: ['talent:menu'],
  blacklist: ['blacklist:view', 'blacklist:menu'],
  dashboard: ['dashboard:menu'],
  'employment-records': ['employee:view'],
  offboarding: ['employee:resign'],
  feedback: ['employee:view'],
  'advance-create': ['advance:create'],
  advances: ['advance:view'],
  payroll: ['payroll:view'],
  projects: ['project:view'],
  risk: ['risk:view'],
  'payroll-create': ['payroll:manage']
};

function canRunOfficeAction(action) {
  const isCompanyAdmin = (state.user?.roles || []).some(role => role.roleCode === 'company_admin');
  if (isCompanyAdmin) return true;
  const required = officeActionPermissions[action];
  if (!required?.length) return false;
  const permissions = state.user?.permissions || [];
  return required.some(permission => permissions.includes(permission));
}

function renderOfficeActions(target, rows) {
  $(target).innerHTML = rows
    .filter(([, , , , action]) => canRunOfficeAction(action))
    .map(([title, note, icon, tone, action]) => `
    <button class="office-action" type="button" data-office-action="${action}"><span class="office-icon ${tone}">${icon}</span><span><strong>${title}</strong><small>${note}</small></span></button>
  `).join('');
}

async function loadOffice() {
  setPanelLoading('#officeView');
  try {
  const data = await api('/api/operations/home');
  let notices = Array.isArray(data.notices) ? data.notices : [];
  try {
    const noticeResult = await api('/api/notices');
    notices = Array.isArray(noticeResult) ? noticeResult : (noticeResult?.list || notices);
  } catch (error) {
    // 兼容尚未提供独立公告接口的旧环境，办公中心仍可正常使用。
    if (!/接口不存在|404/.test(String(error?.message || ''))) throw error;
  }
  const workforce = data.workforce || {};
  const finance = data.finance || {};
  const delivery = data.delivery || {};
  const compliance = data.compliance || {};
  const todos = Array.isArray(data.todos) ? data.todos.filter(item => Number(item.count || 0) > 0) : [];
  const hourPart = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date()).find(part => part.type === 'hour');
  const currentHour = Number(hourPart?.value || 0);
  const greeting = currentHour >= 5 && currentHour < 12
    ? '上午好'
    : currentHour >= 12 && currentHour < 18
      ? '下午好'
      : '晚上好';
  const displayName = state.user?.realName || state.user?.username || '同事';
  $('#officeGreeting').textContent = `${greeting}，${displayName}`;
  $('#officeDate').textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  $('#officeStatline').innerHTML = [
    ['用工总数', workforce.total || 0], ['在职人数', workforce.active || 0], ['离职人数', workforce.left || 0], ['人才储备', workforce.talents || 0], ['预支未结', money(finance.advanceOutstanding || 0)]
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');
  const pulseRows = (rows) => rows.map(([label, value, tone = '']) => `<span class="pulse-row ${tone}"><i>${label}</i><b>${value}</b></span>`).join('');
  const pulseCard = (heroLabel, heroValue, heroTone, rows) => `
    <div class="pulse-hero ${heroTone}"><span>${heroLabel}</span><strong>${heroValue}</strong></div>
    <div class="pulse-stats-list">${pulseRows(rows)}</div>
  `;
  const complianceUrgent = (compliance.pendingContracts || 0) + (compliance.pendingInsurance || 0);
  $('#projectDeliveryPulse').innerHTML = pulseCard(
    '在营项目', delivery.activeProjects || 0, delivery.activeProjects ? 'good' : 'warning',
    [
      ['当前在岗', delivery.onsiteEmployees || 0],
      ['人才储备', workforce.talents || 0],
      ['预支未结', money(finance.advanceOutstanding || 0)]
    ]
  );
  $('#complianceQueuePulse').innerHTML = pulseCard(
    '合规紧急项', complianceUrgent, complianceUrgent ? 'danger' : 'good',
    [
      ['合同待处理', compliance.pendingContracts || 0, compliance.pendingContracts ? 'danger' : 'good'],
      ['雇主险待增', compliance.pendingInsurance || 0, compliance.pendingInsurance ? 'danger' : 'good'],
      ['工资条待签', compliance.unsignedPayslips || 0, compliance.unsignedPayslips ? 'warning' : 'good']
    ]
  );
  renderOfficeActions('#employeeOfficeGrid', officeEmployeeActions);
  renderOfficeActions('#financeOfficeGrid', officeFinanceActions);
  $('#todoTotal').textContent = todos.reduce((sum, item) => sum + Number(item.count || 0), 0);
  $('#officeTodos').innerHTML = todos.length
    ? todos.map(item => `<button type="button" data-view="${item.view}" data-todo-id="${escapeHtml(item.id)}" class="todo-item ${item.tone}"><span>${item.title}</span><strong>${item.count}</strong><small>立即处理 →</small></button>`).join('')
    : '<div class="empty-state compact"><h3>今日待办已清空</h3><p>新增员工、到岗、转岗和离职后会自动生成事项。</p></div>';
  $('#officeNotices').innerHTML = notices.length
    ? notices.map(item => item.targetView
      ? `<button type="button" class="office-notice-item" data-notice-view="${escapeHtml(item.targetView)}"><span>${escapeHtml(item.category)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.time)}</small></button>`
      : `<article><span>${escapeHtml(item.category)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.time)}</small></article>`).join('')
    : '<article><span>系统通知</span><strong>暂无新的业务消息</strong><small>业务操作后将自动生成</small></article>';
  } finally { setPanelLoaded('#officeView'); }
}

async function loadPayroll() {
  setPanelLoading('#payrollTableBody');
  try {
  const data = await api('/api/payroll/overview');
  $('#payrollKpis').innerHTML = [
    ['累计应发', money(data.grossTotal), 'neutral'], ['累计实发', money(data.netTotal), 'good'], ['工资条待签收', data.unsignedTotal, 'danger']
  ].map(([label, value, tone]) => `<article class="mini-kpi ${tone}"><span>${label}</span><strong>${value}</strong></article>`).join('');
  $('#payrollTableBody').innerHTML = data.batches.map(item => {
    const permissions = state.user?.permissions || [];
    const canManage = permissions.includes('payroll:manage');
    const canReview = permissions.includes('payroll:review');
    let action = '<span class="muted">等待下一环节</span>';
    if (item.status === 'PUBLISHED') action = '<span class="muted">已发布</span>';
    else if (Number(item.batchStatus) === 1 && canManage) action = `<button class="table-button" type="button" data-submit-payroll="${item.id}">提交复核</button>`;
    else if (Number(item.batchStatus) === 3 && canReview) action = `<button class="table-button" type="button" data-review-payroll="${item.id}" data-approved="1">复核通过</button> <button class="table-button" type="button" data-review-payroll="${item.id}" data-approved="0">退回</button>`;
    else if (Number(item.batchStatus) === 4 && canManage) action = `<button class="table-button" type="button" data-publish-payroll="${item.id}">发布工资条</button>`;
    return `<tr><td><strong>${item.salaryMonth}</strong></td><td>${item.batchNo}</td><td>${item.projectName}</td><td>${item.employeeCount}</td><td>${money(item.grossTotal)}</td><td>${money(item.advanceDeduction)}</td><td><strong>${money(item.netTotal)}</strong></td><td>${badge(item.unsignedCount, item.unsignedCount ? 'amber' : 'green')}</td><td>${badge(item.statusName, item.status === 'PUBLISHED' ? 'green' : 'blue')}</td><td>${action}</td></tr>`;
  }).join('') || emptyRow(10, '暂无工资批次', '点击“创建工资批次”录入本月工资');
  } finally { setPanelLoaded('#payrollTableBody'); }
}

async function submitPayrollBatch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const columns = [
    'employeeNo', 'baseSalary', 'positionSalary', 'performanceSalary', 'allowanceAmount',
    'pieceAmount', 'overtime15Amount', 'overtime20Amount', 'overtime30Amount',
    'socialDeduction', 'taxDeduction', 'advanceDeduction', 'otherDeduction'
  ];
  const rows = parseBatchTable(form.elements.tableData.value, columns, '工号');
  const data = await api('/api/payroll/batches', {
    method: 'POST',
    body: JSON.stringify({
      projectId: Number(form.projectId.value),
      salaryMonth: form.salaryMonth.value,
      payrollType: 3,
      rows
    })
  });
  $('#payrollBatchResult').classList.remove('hidden');
  $('#payrollBatchResult').innerHTML = `<strong>工资批次 ${escapeHtml(data.batchNo)} 创建成功，共 ${data.employeeCount} 人。</strong>`;
  await Promise.all([loadPayroll(), loadOffice()]);
  window.setTimeout(() => {
    $('#payrollBatchModal').close();
    form.reset();
  }, 900);
}

async function loadBlacklist() {
  setPanelLoading('#blacklistTableBody');
  try {
  const keyword = encodeURIComponent($('#blacklistKeyword').value || '');
  const result = await api(`/api/blacklist${keyword ? `?keyword=${keyword}` : ''}`);
  const riskNames = { 1: '低', 2: '中', 3: '高' };
  const rows = (result.list || result).map(item => ({
    ...item,
    name: item.name || item.personName,
    idCardMasked: item.idCardMasked || item.idCardNo,
    riskLevel: typeof item.riskLevel === 'number' ? riskNames[item.riskLevel] : item.riskLevel,
    reason: item.reason || item.blacklistReason,
    source: item.source || item.sourceProjectName || '公司录入',
    createdBy: item.createdBy || item.createdByName || '企业管理员'
  }));
  $('#blacklistTableBody').innerHTML = rows.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.idCardMasked)}</td><td>${badge(item.riskLevel, item.riskLevel === '高' ? 'red' : item.riskLevel === '中' ? 'amber' : 'blue')}</td><td class="reason-cell">${escapeHtml(item.reason)}${item.remark ? `<small>${escapeHtml(item.remark)}</small>` : ''}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.phone || '-')}</td><td>${escapeHtml(item.createdBy)}<small>${new Date(item.createdAt).toLocaleDateString('zh-CN')}</small></td><td>${badge(item.status === 1 ? '生效中' : '已解除', item.status === 1 ? 'red' : 'green')}</td></tr>`  ).join('') || emptyRow(8, '暂无黑名单记录', '点击"录入黑名单"或"批量录入"添加风险人员');
  } finally { setPanelLoaded('#blacklistTableBody'); }
}

let _permRoles = [], _permProjects = [], _permTree = [], _permDepartments = [];

async function loadPermissions() {
  setPanelLoading('#permissionUserTableBody');
  try {
    const [users, roles, projects, permTree, departments] = await Promise.all([
      api('/api/system/users'),
      api('/api/system/roles'),
      api('/api/system/projects'),
      api('/api/system/permissions'),
      api('/api/system/departments')
    ]);
    _permRoles = roles;
    _permProjects = projects;
    _permTree = permTree;
    _permDepartments = departments;

    /* 渲染角色卡片 */
    $('#permissionRoleCards').innerHTML = roles.map((role, index) => {
      const permCount = role.permissions?.length || 0;
      const scopeBadge = role.dataScope === 1 ? '全公司' : (role.dataScopeName || '自定义');
      const statusBadge = role.status === 1 ? '' : badge('停用', 'amber');
      return `<article class="role-card" data-role-id="${role.id}"><div class="role-number">0${index + 1}</div><div><span>${role.roleCode}</span><h3>${role.roleName}</h3><p>${role.permissions?.map(p => p.permName).join(' · ') || '无权限'}</p><div><strong>${role.userCount}个账号</strong>${badge(scopeBadge, role.dataScope === 1 ? 'green' : 'blue')}${statusBadge}</div></div></article>`;
    }).join('');

    /* 渲染用户表格 */
    $('#permissionUserTableBody').innerHTML = users.length ? users.map(user => {
      const roleBadges = (user.roles || []).map(r => badge(r.roleName, 'blue')).join(' ');
      const projText = renderUserProjects(user.projects);
      return `<tr><td><strong>${user.realName}</strong><small>${user.username}</small></td><td>${user.mobile || '-'}</td><td>${roleBadges}</td><td>${projText}</td><td>${badge(user.status === 1 ? '启用' : '停用', user.status === 1 ? 'green' : 'amber')}</td><td><div class="row-actions"><button class="link-button" data-edit-user="${user.id}">编辑</button><button class="link-button" data-reset-pwd="${user.id}" data-username="${user.realName}">重置密码</button>${user.status === 1 ? `<button class="link-button danger" data-toggle-user="${user.id}" data-status="0">停用</button>` : `<button class="link-button" data-toggle-user="${user.id}" data-status="1">启用</button>`}</div></td></tr>`;
    }).join('') : emptyRow(6, '暂无系统账号', '点击"新增账号"创建');

    /* 渲染角色配置区域 */
    $('#roleConfigArea').innerHTML = roles.map(role => `<div class="role-config-item"><div class="role-config-head"><h4>${role.roleName}</h4>${badge(role.roleCode, 'blue')}${role.status === 1 ? '' : badge('停用', 'amber')}</div><p class="muted">${role.permissions?.length || 0}项权限 · ${role.userCount}个账号</p><button class="secondary-button" data-config-role="${role.id}">配置权限</button></div>`).join('');
  } finally { setPanelLoaded('#permissionUserTableBody'); }
}

/* 用户已授权项目按客户分组展示 */
function renderUserProjects(projects) {
  if (!projects || !projects.length) return '<span class="muted">全部项目</span>';
  const byCustomer = {};
  for (const p of projects) {
    const customer = p.customerName || '未关联客户';
    if (!byCustomer[customer]) byCustomer[customer] = [];
    byCustomer[customer].push(p.projectName);
  }
  return Object.entries(byCustomer).map(([cust, names]) =>
    `<div class="proj-customer-group"><strong>${escapeHtml(cust)}</strong><span>${names.map(escapeHtml).join('、')}</span></div>`
  ).join('');
}

/* 渲染复选框组 */
function renderCheckboxGroup(items, name, selectedIds = []) {
  return items.map(item => `<label class="checkbox-item"><input type="checkbox" name="${name}" value="${item.id}" ${selectedIds.includes(item.id) ? 'checked' : ''} /><span>${item.deptName || item.projectName || item.permName || item.name || item.label}</span></label>`).join('');
}

/* 渲染权限树复选框 */
function renderPermTree(tree, selectedCodes = [], disabled = false) {
  return tree.map(node => {
    const childHtml = node.children?.length ? `<div class="perm-children">${renderPermTree(node.children, selectedCodes, disabled)}</div>` : '';
    return `<div class="perm-tree-node"><label class="checkbox-item"><input type="checkbox" name="permId" value="${node.id}" data-code="${node.permCode}" ${selectedCodes.includes(node.permCode) ? 'checked' : ''} ${disabled ? 'disabled' : ''} /><span>${node.permName}</span></label>${childHtml}</div>`;
  }).join('');
}

function collectPermissionCodes(tree) {
  return tree.flatMap(node => [node.permCode, ...collectPermissionCodes(node.children || [])]).filter(Boolean);
}

function syncPermissionTreeSelection(checkbox) {
  const node = checkbox.closest('.perm-tree-node');
  if (!node) return;
  node.querySelectorAll('.perm-children input[name="permId"]').forEach(child => {
    child.checked = checkbox.checked;
  });
  if (checkbox.checked) {
    let parentNode = node.parentElement?.closest('.perm-tree-node');
    while (parentNode) {
      const parentCheckbox = parentNode.querySelector(':scope > label input[name="permId"]');
      if (parentCheckbox) parentCheckbox.checked = true;
      parentNode = parentNode.parentElement?.closest('.perm-tree-node');
    }
  }
}

function updateRolePermissionCount() {
  const inputs = [...$('#rolePermissionTree').querySelectorAll('input[name="permId"]')];
  const selectedCount = inputs.filter(input => input.checked).length;
  $('#rolePermissionCount').textContent = `已选择 ${selectedCount} / ${inputs.length} 项`;
}

function filterRolePermissionTree(keyword) {
  const normalized = String(keyword || '').trim().toLowerCase();
  const visit = node => {
    const directLabel = node.querySelector(':scope > .checkbox-item');
    const ownMatch = !normalized || String(directLabel?.textContent || '').toLowerCase().includes(normalized);
    const childContainer = node.querySelector(':scope > .perm-children');
    const children = childContainer ? [...childContainer.children].filter(child => child.classList.contains('perm-tree-node')) : [];
    const childMatch = children.map(visit).some(Boolean);
    const visible = ownMatch || childMatch;
    node.classList.toggle('permission-filter-hidden', !visible);
    return visible;
  };
  [...$('#rolePermissionTree').children]
    .filter(node => node.classList.contains('perm-tree-node'))
    .forEach(visit);
}

/* 渲染项目按客户单位分组 */
function renderProjectsByCustomer(projects) {
  if (!projects || !projects.length) return '<p class="muted">暂无项目</p>';
  const groups = {};
  for (const p of projects) {
    const cust = p.customerName || '未关联客户';
    if (!groups[cust]) groups[cust] = [];
    groups[cust].push(p);
  }
  return Object.entries(groups).map(([cust, list]) => `
    <div class="proj-group">
      <div class="proj-group-head"><strong>${escapeHtml(cust)}</strong><span>${list.length}个项目</span></div>
      <div class="proj-group-items">
        ${list.map(p => `<label class="checkbox-item"><input type="checkbox" name="projectIds" value="${p.id}" /><span>${escapeHtml(p.projectName)}</span><small>${escapeHtml(p.projectCode || '')}</small></label>`).join('')}
      </div>
    </div>
  `).join('');
}

/* 打开新增/编辑账号弹窗 */
async function openPermissionUserModal(userId) {
  const isEdit = !!userId;
  $('#permissionUserModalTitle').textContent = isEdit ? '编辑账号' : '新增账号';
  $('#permissionUserModalEyebrow').textContent = isEdit ? '编辑系统账号' : '权限管理';
  $('#permissionUserSubmit').textContent = isEdit ? '保存修改' : '创建账号';
  $('#permissionUserId').value = userId || '';

  /* 渲染角色复选框（全部角色可选） */
  $('#permissionRoleCheckboxes').innerHTML = renderCheckboxGroup(
    _permRoles.map(r => ({ id: r.id, label: `${r.roleName} (${r.roleCode})` })),
    'roleIds'
  );

  /* 渲染项目复选框（按客户单位分组） */
  $('#permissionProjectCheckboxes').innerHTML = renderProjectsByCustomer(_permProjects);

  /* 密码字段：编辑时隐藏 */
  $('#passwordLabel').classList.toggle('hidden', isEdit);
  $('#permissionPassword').required = !isEdit;

  /* 编辑模式：加载用户数据 */
  if (isEdit) {
    try {
      const detail = await api(`/api/system/users/${userId}`);
      const form = $('#permissionUserForm');
      form.realName.value = detail.realName || '';
      form.username.value = detail.username || '';
      form.phone.value = detail.phone || '';
      $('#permissionUsername').readOnly = true;
      /* 勾选角色 */
      [...form.querySelectorAll('input[name="roleIds"]')].forEach(cb => {
        cb.checked = (detail.roles || []).some(r => r.id === Number(cb.value));
      });
      /* 勾选项目 */
      [...form.querySelectorAll('input[name="projectIds"]')].forEach(cb => {
        cb.checked = (detail.projects || []).some(p => p.id === Number(cb.value));
      });
    } catch (error) { toast(error.message, 'error'); }
  } else {
    $('#permissionUserForm').reset();
    $('#permissionUsername').readOnly = false;
  }

  $('#permissionUserModal').showModal();
}

/* 打开角色权限配置弹窗 */
function openRolePermissionModal(roleId) {
  const role = _permRoles.find(r => r.id === Number(roleId));
  if (!role) return;
  const locked = role.roleCode === 'company_admin';
  $('#rolePermissionTitle').textContent = `${role.roleName} 权限配置`;
  $('#rolePermissionRoleId').value = roleId;
  const selectedCodes = locked ? collectPermissionCodes(_permTree) : (role.permissions || []).map(p => p.permCode);
  $('#rolePermissionTree').innerHTML = renderPermTree(_permTree, selectedCodes, locked);
  $('#rolePermissionSearch').value = '';
  $('#rolePermissionSelectAll').disabled = locked;
  $('#rolePermissionClearAll').disabled = locked;
  filterRolePermissionTree('');
  updateRolePermissionCount();
  $('#rolePermissionHint').textContent = locked
    ? '企业管理员固定拥有全部有效权限，为防止系统失去管理入口，不允许取消权限。'
    : '勾选功能权限时会自动包含对应菜单；保存后相关账号需重新登录才能加载新权限。';
  $('#rolePermissionSubmit').disabled = locked;
  $('#rolePermissionSubmit').textContent = locked ? '企业管理员全权限' : '保存配置';
  const departmentSection = $('#roleDepartmentSection');
  departmentSection.classList.toggle('hidden', ![2, 3].includes(Number(role.dataScope)));
  $('#roleDepartmentCheckboxes').innerHTML = renderCheckboxGroup(
    _permDepartments,
    'deptId',
    (role.departments || []).map(item => Number(item.id))
  ) || '<p class="muted">暂无可授权部门</p>';
  $('#rolePermissionModal').showModal();
}

function runOfficeAction(action) {
  if (!canRunOfficeAction(action)) {
    toast('当前账号没有此功能权限', 'error');
    return;
  }
  if (action === 'employee-create') return openEmployeeModal().catch(error => toast(error.message));
  if (action === 'advance-create') {
    return prepareAdvanceForm().catch(error => toast(error.message));
  }
  if (action === 'employee-arrange') return switchView('projects');
  if (action === 'employees') return switchView('roster');
  if (action === 'talents') return switchView('talents');
  if (action === 'dashboard') return switchView('dashboard');
  if (action === 'projects') return switchView('projects');
  if (action === 'risk') return switchView('risk');
  if (action === 'advances') return switchView('advances');
  if (action === 'payroll') return switchView('payroll');
  if (action === 'blacklist') return switchView('blacklist');
  if (action === 'offboarding') {
    switchView('roster');
    toast('请选择员工后办理离职');
    return;
  }
  if (action === 'employment-records') {
    switchView('roster');
    toast('员工详情中可查看完整用工记录');
    return;
  }
  if (action === 'feedback') {
    switchView('roster');
    toast('员工反馈已进入待办中心');
    return;
  }
  if (action === 'payroll-create') {
    return loadProjects().then(() => {
      $('#payrollProjectSelect').innerHTML = optionHtml(state.projects, 'id', 'projectName');
      const form = $('#payrollBatchForm');
      form.reset();
      $('#payrollBatchResult').classList.add('hidden');
      $('#payrollBatchModal').showModal();
    }).catch(error => toast(error.message, 'error'));
  }
}

async function refreshAll() {
  const permissions = state.user?.permissions || [];
  const isCompanyAdmin = (state.user?.roles || []).some(role => role.roleCode === 'company_admin');
  const tasks = [loadSummary(), loadEmployees()];
  if (isCompanyAdmin || permissions.includes('risk:view')) tasks.push(loadRisks());
  await Promise.all(tasks);
}

async function refreshEmployeeWorkspace() {
  await Promise.all([refreshAll(), loadOffice()]);
}

function bindMetricRiskNavigation() {
  const unresolvedMetric = $('#unresolvedRiskTotal').closest('.metric-cell');
  const unsignedMetric = $('#unsignedTotal').closest('.metric-cell');
  const openRiskCenter = preset => {
    if (!canRunOfficeAction('risk')) {
      toast('当前账号没有查看用工风险的权限', 'error');
      return;
    }
    state.selectedRiskProjectId = null;
    $('#riskKeywordInput').value = '';
    switchView('risk');
    window.setTimeout(() => applyRiskPreset(preset), 0);
  };
  unresolvedMetric.addEventListener('click', () => openRiskCenter('open'));
  unsignedMetric.addEventListener('click', () => openRiskCenter('contract'));
  for (const metric of [unresolvedMetric, unsignedMetric]) {
    metric.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      metric.click();
    });
  }
}

function configureMetricRiskAccess() {
  const allowed = canRunOfficeAction('risk');
  const metrics = [$('#unresolvedRiskTotal')?.closest('.metric-cell'), $('#unsignedTotal')?.closest('.metric-cell')].filter(Boolean);
  for (const metric of metrics) {
    metric.classList.toggle('metric-action', allowed);
    metric.setAttribute('aria-disabled', allowed ? 'false' : 'true');
    if (allowed) {
      metric.setAttribute('role', 'button');
      metric.setAttribute('tabindex', '0');
    } else {
      metric.removeAttribute('role');
      metric.removeAttribute('tabindex');
    }
  }
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', event => login(event).catch(error => toast(error.message, 'error')));
  $('#loginForm').addEventListener('input', () => setLoginError(''));
  $('#logoutButton').addEventListener('click', () => logout(true));
  $('#changePasswordButton').addEventListener('click', () => {
    $('#passwordForm').reset();
    $('#passwordModal').showModal();
  });
  $('#exportLink').addEventListener('click', event => exportEmployees(event).catch(error => toast(error.message)));
  $('#exportXlsxLink').addEventListener('click', event => exportEmployees(event, 'xlsx').catch(error => toast(error.message)));

  $('#filterForm').addEventListener('submit', event => {
    event.preventDefault();
    loadEmployees().catch(error => toast(error.message, 'error'));
  });

  /* 关键词搜索防抖 */
  const debouncedSearch = debounce(() => {
    loadEmployees().catch(error => toast(error.message, 'error'));
  }, 400);
  $('#keywordInput').addEventListener('input', debouncedSearch);

  /* Ctrl+K 快捷搜索 */
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      const input = $('#keywordInput');
      if (input) { input.focus(); input.select(); }
    }
    if (event.key === 'Escape') {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
    }
  });

  /* 全局未捕获错误处理 */
  window.addEventListener('unhandledrejection', event => {
    console.error('Unhandled rejection:', event.reason);
    if (event.reason?.message) toast(event.reason.message, 'error');
  });

  $('#createEmployeeButton').addEventListener('click', () => {
    openEmployeeModal().catch(error => toast(error.message));
  });
  $('#batchEmployeeButton').addEventListener('click', () => {
    $('#batchEmployeeForm').reset();
    $('#batchEmployeeResult').classList.add('hidden');
    $('#batchEmployeeModal').showModal();
  });
  $('#quickAddEmployee').addEventListener('click', () => {
    openEmployeeModal().catch(error => toast(error.message));
  });
  $('#quickBatchEmployee').addEventListener('click', () => {
    $('#batchEmployeeForm').reset();
    $('#batchEmployeeResult').classList.add('hidden');
    $('#batchEmployeeModal').showModal();
  });
  $('#employeeTemplateButton').addEventListener('click', () => downloadCsvTemplate(
    '员工批量录入模板.csv',
    ['姓名', '性别', '学历', '身份证号码', '地址', '电话', '工作单位', '所属项目', '岗位', '工资类型', '入职日期', '用工模式', '费用模式', '招聘渠道', '备注', '开户行', '银行卡号', '紧急联系人', '紧急电话', '录入状态'],
    ['张三', '男', '大专', '410xxxxxxxxxxxxxxx', '13800138000', '某制造公司', '一厂项目', '装配工', '计时', '2026-07-30', '派遣', '', '内部推荐', '', '工商银行常州分行', '6212xxxxxxxxxxxx', '李四', '13900139000', '待入职']
  ));
  $('#employeeXlsxTemplateButton').addEventListener('click', () => downloadXlsxTemplate(
    '员工批量录入模板.xlsx',
    ['姓名', '性别', '学历', '身份证号码', '地址', '电话', '工作单位', '所属项目', '岗位', '工资类型', '入职日期', '用工模式', '费用模式', '招聘渠道', '备注', '开户行', '银行卡号', '紧急联系人', '紧急电话', '录入状态'],
    ['张三', '男', '大专', '410xxxxxxxxxxxxxxx', '13800138000', '某制造公司', '一厂项目', '装配工', '计时', '2026-07-30', '派遣', '', '内部推荐', '', '工商银行常州分行', '6212xxxxxxxxxxxx', '李四', '13900139000', '待入职']
  ));
  bindBatchFileZone('employeeFileZone', 'employeeFileInput', 'batchEmployeeForm', 'employeeFileName',
    ['姓名', '性别', '学历', '身份证号码', '地址', '电话', '工作单位', '所属项目', '岗位', '工资类型', '入职日期', '用工模式', '费用模式', '招聘渠道', '备注', '开户行', '银行卡号', '紧急联系人', '紧急电话', '录入状态']);
  bindMetricRiskNavigation();
  $('#scanRiskButton').addEventListener('click', () => scanRisks().catch(error => toast(error.message)));
  $('#riskCenterScanButton').addEventListener('click', () => scanRisks().catch(error => toast(error.message)));
  $('#riskRefreshButton').addEventListener('click', () => loadRiskCenter().catch(error => toast(error.message)));
  $('#riskComplianceFilter').addEventListener('change', renderRiskCenter);
  $('#riskKeywordInput').addEventListener('input', debounce(() => {
    state.selectedRiskProjectId = null;
    renderRiskCenter();
  }, 250));
  $('#riskCaseForm').elements.status.addEventListener('change', updateRiskStatusHelp);
  $('#auditRefreshButton').addEventListener('click', () => loadAuditLogs().catch(error => toast(error.message)));
  $('#createClientButton').addEventListener('click', () => {
    $('#clientForm').reset();
    $('#clientModal').showModal();
  });
  $('#addCustomerProjectButton').addEventListener('click', () => {
    $('#customerProjectsEditor').insertAdjacentHTML('beforeend', customerProjectEditorHtml());
  });
  $('#createTalentButton').addEventListener('click', () => $('#talentModal').showModal());
  $('#createAdvanceButton').addEventListener('click', () => prepareAdvanceForm().catch(error => toast(error.message)));
  $('#advanceEmployeeSelect').addEventListener('change', syncAdvanceCustomerFromEmployee);
  $('#advanceCustomerSelect').addEventListener('change', populateAdvanceProjectOptions);
  $('#createBlacklistButton').addEventListener('click', () => {
    $('#blacklistForm').reset();
    $('#blacklistModal').showModal();
  });
  $('#batchBlacklistButton').addEventListener('click', () => {
    $('#batchBlacklistForm').reset();
    $('#batchBlacklistResult').classList.add('hidden');
    $('#batchBlacklistModal').showModal();
  });
  $('#quickAddBlacklist').addEventListener('click', () => {
    $('#blacklistForm').reset();
    $('#blacklistModal').showModal();
  });
  $('#quickBatchBlacklist').addEventListener('click', () => {
    $('#batchBlacklistForm').reset();
    $('#batchBlacklistResult').classList.add('hidden');
    $('#batchBlacklistModal').showModal();
  });
  $('#blacklistTemplateButton').addEventListener('click', () => downloadCsvTemplate(
    '公司黑名单批量录入模板.csv',
    ['姓名', '身份证号', '黑名单原因', '风险等级', '联系电话', '来源项目/单位'],
    ['张三', '410xxxxxxxxxxxxxxx', '严重旷工或恶意离职', '高', '13800138000', '某用工项目']
  ));
  $('#blacklistXlsxTemplateButton').addEventListener('click', () => downloadXlsxTemplate(
    '公司黑名单批量录入模板.xlsx',
    ['姓名', '身份证号', '黑名单原因', '风险等级', '联系电话', '来源项目/单位'],
    ['张三', '410xxxxxxxxxxxxxxx', '严重旷工或恶意离职', '高', '13800138000', '某用工项目']
  ));
  $('#payrollTemplateButton').addEventListener('click', () => downloadCsvTemplate(
    '工资批次模板.csv',
    ['工号', '基本工资', '岗位工资', '绩效工资', '补贴', '计件工资', '1.5倍加班费', '2倍加班费', '3倍加班费', '社保扣款', '个税扣款', '预支扣回', '其他扣款'],
    ['YG001', '3000', '500', '300', '200', '0', '150', '0', '0', '350', '50', '500', '0']
  ));
  bindBatchFileZone('blacklistFileZone', 'blacklistFileInput', 'batchBlacklistForm', 'blacklistFileName',
    ['姓名', '身份证号', '黑名单原因', '风险等级', '联系电话', '来源项目/单位']);
  $('#createPermissionUserButton').addEventListener('click', () => openPermissionUserModal(null).catch(error => toast(error.message)));
  $('#permissionUserForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const userId = $('#permissionUserId').value;
    const url = userId ? `/api/system/users/${userId}` : '/api/system/users';
    const method = userId ? 'PUT' : 'POST';
    const body = {
      realName: form.realName.value,
      username: form.username.value,
      phone: form.phone.value,
      roleIds: [...form.querySelectorAll('input[name="roleIds"]:checked')].map(cb => Number(cb.value)),
      projectIds: [...form.querySelectorAll('input[name="projectIds"]:checked')].map(cb => Number(cb.value))
    };
    if (!userId) body.password = form.password.value;
    api(url, { method, body: JSON.stringify(body) }).then(() => {
      toast(userId ? '账号已更新' : '账号创建成功', 'success');
      $('#permissionUserModal').close();
      loadPermissions().catch(() => {});
    }).catch(error => toast(error.message, 'error'));
  });
  $('#resetPasswordForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const userId = $('#resetPasswordUserId').value;
    api(`/api/system/users/${userId}/password-reset`, {
      method: 'PUT',
      body: { newPassword: form.newPassword.value, confirmPassword: form.confirmPassword.value }
    }).then(() => {
      toast('密码已重置', 'success');
      $('#resetPasswordModal').close();
    }).catch(error => toast(error.message, 'error'));
  });
  $('#rolePermissionForm').addEventListener('submit', event => {
    event.preventDefault();
    const roleId = Number($('#rolePermissionRoleId').value);
    const role = _permRoles.find(item => Number(item.id) === roleId);
    if (role?.roleCode === 'company_admin') {
      toast('企业管理员固定拥有全部权限，无需保存', 'success');
      return;
    }
    const permIds = [...event.currentTarget.querySelectorAll('input[name="permId"]:checked')].map(cb => Number(cb.value));
    const deptIds = [...event.currentTarget.querySelectorAll('input[name="deptId"]:checked')].map(cb => Number(cb.value));
    Promise.all([
      api(`/api/system/roles/${roleId}/permissions`, { method: 'PUT', body: JSON.stringify({ permissionIds: permIds }) }),
      api(`/api/system/roles/${roleId}/departments`, { method: 'PUT', body: JSON.stringify({ deptIds }) })
    ])
      .then(() => {
        toast('角色权限已保存，相关账号重新登录后生效', 'success');
        $('#rolePermissionModal').close();
        loadPermissions().catch(() => {});
      })
      .catch(error => toast(error.message, 'error'));
  });
  $('#rolePermissionTree').addEventListener('change', event => {
    if (event.target.matches('input[name="permId"]')) {
      syncPermissionTreeSelection(event.target);
      updateRolePermissionCount();
    }
  });
  $('#rolePermissionSearch').addEventListener('input', event => filterRolePermissionTree(event.currentTarget.value));
  $('#rolePermissionSelectAll').addEventListener('click', () => {
    $('#rolePermissionTree').querySelectorAll('input[name="permId"]:not(:disabled)').forEach(input => { input.checked = true; });
    updateRolePermissionCount();
  });
  $('#rolePermissionClearAll').addEventListener('click', () => {
    $('#rolePermissionTree').querySelectorAll('input[name="permId"]:not(:disabled)').forEach(input => { input.checked = false; });
    updateRolePermissionCount();
  });
  /* 权限管理事件已在上方绑定 */
  $('#blacklistSearchForm').addEventListener('submit', event => {
    event.preventDefault();
    loadBlacklist().catch(error => toast(error.message));
  });
  $('#employeeForm').addEventListener('submit', event => saveEmployee(event).catch(error => toast(error.message)));
  $('#batchEmployeeForm').addEventListener('submit', event => submitEmployeeBatch(event).catch(error => toast(error.message)));
  $('#transferForm').addEventListener('submit', event => submitTransfer(event).catch(error => toast(error.message)));
  $('#transferCustomerSelect').addEventListener('change', updateTransferProjectOptions);
  $('#resignForm').addEventListener('submit', event => submitResign(event).catch(error => toast(error.message)));
  $('#contractForm').addEventListener('submit', event => submitContract(event).catch(error => toast(error.message)));
  $('#complianceForm').addEventListener('submit', event => submitOnboardingCompliance(event).catch(error => toast(error.message)));
  $('#socialForm').addEventListener('submit', event => submitSocial(event).catch(error => toast(error.message)));
  $('#certificateForm').addEventListener('submit', event => submitCertificate(event).catch(error => toast(error.message)));
  $('#passwordForm').addEventListener('submit', event => changePassword(event).catch(error => toast(error.message)));
  $('#riskCaseForm').addEventListener('submit', event => saveRiskCase(event).catch(error => toast(error.message)));
  $('#clientForm').addEventListener('submit', event => {
    event.preventDefault();
    submitSimpleForm(event.currentTarget, '/api/clients', '客户及首个项目已创建并立即生效', 'clientModal', () => Promise.all([loadProjects(), loadOffice()])).catch(error => toast(error.message));
  });
  $('#clientManageForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const customerId = Number($('#clientManageId').value);
    const body = {
      customerName: form.customerName.value,
      contactName: form.contactName.value,
      contactPhone: form.contactPhone.value,
      settlementCycle: form.settlementCycle.value,
      address: form.address.value,
      projects: collectCustomerProjects()
    };
    api(`/api/customers/${customerId}`, { method: 'PUT', body: JSON.stringify(body) })
      .then(() => {
        toast('客户项目情况已更新', 'success');
        $('#clientManageModal').close();
        return Promise.all([loadProjects(), loadOffice()]);
      })
      .catch(error => toast(error.message, 'error'));
  });
  $('#projectOnsiteForm').addEventListener('submit', event => saveProjectOnsiteAssignment(event).catch(error => toast(error.message, 'error')));
  $('#talentForm').addEventListener('submit', event => {
    event.preventDefault();
    submitSimpleForm(event.currentTarget, '/api/talents', '人才已录入', 'talentModal', () => Promise.all([loadTalents(), loadOffice()])).catch(error => toast(error.message));
  });
  $('#advanceForm').addEventListener('submit', event => {
    event.preventDefault();
    submitSimpleForm(event.currentTarget, '/api/advances', '驻厂预支记录已保存', 'advanceModal', () => Promise.all([loadAdvances(), loadSummary(), loadOffice()])).catch(error => toast(error.message));
  });
  $('#blacklistForm').addEventListener('submit', event => {
    event.preventDefault();
    submitSimpleForm(event.currentTarget, '/api/blacklist', '黑名单已录入并全公司共享', 'blacklistModal', loadBlacklist).catch(error => toast(error.message));
  });
  $('#batchBlacklistForm').addEventListener('submit', event => submitBlacklistBatch(event).catch(error => toast(error.message)));
  $('#payrollBatchForm').addEventListener('submit', event => submitPayrollBatch(event).catch(error => toast(error.message, 'error')));
  $('#recruiterForm').addEventListener('submit', event => { event.preventDefault(); saveRecruitmentSource(event.currentTarget, 'recruiter').catch(error => toast(error.message, 'error')); });
  $('#supplierForm').addEventListener('submit', event => { event.preventDefault(); saveRecruitmentSource(event.currentTarget, 'supplier').catch(error => toast(error.message, 'error')); });
  $('#channelForm').addEventListener('submit', event => { event.preventDefault(); saveRecruitmentSource(event.currentTarget, 'channel').catch(error => toast(error.message, 'error')); });
  $('#createRecruiterButton').addEventListener('click', () => openRecruiterModal());
  $('#createSupplierButton').addEventListener('click', () => openSupplierModal());
  $('#createChannelButton').addEventListener('click', () => openChannelModal());
  $$('[data-roster-mode]').forEach(button => button.addEventListener('click', () => {
    state.rosterViewMode = button.dataset.rosterMode;
    $$('[data-roster-mode]').forEach(item => item.classList.toggle('active', item === button));
    renderEmployees();
  }));
  $('#refreshTasksButton').addEventListener('click', () => loadWorkTasks().catch(error => toast(error.message, 'error')));
  $('#taskStatusFilter').addEventListener('change', () => loadWorkTasks().catch(error => toast(error.message, 'error')));
  $('#taskRiskFilter').addEventListener('change', () => loadWorkTasks().catch(error => toast(error.message, 'error')));

  $$('.nav-item').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });
  $$('.mobile-tabbar button').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  document.addEventListener('click', event => {
    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) {
      $(`#${closeButton.dataset.closeModal}`).close();
      return;
    }

    const riskPreset = event.target.closest('[data-risk-preset]');
    if (riskPreset && !riskPreset.classList.contains('metric-cell')) {
      applyRiskPreset(riskPreset.dataset.riskPreset || '');
      return;
    }

    const riskDetail = event.target.closest('[data-risk-detail]');
    if (riskDetail && !event.target.closest('button')) {
      state.selectedRiskId = Number(riskDetail.dataset.riskDetail);
      renderRiskCenter();
      return;
    }

    const riskEmployee = event.target.closest('[data-risk-employee]');
    if (riskEmployee) {
      switchView('roster');
      selectEmployee(Number(riskEmployee.dataset.riskEmployee)).catch(error => toast(error.message, 'error'));
      return;
    }

    const riskJump = event.target.closest('[data-risk-jump]');
    if (riskJump) {
      const risk = state.risks.find(item => Number(item.id) === Number(riskJump.dataset.riskJump));
      state.selectedRiskId = Number(risk?.employeeId || riskJump.dataset.riskJump);
      switchView('risk');
      return;
    }

    const mobileEditEmployee = event.target.closest('[data-mobile-edit-employee]');
    if (mobileEditEmployee) {
      openMobileEmployeeModal(Number(mobileEditEmployee.dataset.mobileEditEmployee)).catch(error => toast(error.message, 'error'));
      return;
    }

    const attachmentButton = event.target.closest('[data-download-attachment]');
    if (attachmentButton) {
      downloadAttachment(Number(attachmentButton.dataset.downloadAttachment), attachmentButton.dataset.filename)
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const officeAction = event.target.closest('[data-office-action]');
    if (officeAction) {
      runOfficeAction(officeAction.dataset.officeAction);
      return;
    }

    const editRecruiter = event.target.closest('[data-edit-recruiter]');
    if (editRecruiter) { openRecruiterModal(Number(editRecruiter.dataset.editRecruiter)); return; }
    const editSupplier = event.target.closest('[data-edit-supplier]');
    if (editSupplier) { openSupplierModal(Number(editSupplier.dataset.editSupplier)); return; }
    const editChannel = event.target.closest('[data-edit-channel]');
    if (editChannel) { openChannelModal(Number(editChannel.dataset.editChannel)); return; }
    const viewChannelEmployees = event.target.closest('[data-view-channel-employees]');
    if (viewChannelEmployees) { openChannelEmployees(Number(viewChannelEmployees.dataset.viewChannelEmployees)).catch(error => toast(error.message, 'error')); return; }
    const channelEmployeeDetail = event.target.closest('[data-channel-employee-detail]');
    if (channelEmployeeDetail) {
      $('#channelEmployeesModal').close();
      switchView('roster');
      selectEmployee(Number(channelEmployeeDetail.dataset.channelEmployeeDetail)).catch(error => toast(error.message, 'error'));
      return;
    }
    const customerRoster = event.target.closest('[data-customer-roster]');
    if (customerRoster) {
      $('#customerSelect').value = customerRoster.dataset.customerRoster;
      loadEmployees().catch(error => toast(error.message, 'error'));
      return;
    }
    const startTask = event.target.closest('[data-start-task]');
    if (startTask) {
      api(`/api/work-tasks/${startTask.dataset.startTask}/start`, { method: 'PUT', body: '{}' })
        .then(() => loadWorkTasks()).catch(error => toast(error.message, 'error'));
      return;
    }
    const completeTask = event.target.closest('[data-complete-task]');
    if (completeTask) {
      api(`/api/work-tasks/${completeTask.dataset.completeTask}/complete`, { method: 'PUT', body: '{}' })
        .then(() => Promise.all([loadWorkTasks(), loadOffice()])).catch(error => toast(error.message, 'error'));
      return;
    }
    const handleTransferButton = event.target.closest('[data-handle-transfer]');
    if (handleTransferButton) {
      const approved = Number(handleTransferButton.dataset.approved);
      api(`/api/employee-transfers/${handleTransferButton.dataset.handleTransfer}/handle`, {
        method: 'PUT',
        body: JSON.stringify({ approved })
      }).then(() => Promise.all([loadWorkTasks(), loadEmployees(), loadOffice()]))
        .catch(error => toast(error.message, 'error'));
      return;
    }
    const openOffboard = event.target.closest('[data-open-offboard]');
    if (openOffboard) {
      const employeeId = Number(openOffboard.dataset.openOffboard);
      selectEmployee(employeeId)
        .then(() => openResignModal(employeeId))
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const manageClientCard = event.target.closest('[data-manage-client]');
    if (manageClientCard) {
      openClientManagement(Number(manageClientCard.dataset.manageClient)).catch(error => toast(error.message, 'error'));
      return;
    }

    const publishPayrollButton = event.target.closest('[data-publish-payroll]');
    if (publishPayrollButton) {
      const batchId = Number(publishPayrollButton.dataset.publishPayroll);
      if (!window.confirm('确认发布该工资批次？发布后工资条将进入待签收状态。')) return;
      api(`/api/payroll/batches/${batchId}/publish`, { method: 'PUT', body: '{}' })
        .then(() => { toast('工资条已发布', 'success'); return Promise.all([loadPayroll(), loadOffice()]); })
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const submitPayrollButton = event.target.closest('[data-submit-payroll]');
    if (submitPayrollButton) {
      const batchId = Number(submitPayrollButton.dataset.submitPayroll);
      if (!window.confirm('确认提交复核？提交后需由具备工资复核权限的账号审核。')) return;
      api(`/api/payroll/batches/${batchId}/submit`, { method: 'PUT', body: '{}' })
        .then(() => { toast('工资批次已提交复核', 'success'); return loadPayroll(); })
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const reviewPayrollButton = event.target.closest('[data-review-payroll]');
    if (reviewPayrollButton) {
      const batchId = Number(reviewPayrollButton.dataset.reviewPayroll);
      const approved = Number(reviewPayrollButton.dataset.approved) === 1;
      const remark = approved ? '' : window.prompt('请输入退回原因');
      if (!approved && !remark) return;
      api(`/api/payroll/batches/${batchId}/review`, { method: 'PUT', body: JSON.stringify({ approved, remark }) })
        .then(() => { toast(approved ? '复核通过，已进入待发放' : '已退回工资批次', 'success'); return loadPayroll(); })
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const todoButton = event.target.closest('.todo-item[data-view]');
    if (todoButton) {
      const todoId = todoButton.dataset.todoId || '';
      if (todoId === 'contract' || todoId === 'insurance') {
        switchView('risk');
        window.setTimeout(() => applyRiskPreset(todoId), 0);
      } else {
        switchView(todoButton.dataset.view);
      }
      return;
    }

    const noticeButton = event.target.closest('[data-notice-view]');
    if (noticeButton) {
      switchView(noticeButton.dataset.noticeView);
      return;
    }

    /* 权限管理：编辑用户 */
    const editUserBtn = event.target.closest('[data-edit-user]');
    if (editUserBtn) {
      openPermissionUserModal(Number(editUserBtn.dataset.editUser)).catch(error => toast(error.message));
      return;
    }

    /* 权限管理：重置密码 */
    const resetPwdBtn = event.target.closest('[data-reset-pwd]');
    if (resetPwdBtn) {
      $('#resetPasswordUserId').value = resetPwdBtn.dataset.resetPwd;
      $('#resetPasswordUserName').textContent = resetPwdBtn.dataset.username;
      $('#resetPasswordForm').reset();
      $('#resetPasswordModal').showModal();
      return;
    }

    /* 权限管理：启用/停用 */
    const toggleUserBtn = event.target.closest('[data-toggle-user]');
    if (toggleUserBtn) {
      const userId = Number(toggleUserBtn.dataset.toggleUser);
      const status = Number(toggleUserBtn.dataset.status);
      api(`/api/system/users/${userId}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
        .then(() => { toast(status === 1 ? '账号已启用' : '账号已停用', 'success'); loadPermissions().catch(() => {}); })
        .catch(error => toast(error.message, 'error'));
      return;
    }

    /* 权限管理：配置角色权限 */
    const configRoleBtn = event.target.closest('[data-config-role]');
    if (configRoleBtn) {
      openRolePermissionModal(Number(configRoleBtn.dataset.configRole));
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) {
      const row = event.target.closest('[data-employee-row]');
      if (row) selectEmployee(row.dataset.employeeRow).catch(error => toast(error.message));
      return;
    }

    const { action, id, status } = actionButton.dataset;
    if (action === 'detail') selectEmployee(id).catch(error => toast(error.message));
    if (action === 'edit') openEmployeeModal(Number(id)).catch(error => toast(error.message));
    if (action === 'transfer') openTransferModal(id);
    if (action === 'resign') openResignModal(id);
    if (action === 'contract') openContractModal(id);
    if (action === 'compliance') openComplianceModal(id);
    if (action === 'social') openSocialModal(id, actionButton.dataset.insuranceAction);
    if (action === 'certificate') openCertificateModal(id);
    if (action === 'handle-risk') handleRisk(id, status).catch(error => toast(error.message));
    if (action === 'create-risk-case') openRiskCaseModal(id, 'create').catch(error => toast(error.message));
    if (action === 'edit-risk-case' || action === 'view-risk-case') {
      openRiskCaseModal(id, 'edit').catch(error => toast(error.message));
    }
    if (action === 'approve-advance') approveAdvance(id).catch(error => toast(error.message));
    if (action === 'pay-advance') payAdvance(id).catch(error => toast(error.message));
    if (action === 'assign-onsite') openProjectOnsiteModal(Number(actionButton.dataset.project)).catch(error => toast(error.message, 'error'));
    if (action === 'goto-risk') {
      const project = state.projects.find(item => Number(item.id) === Number(actionButton.dataset.project));
      state.selectedRiskProjectId = Number(project?.id || 0) || null;
      $('#riskKeywordInput').value = project?.projectName || '';
      switchView('risk');
    }
  });

  document.addEventListener('keydown', event => {
    const card = event.target.closest?.('[data-risk-detail]');
    if (!card || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    card.click();
  });

  /* ==================== 移动端员工管理事件 ==================== */
  const mobileAddBtn = $('#mobileAddEmployeeBtn');
  if (mobileAddBtn) mobileAddBtn.addEventListener('click', () => openMobileEmployeeModal().catch(error => toast(error.message, 'error')));

  const ocrScanBtn = $('#ocrScanBtn');
  const ocrFileInput = $('#ocrFileInput');
  if (ocrScanBtn && ocrFileInput) {
    ocrScanBtn.addEventListener('click', () => ocrFileInput.click());
    ocrFileInput.addEventListener('change', () => {
      if (ocrFileInput.files[0]) handleOcrScan(ocrFileInput.files[0]);
      ocrFileInput.value = '';
    });
  }

  const mobileEmpForm = $('#mobileEmployeeForm');
  if (mobileEmpForm) mobileEmpForm.addEventListener('submit', e => submitMobileEmployee(e).catch(err => toast(err.message, 'error')));
  $('#formCustomerSelect')?.addEventListener('change', event => updateEmployeeProjectOptions(event.currentTarget.form));
  $('#mFormCustomerSelect')?.addEventListener('change', event => updateEmployeeProjectOptions(event.currentTarget.form));
  $('#employeeForm')?.elements.employeeStatus?.addEventListener('change', event => syncEmployeeFormRequirements(event.currentTarget.form));
  $('#mobileEmployeeForm')?.elements.employeeStatus?.addEventListener('change', event => syncEmployeeFormRequirements(event.currentTarget.form));

  const mobileSearch = $('#mobileEmpSearch');
  if (mobileSearch) {
    const debouncedMobileSearch = debounce(() => {
      loadMobileEmployees(mobileSearch.value.trim()).catch(err => toast(err.message, 'error'));
    }, 400);
    mobileSearch.addEventListener('input', debouncedMobileSearch);
  }
}

async function init() {
  initializeRosterTableTools();
  bindEvents();
  initBackToTop();
  localStorage.removeItem('hrRosterToken');
  localStorage.removeItem('hrRosterUser');
  try {
    state.user = await api('/api/auth/me');
  } catch (_error) {
    logout(false, false);
    return;
  }
  showApp();
  await bootAuthedApp();
}

/* ==================== 回到顶部 ==================== */
function initBackToTop() {
  const btn = $('#backToTop');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ==================== 移动端员工管理 ==================== */

async function loadMobileEmployees(keyword = '') {
  const listEl = $('#mobileEmpList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="mobile-emp-empty">加载中...</div>';
  try {
    const query = keyword ? `keyword=${encodeURIComponent(keyword)}` : '';
    const data = await apiAllPages('/api/employees', query);
    renderMobileEmpCards(data.list);
  } catch (err) {
    listEl.innerHTML = `<div class="mobile-emp-empty">加载失败：${err.message}</div>`;
  }
}

function renderMobileEmpCards(list) {
  const listEl = $('#mobileEmpList');
  if (!listEl) return;
  if (!list || list.length === 0) {
    listEl.innerHTML = '<div class="mobile-emp-empty">暂无员工数据</div>';
    return;
  }
  const statusMap = { 1: { text: '待入职', cls: 'pending' }, 2: { text: '在职', cls: 'active' }, 3: { text: '离职', cls: 'resigned' }, 4: { text: '黑名单', cls: 'resigned' }, 5: { text: '未入职', cls: 'pending' }, 6: { text: '面试', cls: 'pending' } };
  const empTypeMap = { 1: '全职', 2: '兼职', 3: '劳务', 4: '实习', 5: '外包', 6: '派遣' };
  const canEditEmployee = (state.user?.permissions || []).includes('employee:update');
  listEl.innerHTML = list.map(emp => {
    const st = emp.lifecycleStatus === 'OFFBOARDING'
      ? { text: '离职交接中', cls: 'pending' }
      : statusMap[emp.employeeStatus] || { text: '未知', cls: '' };
    const empType = empTypeMap[emp.employmentType] || '-';
    const feeMode = emp.feeModeName || emp.feeMode || '-';
    return `<div class="mobile-emp-card">
      <div class="mobile-emp-card-head">
        <div>
          <span class="mobile-emp-card-name">${emp.name || '-'}</span>
        </div>
        <span class="mobile-emp-card-badge ${st.cls}">${st.text}</span>
      </div>
      <div class="mobile-emp-card-row"><strong>电话：</strong>${emp.phone || '-'}</div>
      <div class="mobile-emp-card-row"><strong>工作单位：</strong>${emp.customerName || '-'}</div>
      <div class="mobile-emp-card-row"><strong>岗位：</strong>${emp.positionName || '-'}　<strong>用工模式：</strong>${empType}</div>
      <div class="mobile-emp-card-row"><strong>费用模式：</strong>${feeMode}</div>
      <div class="mobile-emp-card-row"><strong>入职日期：</strong>${emp.hireDate || '-'}</div>
      ${canEditEmployee ? `<button class="table-button" type="button" data-mobile-edit-employee="${emp.id}">编辑员工</button>` : ''}
    </div>`;
  }).join('');
}

async function openMobileEmployeeModal(id = null) {
  await ensureRecruitmentChannelOptions();
  const form = $('#mobileEmployeeForm');
  if (!form) return;
  state.editingMobileEmployeeId = id ? Number(id) : null;
  form.reset();
  delete form.dataset.allowLegacyUnassigned;
  delete form.dataset.legacyCustomerId;
  delete form.dataset.employeeStatus;
  $('#mobileEmployeeModalTitle').textContent = id ? '编辑员工' : '新增员工';
  $('#mobileEmployeeStatusField')?.classList.toggle('hidden', Boolean(id));
  if (!id && form.elements.employeeStatus) form.elements.employeeStatus.value = '6';
  configureSensitiveEmployeeFields(form, Boolean(id));
  syncEmployeeFormRequirements(form);
  $('#ocrStatus')?.classList.add('hidden');
  /* 填充工作单位/岗位 */
  if (state.bootstrap) {
    $('#mFormCustomerSelect').innerHTML = `<option value="">请选择工作单位</option>${optionHtml(state.bootstrap.customers, 'id', 'customerName')}`;
    $('#mFormPositionSelect').innerHTML = `<option value="">请选择岗位</option>${optionHtml(state.bootstrap.positions, 'id', 'positionName')}`;
  }
  if (!id) applyEmployeeFormDefaults(form);
  updateEmployeeProjectOptions(form);
  if (id) {
    const detailUrl = canViewSensitiveEmployee()
      ? `/api/employees/${id}?showSensitive=1&reason=${encodeURIComponent('手机Web编辑员工档案')}`
      : `/api/employees/${id}`;
    const detail = await api(detailUrl);
    const row = detail.basicInfo;
    const allowLegacyUnassigned = !row.projectId && Number(row.createdBy) === Number(state.user?.id);
    form.dataset.allowLegacyUnassigned = allowLegacyUnassigned ? '1' : '0';
    form.dataset.legacyCustomerId = String(row.customerId || '');
    const values = {
      name: row.name,
      gender: row.gender,
      idCardNo: canViewSensitiveEmployee() ? row.idCardNo : '',
      address: canViewSensitiveEmployee() ? row.address : '',
      phone: canViewSensitiveEmployee() ? row.phone : '',
      customerId: row.customerId,
      projectId: row.projectId,
      positionId: row.positionId,
      employmentType: row.employmentType,
      feeMode: row.feeMode,
      workType: row.workType,
      hireDate: row.hireDate,
      channelSource: row.recruitmentChannelName || row.channelSource,
      email: row.email,
      education: row.education,
      bankName: row.bankName,
      bankCardNo: canViewSensitiveEmployee() ? row.bankCardNo : '',
      emergencyContact: row.emergencyContact,
      emergencyPhone: canViewSensitiveEmployee() ? row.emergencyPhone : '',
      remark: row.remark
    };
    form.dataset.employeeStatus = String(row.employeeStatus || '');
    for (const [key, value] of Object.entries(values)) {
      if (key === 'projectId') continue;
      if (form.elements[key]) form.elements[key].value = value || '';
    }
    updateEmployeeProjectOptions(form, values.projectId);
    syncEmployeeFormRequirements(form, row.employeeStatus);
  }
  $('#mobileEmployeeModal').showModal();
}

async function handleOcrScan(file) {
  const btn = $('#ocrScanBtn');
  const statusEl = $('#ocrStatus');
  if (!btn || !statusEl) return;

  btn.classList.add('scanning');
  btn.querySelector('span').textContent = '正在识别...';
  statusEl.className = 'ocr-status info hidden';

  try {
    /* 读取图片为 base64 */
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });

    /* 压缩图片到合理大小 */
    const compressed = await compressImage(base64, 1280, 0.85);

    /* 调用 OCR API */
    const result = await api('/api/ocr/idcard', {
      method: 'POST',
      body: JSON.stringify({ image: compressed })
    });

    /* 自动填充表单 */
    if (result.name) $('#mEmpName').value = result.name;
    if (result.gender) $('#mEmpGender').value = String(result.gender);
    if (result.idCardNo) $('#mEmpIdCard').value = result.idCardNo;
    if (result.address) $('#mEmpAddress').value = result.address;
    /* 从身份证号提取出生日期作为电话提示，但不自动填充电话 */

    statusEl.className = 'ocr-status success';
    statusEl.textContent = `识别成功：${result.name}（${result.gender === 1 ? '男' : '女'}）${result.nation}族，身份证号和地址已自动回填`;
    statusEl.classList.remove('hidden');
  } catch (err) {
    statusEl.className = 'ocr-status error';
    statusEl.textContent = `识别失败：${err.message}。可手动填写表单。`;
    statusEl.classList.remove('hidden');
  } finally {
    btn.classList.remove('scanning');
    btn.querySelector('span').textContent = '扫描身份证自动填充';
  }
}

/* 图片压缩：避免 base64 过大导致请求超限 */
function compressImage(dataUrl, maxSize, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round(height * maxSize / width);
          width = maxSize;
        } else {
          width = Math.round(width * maxSize / height);
          height = maxSize;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function submitMobileEmployee(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = removeUnavailableSensitiveFields(form, formToObject(form), Boolean(state.editingMobileEmployeeId));
  if (state.editingMobileEmployeeId) delete body.employeeStatus;
  const submitBtn = $('#mobileEmpSubmit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '保存中...';
  }
  try {
    const id = state.editingMobileEmployeeId;
    await api(id ? `/api/employees/${id}` : '/api/employees', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body)
    });
    toast(id ? '员工资料已保存' : '员工新增成功');
    $('#mobileEmployeeModal').close();
    await loadMobileEmployees($('#mobileEmpSearch')?.value || '');
  } catch (err) {
    toast(err.message || '新增失败', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '保存';
    }
  }
}

async function bootAuthedApp() {
  await loadBootstrap();
  clearCache();
  const results = await Promise.allSettled([refreshAll(), loadOffice()]);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length === results.length) throw failures[0].reason;
  if (failures.length) {
    const message = failures.map(result => result.reason?.message || '未知错误').join('；');
    toast(`部分数据加载失败：${message}`, 'error');
  }
  if (state.employees[0]) await selectEmployee(state.employees[0].id).catch(error => toast(`员工详情加载失败：${error.message}`, 'error'));
  switchView('office');
}

init().catch(error => {
  console.error('Init error:', error);
  toast(error.message || '系统初始化失败，请刷新页面', 'error');
});
