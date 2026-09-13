async function uploadAttachment(file, bizType, bizId) {
  if (!file) return null;
  const requestSessionVersion = state.sessionVersion;
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
    assertCurrentSession(requestSessionVersion);
    const payload = await response.json().catch(() => null);
    assertCurrentSession(requestSessionVersion);
    if (response.status === 401) {
      const message = payload?.message || '登录已过期，请重新登录';
      rememberAuthMessage(message);
      logout(false, false);
      setLoginError(message);
    }
    if (!response.ok || payload?.code !== 0) throw new Error(payload?.message || '附件上传失败');
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
    if (isSessionSupersededError(error)) throw error;
    toast(`业务记录已保存，但附件上传失败：${error.message}`, 'error');
    return false;
  }
}

async function downloadAttachment(id, filename) {
  const requestSessionVersion = state.sessionVersion;
  showLoading();
  try {
    const response = await fetch(`/api/attachments/${id}/download`, {
      credentials: 'same-origin',
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
    });
    assertCurrentSession(requestSessionVersion);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      if (response.status === 401) {
        const message = payload?.message || '登录已过期，请重新登录';
        rememberAuthMessage(message);
        logout(false, false);
        setLoginError(message);
      }
      throw new Error(payload?.message || '附件下载失败');
    }
    const blob = await response.blob();
    assertCurrentSession(requestSessionVersion);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || '合规附件';
    link.click();
    URL.revokeObjectURL(url);
  } finally {
    hideLoading();
  }
}

async function refreshAfterSuccess(refreshPromise, operationName = '操作') {
  try {
    return await refreshPromise;
  } catch (error) {
    if (isSessionSupersededError(error)) throw error;
    toast(`操作已成功，但${operationName}后的页面刷新失败：${error.message}。请手动刷新。`, 'error');
    return null;
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
    const requiredOnCreate = name === 'idCardNo';
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

function talentCheckKey(body = {}) {
  return `${String(body.name || '').trim()}::${String(body.idCardNo || '').trim().toUpperCase()}`;
}

function applyWebTalentCandidate(form, candidate) {
  if (!form || !candidate) return;
  const setValue = (name, value) => {
    if (form.elements[name] && value !== null && value !== undefined && value !== '') {
      form.elements[name].value = String(value);
    }
  };
  setValue('selectedTalentId', candidate.id);
  setValue('name', candidate.name);
  setValue('idCardNo', candidate.idCardNo);
  setValue('phone', candidate.phone);
  setValue('customerId', candidate.customerId);
  updateEmployeeProjectOptions(form, candidate.projectId || '');
  setValue('positionId', candidate.positionId);
  setValue('channelSource', candidate.sourceChannel);
  setValue('remark', candidate.remark);
  form.dataset.talentCheckKey = talentCheckKey({
    name: form.elements.name?.value,
    idCardNo: form.elements.idCardNo?.value
  });
  toast('已拉取人才库信息，请核对后保存');
}

function resetWebTalentSelection(event) {
  const name = event.target?.name;
  if (name !== 'name' && name !== 'idCardNo') return;
  const form = event.target.form;
  if (!form) return;
  if (form.elements.selectedTalentId) form.elements.selectedTalentId.value = '';
  delete form.dataset.talentCheckKey;
}

let duplicateIdentityCheckTimer = null;

function scheduleWebExistingEmployeeCheck(form) {
  const editing = form?.id === 'mobileEmployeeForm' ? state.editingMobileEmployeeId : state.editingEmployeeId;
  if (!form || editing) return;
  const idCardNo = String(form.elements.idCardNo?.value || '').trim();
  if (!/^\d{17}[\dXx]$/.test(idCardNo)) return;
  window.clearTimeout(duplicateIdentityCheckTimer);
  duplicateIdentityCheckTimer = window.setTimeout(async () => {
    if (form.dataset.duplicateCheckIdCard === idCardNo) return;
    form.dataset.duplicateCheckIdCard = idCardNo;
    try {
      const result = await api('/api/employees/precheck', {
        method: 'POST',
        body: JSON.stringify({ name: form.elements.name?.value || '', idCardNo })
      });
      if (result.checks?.duplicate?.passed === false) {
        await openExistingEmployeeRecord(result.checks.duplicate, { mobile: form.id === 'mobileEmployeeForm' });
      }
    } catch (error) {
      delete form.dataset.duplicateCheckIdCard;
      toast(error.message, 'error');
    }
  }, 120);
}

async function checkWebTalentCandidates(form, body) {
  const result = await api('/api/employees/precheck', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  if (!result.allowOnboarding) {
    if (result.checks?.blacklist?.passed === false) {
      throw new Error(`该人员命中黑名单：${result.checks.blacklist.reason || '禁止录入'}`);
    }
    if (result.checks?.duplicate?.passed === false) {
      const opened = await openExistingEmployeeRecord(result.checks.duplicate);
      if (opened) return false;
      throw new Error('该身份证号已存在员工档案，不能重复录入');
    }
    throw new Error('员工预检查未通过，请核对人员信息');
  }
  const candidates = result.talentCandidates || [];
  const checkKey = talentCheckKey(body);
  if (!candidates.length || form.dataset.talentCheckKey === checkKey || body.selectedTalentId) return true;
  const first = candidates[0];
  const useTalent = await confirmDialog({
    title: '发现人才库记录',
    message: `人才库发现${candidates.length}条同名或同身份证记录。是否拉取“${first.name}”的已有信息？取消后将继续按当前内容录入。`,
    confirmText: '拉取已有信息'
  });
  if (useTalent) {
    applyWebTalentCandidate(form, first);
    return false;
  }
  form.dataset.talentCheckKey = checkKey;
  return true;
}

async function reactivateExistingEmployee(id) {
  await api(`/api/employees/${id}/reactivate`, {
    method: 'POST',
    body: JSON.stringify({ remark: '身份证重复录入时重新捞出员工档案' })
  });
  toast('员工已重新录用并进入待到岗', 'success');
  await refreshEmployeeWorkspace();
  await selectEmployee(id);
}

async function openExistingEmployeeRecord(duplicate, options = {}) {
  if (!duplicate?.canOpen || !duplicate.employeeId) {
    throw new Error('该身份证号已存在员工档案，但当前账号无权查看，请联系企业管理员');
  }
  const statusText = duplicate.lifecycleStatus || `状态${duplicate.employeeStatus || '-'}`;
  const locationText = [duplicate.customerName, duplicate.projectName].filter(Boolean).join(' / ') || '暂未分配客户项目';
  const actionHint = duplicate.canReactivate ? '打开档案后可编辑资料并重新录用。' : '将直接打开现有员工档案。';
  const confirmed = await confirmDialog({
    title: '身份证号已存在',
    message: `该身份证号已存在员工档案：${duplicate.employeeName || '员工'}（${statusText}）。当前归属：${locationText}。${actionHint}`,
    confirmText: '打开员工档案'
  });
  if (!confirmed) {
    return false;
  }
  const sourceModal = options.mobile ? $('#mobileEmployeeModal') : $('#employeeModal');
  if (sourceModal?.open) sourceModal.close();
  switchView('roster');
  await selectEmployee(duplicate.employeeId);
  if (duplicate.canReactivate) {
    if (options.mobile) await openMobileEmployeeModal(Number(duplicate.employeeId));
    else await openEmployeeModal(Number(duplicate.employeeId));
    toast('请核对并保存档案，再点击“重新录用”转入待到岗', 'success');
  } else if ((state.user?.permissions || []).includes('employee:update')) {
    await openEmployeeModal(Number(duplicate.employeeId));
  }
  return true;
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

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 给浏览器足够时间接管 Blob，避免立即释放地址导致下载被取消。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCsvTemplate(filename, headers, example) {
  const csv = `\uFEFF${headers.join(',')}\n${example.join(',')}\n`;
  triggerBlobDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

async function downloadXlsxTemplate(filename, headers, example) {
  if (typeof ExcelJS === 'undefined') throw new Error('Excel 组件未加载，请刷新页面重试');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('批量录入');
  worksheet.addRow(headers);
  worksheet.addRow(example);
  worksheet.columns.forEach(column => { column.width = 16; });
  const buffer = await workbook.xlsx.writeBuffer();
  triggerBlobDownload(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }), filename);
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
  if (value && typeof value === 'object' && value.formula) {
    return `=${value.formula}`;
  }
  // ExcelJS 日期单元格会读取为 Date 对象
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // 少数表格日期仍可能以数字序列号保存（1970~2119 = 25569~73050）
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
  if (value && typeof value === 'object' && Object.hasOwn(value, 'text')) {
    return value.text == null ? '' : String(value.text);
  }
  return value == null ? '' : String(value);
}

function worksheetToRows(worksheet) {
  const rowCount = worksheet.actualRowCount || worksheet.rowCount || 0;
  const columnCount = worksheet.actualColumnCount || worksheet.columnCount || 0;
  const rows = [];
  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const row = [];
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const cell = worksheet.getRow(rowIndex).getCell(columnIndex);
      const isMergedCopy = cell.isMerged && cell.master && cell.master.address !== cell.address;
      row.push(isMergedCopy ? '' : excelCellToText(cell.value));
    }
    rows.push(row);
  }
  return rows;
}

function readFileAsArrayBuffer(file, errorMessage = '文件读取失败') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(errorMessage));
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file, errorMessage = '文件读取失败') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result;
      if (!(buffer instanceof ArrayBuffer) || typeof TextDecoder === 'undefined') {
        resolve(String(buffer || ''));
        return;
      }
      const utf8 = new TextDecoder('utf-8').decode(buffer);
      // 国内财务软件常导出 GBK/ANSI CSV；UTF-8 解码出现替换字符时尝试 GBK。
      if (!utf8.includes('\uFFFD')) {
        resolve(utf8);
        return;
      }
      try {
        const gbk = new TextDecoder('gbk').decode(buffer);
        resolve(gbk.includes('\uFFFD') ? utf8 : gbk);
      } catch (error) {
        resolve(utf8);
      }
    };
    reader.onerror = () => reject(new Error(errorMessage));
    reader.readAsArrayBuffer(file);
  });
}

function renderBatchColumnPreview(previewEl, expectedHeaders, actualHeaders, dataRow) {
  if (!previewEl) return;
  if (!Array.isArray(actualHeaders) || !actualHeaders.length) {
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
    return;
  }
  const employeeHeaders = typeof EmployeeBatch !== 'undefined'
    && expectedHeaders.join('\u0000') === EmployeeBatch.headers.join('\u0000');
  if (employeeHeaders) {
    const inspection = EmployeeBatch.inspectEmployeeHeaders(actualHeaders);
    const recognized = inspection.columns.filter(column => column.key).length;
    const unknown = inspection.columns.length - recognized;
    const hasRequired = inspection.missingRequired.length === 0;
    const statusTone = hasRequired ? 'ok' : 'bad';
    const statusText = hasRequired
      ? `✓ 已按表头自动识别 ${recognized} 列，列顺序可自由调整${unknown ? `；${unknown} 个额外列将忽略` : ''}`
      : `⚠ 缺少必需表头：${inspection.missingRequired.join('、')}`;
    const cells = inspection.columns.map((column, idx) => {
      const tone = column.key ? 'ok' : 'missing';
      const mark = column.key ? '✓ 已对应' : '忽略';
      const sample = (dataRow && dataRow[idx] != null) ? `  样例：<code>${escapeHtml(String(dataRow[idx]).slice(0, 24))}</code>` : '';
      return `<div class="batch-col-row ${tone}"><span class="batch-col-num">${idx + 1}</span><span class="batch-col-std">${escapeHtml(column.canonical || '额外列')}</span><span class="batch-col-arrow">←</span><span class="batch-col-actual">${escapeHtml(column.actual) || '<em>空</em>'}</span><span class="batch-col-mark">${mark}${sample}</span></div>`;
    }).join('');
    previewEl.className = `batch-column-preview ${statusTone}`;
    previewEl.innerHTML = `<div class="batch-column-head">${escapeHtml(statusText)}</div>${cells}`;
    previewEl.classList.remove('hidden');
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

async function handleBatchFile(file, textarea, fileNameEl, options = {}) {
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  const expectedHeaders = options.expectedHeaders || [];
  const previewEl = options.previewEl || null;
  if (name.endsWith('.xls')) throw new Error('旧版 .xls 暂不支持，请在 Excel 中另存为 .xlsx 或 .csv 后上传');
  if (!/\.(csv|xlsx)$/.test(name)) throw new Error('仅支持 .csv / .xlsx 文件');
  if (fileNameEl) fileNameEl.textContent = `解析中：${file.name} …`;
  if (previewEl) { previewEl.classList.add('hidden'); previewEl.innerHTML = ''; }
  try {
    let text = '';
    let actualHeaders = [];
    let firstDataRow = [];
    if (name.endsWith('.csv')) {
      text = (await readFileAsText(file)).replace(/\r\n?/g, '\n').replace(/\uFEFF/g, '').trim();
      if (text) {
        const firstLine = text.split('\n')[0];
        const sep = firstLine.includes('\t') ? '\t' : ',';
        actualHeaders = firstLine.split(sep).map(c => c.trim());
      }
    } else {
      if (typeof ExcelJS === 'undefined') throw new Error('Excel 组件未加载，请刷新页面重试');
      const workbook = new ExcelJS.Workbook();
      const buffer = await readFileAsArrayBuffer(file);
      await workbook.xlsx.load(buffer);
      const rows = worksheetToRows(workbook.worksheets[0]);
      if (!rows.length) throw new Error('文件为空');
      actualHeaders = (rows[0] || []).map(c => String(c || '').trim());
      firstDataRow = rows[1] || [];
      text = rowsToTabText(rows);
    }
    if (!text) throw new Error('未解析到数据');
    textarea.value = text;
    const dataRowCount = Math.max(0, (text.split('\n').length - 1));
    if (fileNameEl) fileNameEl.textContent = `已载入：${file.name}（共 ${dataRowCount} 行）`;
    if (expectedHeaders.length) {
      renderBatchColumnPreview(previewEl, expectedHeaders, actualHeaders, firstDataRow);
      const employeeHeaders = typeof EmployeeBatch !== 'undefined'
        && expectedHeaders.join('\u0000') === EmployeeBatch.headers.join('\u0000');
      const missingEmployeeHeaders = employeeHeaders
        ? EmployeeBatch.inspectEmployeeHeaders(actualHeaders).missingRequired
        : [];
      if (employeeHeaders && missingEmployeeHeaders.length) {
        toast(`表格缺少必需表头：${missingEmployeeHeaders.join('、')}`, 'error');
      } else if (!employeeHeaders && actualHeaders.length !== expectedHeaders.length) {
        toast(`表格列数不符：应为 ${expectedHeaders.length} 列，实际 ${actualHeaders.length} 列。请参考上方对照表调整，或使用本系统下载的模板重新录入。`, 'error');
      }
    }
    textarea.focus();
  } catch (error) {
    if (fileNameEl) fileNameEl.textContent = '';
    throw error;
  }
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
  const trigger = () => handleBatchFile(input.files[0], textarea, fileNameEl, { expectedHeaders, previewEl })
    .catch(error => toast(error.message || '文件解析失败', 'error'));
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
  input.addEventListener('change', trigger);
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, event => { event.preventDefault(); zone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, event => { event.preventDefault(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', event => {
    const file = event.dataTransfer && event.dataTransfer.files[0];
    if (file) {
      input.value = '';
      handleBatchFile(file, textarea, fileNameEl, { expectedHeaders, previewEl })
        .catch(error => toast(error.message || '文件解析失败', 'error'));
    }
  });
}

function showBatchResult(element, result) {
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const warnBlock = warnings.length
    ? `<div class="batch-warn-block">${warnings.map(item => `第${item.row}行 ${escapeHtml(item.name || '')}：${(Array.isArray(item.messages) ? item.messages : []).map(escapeHtml).join('；')}`).join('<br>')}</div>`
    : '';
  element.classList.remove('hidden');
  const summary = `<strong>共${result.total}行：成功${result.successCount}行，失败${result.failureCount}行${warnings.length ? `，自动纠错${warnings.length}行` : ''}</strong>`;
  const hasFailures = Number(result.failureCount) > 0;
  const errorLines = errors.map(item => `第${item.row}行 ${escapeHtml(item.name || '')}：${escapeHtml(item.message)}`).join('<br>');
  const detail = hasFailures
    ? `<div class="batch-error-block">${errorLines || '存在录入失败的行，但未返回具体明细，请重试或联系管理员'}</div>`
    : '<div>全部录入成功。</div>';
  element.innerHTML = summary + warnBlock + detail;
}

async function submitEmployeeBatch(event) {
  event.preventDefault();
  const rows = EmployeeBatch.parseEmployeeBatchTable(event.currentTarget.elements.tableData.value);
  const result = await api('/api/employees/batch', { method: 'POST', body: JSON.stringify({ rows }) });
  showBatchResult($('#batchEmployeeResult'), result);
  if (Number(result.failureCount) > 0) {
    const resultEl = $('#batchEmployeeResult');
    if (resultEl) resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast(`批量录入完成：成功${result.successCount}人，失败${result.failureCount}人，详见下方红色提示`, 'error');
  }
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
  const projects = (state.bootstrap.projects || []).filter(item =>
    Number(item.customerId) === customerId && Number(item.status) === 2
  );
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
  const projects = state.projects.filter(item => Number(item.customerId) === customerId && Number(item.status) === 2);
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
  updateRosterProjectOptions();
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

function updateRosterProjectOptions(selectedValue = '') {
  const select = $('#projectSelect');
  if (!select || !state.bootstrap) return;
  const customerId = Number($('#customerSelect')?.value || 0);
  const projects = (state.bootstrap.projects || []).filter(item => !customerId || Number(item.customerId) === customerId);
  const currentValue = selectedValue || select.value;
  select.innerHTML = `<option value="">全部项目</option>${optionHtml(projects, 'id', 'projectName')}`;
  if (projects.some(item => String(item.id) === String(currentValue))) select.value = String(currentValue);
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
  const form = event.currentTarget;
  if (loginSubmitting) return;
  loginSubmitting = true;
  await waitForLogoutRequest();
  setSystemStatus('loading');
  setLoginError('');
  const submitButton = $('#loginSubmitButton');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = '登录中...';
  }
  const body = formToObject(form);
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    // 先清除上一账号工作区并加载当前权限范围，完成后再显示页面，避免共享电脑串号残留。
    await activateAuthenticatedSession(data.user, data.token || '');
    toast('登录成功', 'success');
  } catch (error) {
    if (!state.user) setSystemStatus('auth');
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
    registerLogoutRequest(fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {
      if (showMessage) toast('已退出本机，但服务器会话撤销失败，请稍后重新登录确认', 'error');
    }));
  }
  clearSessionWorkspace();
  setSystemStatus('auth');
  // 清理旧版本遗留的可被脚本读取的会话数据。
  localStorage.removeItem('hrRosterToken');
  localStorage.removeItem('hrRosterUser');
  $('#loginScreen').classList.remove('hidden');
  $('#userPill').textContent = '未登录';
  if (showMessage) toast('已退出登录');
}

function showApp() {
  setWorkspaceLocked(false);
  $('#loginScreen').classList.add('hidden');
  $('#userPill').textContent = state.user ? `${state.user.realName} / ${state.user.roles?.[0]?.roleName || '用户'}` : '已登录';
  applyNavVisibility();
}

function getVisibleNavigationModel(activeView = state.activeView) {
  const permissions = state.user?.permissions || [];
  const isCompanyAdmin = (state.user?.roles || []).some(role => role.roleCode === 'company_admin');
  return buildNavigationModel({ activeView, permissions, isCompanyAdmin });
}

function renderPrimaryNavigation(activeView = state.activeView) {
  const container = $('#primaryNavigation');
  if (!container) return;
  const groups = getVisibleNavigationModel(activeView);
  const activeGroup = groups.find(group => group.active) || groups[0];
  container.innerHTML = groups.map(group => {
    const expanded = group.id === activeGroup?.id;
    const targetView = group.active ? activeView : group.activeView;
    return `<div class="nav-group ${expanded ? 'active' : ''}" data-nav-group="${group.id}">
      <button class="nav-item ${expanded ? 'active' : ''}" type="button" data-view="${targetView}" aria-expanded="${expanded}">
        <span>${escapeHtml(group.shortLabel)}</span>
        <strong>${escapeHtml(group.label)}</strong>
        <small>${escapeHtml(group.activeLabel)}</small>
      </button>
      <div class="nav-submenu" ${expanded ? '' : 'hidden'}>
        ${group.items.map(item => `<button class="nav-subitem ${item.view === activeView ? 'active' : ''}" type="button" data-view="${item.view}">${escapeHtml(item.label)}</button>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderMobileNavigation(activeView = state.activeView) {
  const container = $('#mobileNavigationItems');
  if (!container) return;
  const items = buildMobileNavigationItems(getVisibleNavigationModel(activeView));
  const groups = new Map();
  items.forEach(item => {
    if (!groups.has(item.groupId)) groups.set(item.groupId, { label: item.groupLabel, items: [] });
    groups.get(item.groupId).items.push(item);
  });
  container.innerHTML = Array.from(groups.values()).map(group => `
    <section class="mobile-navigation-group">
      <h3>${escapeHtml(group.label)}</h3>
      <div>${group.items.map(item => `<button type="button" class="mobile-navigation-item ${item.view === activeView ? 'active' : ''}" data-mobile-nav-view="${item.view}"><span>${escapeHtml(item.label)}</span><strong>进入</strong></button>`).join('')}</div>
    </section>
  `).join('');
}

function updateMobileNavigationActive(view = state.activeView) {
  const directViews = new Set($$('.mobile-tabbar button[data-view]').map(item => item.dataset.view));
  $$('.mobile-tabbar button[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  const moreButton = $('[data-mobile-nav-more]');
  if (moreButton) moreButton.classList.toggle('active', !directViews.has(view));
  $$('.mobile-navigation-item').forEach(item => item.classList.toggle('active', item.dataset.mobileNavView === view));
}

/* 角色驱动的导航菜单显隐 */
function applyNavVisibility() {
  const perms = state.user?.permissions || [];
  const isCompanyAdmin = (state.user?.roles || []).some(r => r.roleCode === 'company_admin');
  const navigationModel = getVisibleNavigationModel();
  renderPrimaryNavigation();
  renderMobileNavigation();
  $$('[data-action-perm]').forEach(item => {
    const requiredPerms = String(item.dataset.actionPerm || '').split(',').filter(Boolean);
    item.style.display = isCompanyAdmin || requiredPerms.every(permission => perms.includes(permission)) ? '' : 'none';
  });
  applyTopbarActionVisibility(state.activeView);
  /* 移动端 tabbar 也按权限显隐 */
  $$('.mobile-tabbar button').forEach(item => {
    if (item.hasAttribute('data-mobile-nav-more')) {
      item.style.display = navigationModel.length ? '' : 'none';
      return;
    }
    const view = item.dataset.view;
    const allowed = navigationModel.some(group => group.items.some(navItem => navItem.view === view));
    item.style.display = allowed ? '' : 'none';
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

async function toggleRosterIdCard(button) {
  if (!canViewSensitiveEmployee()) throw new Error('当前账号没有查看完整身份证号的权限');
  const cell = button.closest('.col-idcard');
  const valueElement = cell?.querySelector('.id-card-value');
  if (!valueElement) return;
  if (button.dataset.revealed === '1') {
    valueElement.textContent = button.dataset.maskedValue || '-';
    button.dataset.revealed = '0';
    button.textContent = '显示完整';
    button.title = '查看完整身份证号码';
    return;
  }
  const confirmed = await confirmDialog({
    title: '查看敏感身份信息',
    message: '完整身份证号码属于敏感个人信息。本次查看将记录操作原因，请避免在投屏或公共环境中展示。',
    confirmText: '确认查看'
  });
  if (!confirmed) return;
  const id = Number(button.dataset.id || 0);
  const detail = await api(`/api/employees/${id}?showSensitive=1&reason=${encodeURIComponent('查看花名册身份证号')}`);
  valueElement.textContent = detail.basicInfo?.idCardNo || '-';
  button.dataset.revealed = '1';
  button.textContent = '隐藏';
  button.title = '恢复脱敏显示';
}

function renderDetail(detail) {
  $('#emptyDetail').classList.add('hidden');
  const content = $('#detailContent');
  content.classList.remove('hidden');
  const basic = detail.basicInfo;
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
        ${EmployeeBindCode.canGenerateEmployeeBindCode(permissions, basic.employeeStatus) ? `<button class="secondary-button" type="button" data-action="employee-bind-code" data-id="${basic.id}">生成绑定码</button>` : ''}
        ${permissions.includes('employee:update') && [3, 5].includes(Number(basic.employeeStatus)) ? `<button class="primary-button" type="button" data-action="reactivate" data-id="${basic.id}">重新录用</button>` : ''}
        ${permissions.includes('employee:transfer') ? `<button class="secondary-button" type="button" data-action="transfer" data-id="${basic.id}">调岗</button>` : ''}
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
      </div>
    </section>

    <section class="detail-section">
      <h3>证件资料</h3>
      <div class="timeline">
        ${renderCertificates(detail.certificateList)}
      </div>
    </section>

  `;
}

async function openEmployeeBindCode(employeeId) {
  const basic = state.selectedDetail?.basicInfo;
  const result = await EmployeeBindCode.createEmployeeBindCode({
    employeeId,
    employeeName: Number(basic?.id) === Number(employeeId) ? basic.name : '当前员工',
    request: api
  });
  $('#employeeBindCodeEmployee').textContent = result.employeeName;
  $('#employeeBindCodeValue').textContent = result.bindCode;
  $('#employeeBindCodeExpireAt').textContent = result.expireAt;
  $('#copyEmployeeBindCodeButton').dataset.bindCode = result.bindCode;
  $('#employeeBindCodeModal').showModal();
}

async function copyEmployeeBindCode() {
  const button = $('#copyEmployeeBindCodeButton');
  const bindCode = String(button.dataset.bindCode || '').trim();
  if (!bindCode) throw new Error('当前没有可复制的绑定码');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(bindCode);
  } else {
    const input = document.createElement('textarea');
    input.value = bindCode;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('复制失败，请手动记录绑定码');
  }
  toast('绑定码已复制', 'success');
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

const actionNames = {
  create: '新增',
  update: '编辑',
  transfer: '调岗',
  resign: '离职',
  upsert: '维护',
  handle: '处理',
  change_password: '修改密码'
};

async function loadAuditLogs() {
  setPanelLoading('#auditTableBody');
  try {
  const rows = await api('/api/audit-logs');
  const tbody = $('#auditTableBody');
  if (!rows.length) {
    tbody.innerHTML = emptyRow(6, '暂无操作记录', '员工、工资条、风险、账号权限等关键操作会自动留痕');
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
  } catch (error) {
    if (isSessionSupersededError(error)) throw error;
    renderTableFailure('#auditTableBody', 6, '操作日志加载失败', error, 'audit');
    throw error;
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

function syncEmployeeEntryPresentation(form, statusValue = '') {
  if (!form || form.id !== 'employeeForm') return;
  const employeeStatus = Number(statusValue || form.elements.employeeStatus?.value || form.dataset.employeeStatus || 6);
  const presentation = getEmployeeEntryPresentation(employeeStatus);
  const editing = form.dataset.editing === '1';
  form.querySelectorAll('[data-entry-direct]').forEach(section => {
    section.classList.toggle('hidden', !editing && !presentation.showPlacement);
  });
  form.querySelectorAll('[data-entry-mode]').forEach(button => {
    const selected = Number(button.dataset.entryMode) === employeeStatus;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if ($('#employeeEntryFlowTitle')) $('#employeeEntryFlowTitle').textContent = editing ? '编辑员工档案' : presentation.flowTitle;
  if ($('#employeeEntryFlowDescription')) {
    $('#employeeEntryFlowDescription').textContent = editing
      ? '保存后更新现有档案，不改变员工当前生命周期状态。'
      : presentation.flowDescription;
  }
  const values = Object.fromEntries(new FormData(form));
  const completion = calculateEmployeeEntryCompletion(values, presentation);
  if ($('#employeeEntryCompletionLabel')) $('#employeeEntryCompletionLabel').textContent = `${completion}%`;
  if ($('#employeeEntryCompletionBar')) $('#employeeEntryCompletionBar').style.width = `${completion}%`;
  if ($('#employeeEntrySubmit')) $('#employeeEntrySubmit').textContent = editing ? '保存员工资料' : presentation.primaryAction;
}

function syncEmployeeFormRequirements(form, statusValue = '') {
  if (!form) return;
  const employeeStatus = Number(statusValue || form.elements.employeeStatus?.value || form.dataset.employeeStatus || 1);
  const interview = employeeStatus === 6;
  for (const name of ['idCardNo', 'customerId', 'positionId']) {
    if (form.elements[name]) form.elements[name].required = !interview;
  }
  // 用工与计费、招聘渠道和备注均允许后续补齐。
  for (const name of ['employmentType', 'feeMode', 'workType', 'hireDate', 'channelSource', 'remark']) {
    if (form.elements[name]) form.elements[name].required = false;
  }
  updateEmployeeProjectOptions(form);
  if (interview && form.elements.projectId) form.elements.projectId.required = false;
  syncEmployeeEntryPresentation(form, employeeStatus);
}

function setEmployeeFormReadOnly(form, readOnly) {
  if (!form) return;
  form.dataset.readOnly = readOnly ? '1' : '0';
  form.querySelectorAll('input, select, textarea').forEach(field => {
    field.disabled = Boolean(readOnly);
  });
  form.querySelectorAll('button[data-entry-mode], #onboardingTalentButton, #onboardingBatchButton').forEach(button => {
    button.disabled = Boolean(readOnly);
    button.classList.toggle('hidden', Boolean(readOnly));
  });
  const submit = $('#employeeEntrySubmit');
  if (submit) {
    submit.disabled = Boolean(readOnly);
    submit.classList.toggle('hidden', Boolean(readOnly));
  }
  const cancel = form.querySelector('[data-close-modal="employeeModal"]:not(.icon-button)');
  if (cancel) cancel.textContent = readOnly ? '关闭' : '取消';
}

async function openEmployeeModal(id = null, options = {}) {
  const readOnly = Boolean(options.readOnly);
  await ensureRecruitmentChannelOptions();
  state.editingEmployeeId = id;
  const form = $('#employeeForm');
  form.reset();
  delete form.dataset.allowLegacyUnassigned;
  delete form.dataset.legacyCustomerId;
  delete form.dataset.employeeStatus;
  delete form.dataset.talentCheckKey;
  delete form.dataset.duplicateCheckIdCard;
  form.dataset.editing = id ? '1' : '0';
  setEmployeeFormReadOnly(form, false);
  updateEmployeeProjectOptions(form);
  $('#employeeModalTitle').textContent = readOnly ? '查看员工' : (id ? '编辑员工' : '新增员工');
  $('#employeeStatusField')?.classList.toggle('hidden', Boolean(id));
  $('#employeeEntryModeSwitch')?.classList.toggle('hidden', Boolean(id));
  form.querySelector('.onboarding-control')?.classList.toggle('hidden', Boolean(id));
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

  setEmployeeFormReadOnly(form, readOnly);
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
  $('#resignModal').showModal();
}

function openCertificateModal(id) {
  state.selectedEmployeeId = Number(id);
  $('#certificateForm').reset();
  $('#certificateModal').showModal();
}

async function saveEmployee(event) {
  event.preventDefault();
  const id = state.editingEmployeeId;
  const form = event.currentTarget;
  if (form.dataset.readOnly === '1') {
    $('#employeeModal')?.close();
    return;
  }
  const body = removeUnavailableSensitiveFields(form, formToObject(form), Boolean(id));
  if (id) delete body.employeeStatus;
  if (!id && !(await checkWebTalentCandidates(form, body))) return;
  const path = id ? `/api/employees/${id}` : '/api/employees';
  const method = id ? 'PUT' : 'POST';
  const submitButton = $('#employeeEntrySubmit');
  if (submitButton) submitButton.disabled = true;
  try {
    const result = await api(path, { method, body: JSON.stringify(body) });
    $('#employeeModal').close();
    const successMessage = id
      ? '员工信息已保存'
      : Number(body.employeeStatus) === 6
        ? '已保存到面试名单'
        : '已保存并进入待到岗';
    toast(successMessage);
    await refreshEmployeeWorkspace();
    await selectEmployee(result.employeeId);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
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
  const confirmed = await confirmDialog({
    title: '确认办理离职',
    message: '保存后员工将转入花名册“已离职”，并同步进入人才库。该操作会改变员工在职状态。',
    confirmText: '确认离职',
    danger: true
  });
  if (!confirmed) return;
  const result = await api(`/api/employees/${state.resignEmployeeId}/resign`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  $('#resignModal').close();
  toast(result.completed ? '离职已办结，员工已归档并同步人才库' : '离职信息已保存');
  await refreshEmployeeWorkspace();
  await selectEmployee(state.resignEmployeeId);
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

async function loadProjects() {
  setPanelLoading('#projectCards');
  try {
  const userPermissions = state.user?.permissions || [];
  const isCompanyAdmin = (state.user?.roles || []).some(role => role.roleCode === 'company_admin');
  const canViewCustomers = isCompanyAdmin || userPermissions.includes('customer:view');
  const [clientResult, projectResult] = await Promise.all([
    canViewCustomers ? apiAllPages('/api/clients') : Promise.resolve({ list: [] }),
    apiAllPages('/api/projects')
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
  const canAssignOnsite = isCompanyAdmin;
  const canViewEmployees = isCompanyAdmin
    || userPermissions.includes('employee:view');
  const healthTotals = projects.reduce((summary, item) => ({
    onsite: summary.onsite + Number(item.activeCount || 0),
    outstanding: summary.outstanding + Number(item.advanceOutstanding || 0)
  }), { onsite: 0, outstanding: 0 });
  $('#projectHealthKpis').innerHTML = [
    ['生效项目', projects.filter(item => Number(item.status) === 2).length, 'neutral'],
    ['当前在岗', healthTotals.onsite, 'good'],
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
        <div class="entity-meta"><span>${item.settlementCycle || '按月结算'}</span><strong>生效 ${item.effectiveProjectCount || 0} / 全部 ${item.projectCount || 0}</strong></div>
        ${canManageClientProjects ? '<div class="client-manage-hint">点击查看并修改客户项目 →</div>' : ''}
      </div>
    </article>`;
  }).join('') || '<p class="empty-copy">暂无客户</p>';
  $('#projectCards').innerHTML = projects.map(item => `
    <article class="entity-card project-card health-card">
      <div class="entity-index">P${String(item.id).padStart(2, '0')}</div>
      <div>
        <div class="project-card-title"><div><h4>${escapeHtml(item.projectName)}</h4><p>${escapeHtml(item.clientName)} · ${escapeHtml(item.worksiteName)}</p></div>${badge(Number(item.status) === 2 ? '进行中' : Number(item.status) === 3 ? '已暂停' : '已结束', Number(item.status) === 2 ? 'green' : 'amber')}</div>
        <div class="project-health-grid">
          <span><i>在岗人数</i><b>${item.activeCount}</b></span>
          <span><i>预支未结</i><b>${money(item.advanceOutstanding)}</b></span>
          <span><i>累计实发</i><b>${money(item.payrollNet)}</b></span>
        </div>
        <div class="entity-meta"><span>${escapeHtml(item.serviceType)}</span><strong>${escapeHtml(item.managerName)}</strong></div>
        <div class="project-quick-actions">
          ${canViewEmployees ? `<button class="quick-btn" type="button" data-project-roster="${item.id}" data-project-customer="${item.customerId}">查看在职员工</button>` : ''}
          ${canAssignOnsite ? `<button class="quick-btn" type="button" data-action="assign-onsite" data-project="${item.id}">派遣驻厂</button>` : ''}
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

function openProjectRoster(projectId) {
  if (!canRunOfficeAction('employees')) {
    toast('当前账号没有查看员工名单的权限', 'error');
    return;
  }
  const project = state.projects.find(item => Number(item.id) === Number(projectId));
  if (!project) {
    toast('未找到当前项目，请刷新后重试', 'error');
    return;
  }
  switchView('roster');
  $('#statusSelect').value = '2';
  $('#customerSelect').value = String(project.customerId || '');
  updateRosterProjectOptions(project.id);
  $('#projectSelect').value = String(project.id);
  loadEmployees().catch(error => toast(error.message, 'error'));
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

async function loadTalents(keyword = '') {
  setPanelLoading('#talentTableBody');
  try {
  const query = String(keyword || '').trim();
  state.talents = await api(`/api/talents${query ? `?keyword=${encodeURIComponent(query)}` : ''}`);
  const canCreateEmployee = (state.user?.permissions || []).includes('employee:create');
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
      <td>${canCreateEmployee && Number(item.availableStatus) !== 3 ? `<button class="table-button" type="button" data-talent-onboard="${item.id}">${item.employeeId ? '打开员工档案' : '转入员工录入'}</button>` : `<span class="muted">${canCreateEmployee ? '无需处理' : '只读'}</span>`}</td>
    </tr>
  `).join('') || emptyRow(10, '暂无人才数据', '未入职和完成离职的员工会自动流转到这里，也可快速录入招聘线索');
  } catch (error) {
    if (isSessionSupersededError(error)) throw error;
    state.talents = [];
    renderTableFailure('#talentTableBody', 10, '人才库加载失败', error, 'talents');
    throw error;
  } finally { setPanelLoaded('#talentTableBody'); }
}

function submitTalentSearch() {
  const input = $('#talentSearchInput');
  loadTalents(input?.value || '').catch(error => toast(error.message, 'error'));
}

async function openTalentOnboarding(talentId) {
  const talent = state.talents.find(item => Number(item.id) === Number(talentId));
  if (!talent) throw new Error('人才记录不存在，请刷新后重试');
  if (talent.employeeId) {
    return openExistingEmployeeRecord({
      canOpen: true,
      employeeId: talent.employeeId,
      employeeName: talent.name,
      employeeStatus: talent.employeeStatus,
      lifecycleStatus: talent.lifecycleStatus,
      customerName: talent.customerName,
      projectName: talent.projectName,
      canReactivate: [3, 5].includes(Number(talent.employeeStatus))
        && (state.user?.permissions || []).includes('employee:update')
    });
  }
  await openEmployeeModal();
  const form = $('#employeeForm');
  form.elements.selectedTalentId.value = String(talent.id);
  form.elements.name.value = talent.name || '';
  if (form.elements.channelSource && talent.recruitmentChannelName && talent.recruitmentChannelName !== '未填写渠道') {
    form.elements.channelSource.value = talent.recruitmentChannelName;
  }
  form.dataset.talentCheckKey = talentCheckKey({ name: talent.name });
  syncEmployeeFormRequirements(form, 6);
  toast('已带入人才信息，请补充本次录入资料', 'success');
}

async function loadRecruitmentSources() {
  setPanelLoading('#channelTableBody');
  try {
    const channels = await api('/api/recruitment-channels');
    state.recruitmentChannels = channels;
    const permissions = state.user?.permissions || [];
    const isCompanyAdmin = (state.user?.roles || []).some(role => role.roleCode === 'company_admin');
    const canEditChannels = isCompanyAdmin || permissions.includes('employee:update');
    const enabledChannels = channels.filter(item => Number(item.status) === 1);
    const channelOptions = enabledChannels.map(item => `<option value="${escapeHtml(item.channelName)}"></option>`).join('');
    ['#desktopRecruitmentChannelOptions', '#mobileRecruitmentChannelOptions'].forEach(selector => { if ($(selector)) $(selector).innerHTML = channelOptions; });
    const totalEmployees = channels.reduce((sum, item) => sum + Number(item.employeeCount || 0), 0);
    $('#channelSummary').innerHTML = `<span>启用 <strong>${enabledChannels.length}</strong></span><span>归档员工 <strong>${totalEmployees}</strong></span>`;
    $('#channelTableBody').innerHTML = channels.map(item => `<tr><td><strong>${escapeHtml(item.channelName)}</strong><small>${escapeHtml(item.remark || '员工登记渠道')}</small></td><td><strong>${item.employeeCount} 人</strong><small>在职 ${item.activeEmployeeCount} · ${escapeHtml(item.employeeNames || '暂无员工')}</small></td><td><strong>${item.customerCount} 家</strong><small>${escapeHtml(item.customerNames || '暂无客户单位')}</small></td><td>${escapeHtml(item.feeModes || '-')}</td><td>${badge(item.status === 1 ? '启用' : '停用', item.status === 1 ? 'green' : 'amber')}</td><td><button class="table-button" data-view-channel-employees="${item.id}">关联明细</button> ${canEditChannels ? `<button class="table-button" data-edit-channel="${item.id}">编辑</button>` : ''}</td></tr>`).join('') || emptyRow(6, '暂无招聘渠道', '新增员工时填写的渠道会自动沉淀到这里');
  } catch (error) {
    if (isSessionSupersededError(error)) throw error;
    state.recruitmentChannels = [];
    $('#channelSummary').innerHTML = '';
    renderTableFailure('#channelTableBody', 6, '招聘渠道加载失败', error, 'recruitmentSources');
    throw error;
  } finally {
    setPanelLoaded('#channelTableBody');
  }
}

async function openChannelEmployees(channelId) {
  const data = await api(`/api/recruitment-channels/${channelId}/employees`);
  $('#channelEmployeesTitle').textContent = `${data.channelName} · 关联员工`;
  const active = data.rows.filter(item => Number(item.employeeStatus) === 2).length;
  const customers = new Set(data.rows.map(item => item.customerName).filter(Boolean)).size;
  const feeModes = new Set(data.rows.map(item => item.feeMode).filter(Boolean)).size;
  $('#channelEmployeesSummary').innerHTML = `<span>员工 <strong>${data.rows.length}</strong></span><span>在职 <strong>${active}</strong></span><span>客户单位 <strong>${customers}</strong></span><span>费用模式 <strong>${feeModes}</strong></span>`;
  const statusNames = { 1: '待到岗', 2: '在职', 3: '离职', 4: '黑名单', 5: '未入职', 6: '面试' };
  $('#channelEmployeesBody').innerHTML = data.rows.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.customerName || '未分配')}</td><td>${escapeHtml(item.positionName || '-')}</td><td>${escapeHtml(item.feeMode || '-')}</td><td>${escapeHtml(item.hireDate || '-')}</td><td>${badge(statusNames[item.employeeStatus] || '未知', Number(item.employeeStatus) === 2 ? 'green' : Number(item.employeeStatus) === 1 ? 'amber' : 'neutral')}</td><td><button class="table-button" data-channel-employee-detail="${item.id}">查看员工</button></td></tr>`).join('') || emptyRow(7, '该渠道暂无权限范围内的关联员工');
  $('#channelEmployeesModal').showModal();
}

async function ensureRecruitmentChannelOptions() {
  if (!state.recruitmentChannels.length) {
    try {
      state.recruitmentChannels = await api('/api/recruitment-channels');
    } catch (error) {
      if (isSessionSupersededError(error)) throw error;
      console.warn('Recruitment channels unavailable:', error.message);
      toast('招聘渠道列表暂时无法加载，可直接手工填写', 'error');
      state.recruitmentChannels = [];
    }
  }
  const options = state.recruitmentChannels.filter(item => Number(item.status) === 1)
    .map(item => `<option value="${escapeHtml(item.channelName)}"></option>`).join('');
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

async function saveRecruitmentSource(form) {
  const body = formToObject(form);
  const id = Number(body.id || 0);
  delete body.id;
  const base = '/api/recruitment-channels';
  await api(id ? `${base}/${id}` : base, { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
  $('#channelModal').close();
  clearCache('/api/bootstrap');
  await Promise.all([loadRecruitmentSources(), loadBootstrap()]);
  toast('招聘渠道已保存', 'success');
}

async function loadAdvances() {
  setPanelLoading('#advanceTableBody');
  try {
  const month = $('#advanceMonthFilter')?.value || '';
  const result = await apiAllPages('/api/advances', month ? `month=${encodeURIComponent(month)}` : '');
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
  const summary = result.summary || {};
  $('#advanceKpis').innerHTML = [
    ['预支笔数', Number(summary.count || state.advances.length), 'neutral'],
    ['预支总额', money(summary.advanceAmount || 0), 'neutral'],
    ['已扣回', money(summary.recoveredAmount || 0), 'good'],
    ['未结余额', money(summary.outstandingAmount || 0), 'danger']
  ].map(([label, value, tone]) => `<article class="mini-kpi ${tone}"><span>${label}</span><strong>${value}</strong></article>`).join('');
  const canApprove = (state.user?.permissions || []).includes('advance:approve');
  const canPay = (state.user?.permissions || []).includes('advance:pay');
  $('#advanceTableBody').innerHTML = state.advances.map(item => {
    const actions = item.status === 'PENDING_APPROVAL' && canApprove
      ? `<button class="table-button" data-action="approve-advance" data-id="${item.id}">审批通过</button>`
      : item.status === 'APPROVED' && canPay ? `<button class="table-button" data-action="pay-advance" data-id="${item.id}">登记放款</button>` : '-';
    return `<tr><td><strong>${escapeHtml(item.advanceAtText)}</strong><small>${escapeHtml(item.advanceNo)}</small></td><td><strong>${escapeHtml(item.employeeName)}</strong></td><td><strong>${escapeHtml(item.customerName || '-')}</strong><small>${escapeHtml(item.projectName || '暂未关联具体项目')}</small></td><td><strong>${money(item.applyAmount)}</strong></td><td>${escapeHtml(item.applyReason || '-')}</td><td>${escapeHtml(item.recordedByName)}</td><td><strong class="money-risk">${money(item.outstandingAmount)}</strong></td><td>${badge(item.statusName, item.status === 'PENDING_APPROVAL' ? 'amber' : item.status === 'REJECTED' ? 'red' : 'green')}</td><td>${actions}</td></tr>`;
  }).join('') || emptyRow(9, '暂无预支记录', '可切换月份查看历史台账，或点击“登记预支”新增记录');
  $('#advanceEmployeeSelect').innerHTML = activeEmployeeOptionHtml();
  } catch (error) {
    if (isSessionSupersededError(error)) throw error;
    state.advances = [];
    $('#advanceKpis').innerHTML = '';
    renderTableFailure('#advanceTableBody', 9, '预支台账加载失败', error, 'advances');
    throw error;
  } finally { setPanelLoaded('#advanceTableBody'); }
}

async function submitSimpleForm(form, path, successMessage, modalId, reload) {
  const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
  return withSubmitLock(submitButton, async () => {
    await api(path, { method: 'POST', body: JSON.stringify(formToObject(form)) });
    $(`#${modalId}`).close();
    form.reset();
    toast(successMessage);
    await reload();
    await loadSummary();
  });
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
  ['待到岗确认', '确认入职或标记未入职', '待', 'cyan', 'pending-arrival'],
  ['在职员工', '查看与管理员工档案', '人', 'green', 'employees'],
  ['客户项目', '客户、项目与驻厂关联', '客', 'cyan', 'projects'],
  ['人才库', '候选人与离职回流', '才', 'gold', 'talents'],
  ['招聘渠道', '渠道与员工来源关联', '渠', 'orange', 'recruitment-sources']
];

const officeFinanceActions = [
  ['登记预支', '记录时间、金额和用途', '记', 'blue', 'advance-create'],
  ['预支台账', '按客户查看现场记录', '账', 'cyan', 'advances'],
  ['工资条发放', '发放、撤回与签收管理', '薪', 'orange', 'payroll']
];

const officeActionPermissions = {
  'employee-create': ['employee:create'],
  'employee-arrange': ['project:view'],
  'interviews': ['employee:view'],
  'pending-arrival': ['employee:view'],
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
  'payroll-create': ['payroll:manage'],
  'recruitment-sources': ['employee:view']
};

function openRosterStatus(status) {
  switchView('roster');
  const select = $('#statusSelect');
  if (select) select.value = String(status ?? '');
  return loadEmployees().catch(error => toast(error.message, 'error'));
}

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
  notices = notices.filter(item => !/合同|雇主险|保险减员/.test(`${item.category || ''} ${item.title || ''}`));
  const workforce = data.workforce || {};
  const finance = data.finance || {};
  const delivery = data.delivery || {};
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
  const lifecycleRows = [
    ['面试', workforce.interview || 0, 6, '登记候选人'],
    ['待到岗', workforce.pendingArrival || 0, 1, '确认入职'],
    ['在职', workforce.active || 0, 2, '日常管理'],
    ['未入职', workforce.notJoined || 0, 5, '回流人才库'],
    ['已离职', workforce.left || 0, 3, '历史档案']
  ];
  $('#officeLifecycleFlow').innerHTML = lifecycleRows.map(([label, value, status, note], index) => `
    <button type="button" class="office-lifecycle-step" data-lifecycle-status="${status}">
      <span>${String(index + 1).padStart(2, '0')}</span>
      <strong>${label}<b>${value}</b></strong>
      <small>${note}</small>
    </button>
  `).join('');
  const pulseRows = (rows) => rows.map(([label, value, tone = '']) => `<span class="pulse-row ${tone}"><i>${label}</i><b>${value}</b></span>`).join('');
  const pulseCard = (heroLabel, heroValue, heroTone, rows) => `
    <div class="pulse-hero ${heroTone}"><span>${heroLabel}</span><strong>${heroValue}</strong></div>
    <div class="pulse-stats-list">${pulseRows(rows)}</div>
  `;
  $('#projectDeliveryPulse').innerHTML = pulseCard(
    '在营项目', delivery.activeProjects || 0, delivery.activeProjects ? 'good' : 'warning',
    [
      ['当前在岗', delivery.onsiteEmployees || 0],
      ['人才储备', workforce.talents || 0],
      ['预支未结', money(finance.advanceOutstanding || 0)]
    ]
  );
  renderOfficeActions('#employeeOfficeGrid', officeEmployeeActions);
  renderOfficeActions('#financeOfficeGrid', officeFinanceActions);
  $('#officeNotices').innerHTML = notices.length
    ? notices.map(item => item.targetView
      ? `<button type="button" class="office-notice-item" data-notice-view="${escapeHtml(item.targetView)}"><span>${escapeHtml(item.category)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.time)}</small></button>`
      : `<article><span>${escapeHtml(item.category)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.time)}</small></article>`).join('')
    : '<article><span>系统通知</span><strong>暂无新的业务消息</strong><small>业务操作后将自动生成</small></article>';
  } finally { setPanelLoaded('#officeView'); }
}

function payrollBatchActions(item) {
  const permissions = state.user?.permissions || [];
  const canManage = permissions.includes('payroll:manage');
  const canReview = permissions.includes('payroll:review');
  let flowAction = '<span class="muted">等待下一环节</span>';
  if (item.status === 'PUBLISHED' && canManage && item.canWithdraw) {
    flowAction = `<button class="table-button danger" type="button" data-withdraw-payroll="${item.id}">撤回</button>`;
  } else if (item.status === 'PUBLISHED' && canManage && item.withdrawBlockedReason) {
    flowAction = `<span class="muted payroll-withdraw-blocked">${escapeHtml(item.withdrawBlockedReason)}</span>`;
  } else if (item.status === 'PUBLISHED') flowAction = '<span class="muted">已发放</span>';
  else if (Number(item.batchStatus) === 1 && canManage) flowAction = `<button class="table-button" type="button" data-submit-payroll="${item.id}">提交复核</button>`;
  else if (Number(item.batchStatus) === 3 && canReview) flowAction = `<button class="table-button" type="button" data-review-payroll="${item.id}" data-approved="1">复核通过</button> <button class="table-button" type="button" data-review-payroll="${item.id}" data-approved="0">退回</button>`;
  else if (Number(item.batchStatus) === 4 && canManage) flowAction = `<button class="table-button" type="button" data-publish-payroll="${item.id}">发布工资条</button>`;
  return `<div class="payroll-row-actions"><button class="table-button" type="button" data-payroll-batch-detail="${item.id}">发放详情</button>${flowAction}</div>`;
}

function payrollBatchProgress(item) {
  const employeeCount = Number(item.employeeCount || 0);
  const viewedCount = Math.min(employeeCount, Number(item.viewedCount || 0));
  const signedCount = Math.min(employeeCount, Number(item.signedCount || 0));
  return {
    viewRate: employeeCount ? Math.round((viewedCount / employeeCount) * 100) : 0,
    signRate: employeeCount ? Math.round((signedCount / employeeCount) * 100) : 0,
    viewedCount,
    signedCount
  };
}

function switchPayrollWorkspace(workspace = 'overview') {
  const target = ['overview', 'records', 'disputes'].includes(workspace) ? workspace : 'overview';
  state.payrollWorkspace = target;
  $$('[data-payroll-workspace-tab]').forEach(button => {
    const active = button.dataset.payrollWorkspaceTab === target;
    button.classList.toggle('active', active);
    if (button.getAttribute('role') === 'tab') button.setAttribute('aria-selected', String(active));
  });
  $$('[data-payroll-workspace-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.payrollWorkspacePanel !== target));
}

function renderPayrollOverview(data = state.payrollOverviewData || { batches: [] }) {
  const batches = data.batches || [];
  const employeeCount = Number(data.employeeTotal || 0);
  const viewedCount = Number(data.viewedTotal || 0);
  const signedCount = Number(data.signedTotal || 0);
  $('#payrollKpis').innerHTML = [
    ['计薪人数', employeeCount, 'neutral'], ['已查看', viewedCount, 'good'],
    ['已签收', signedCount, 'good'], ['待签收', data.unsignedTotal || 0, Number(data.unsignedTotal) ? 'danger' : 'good']
  ].map(([label, value, tone]) => `<article class="mini-kpi ${tone}"><span>${label}</span><strong>${value}</strong></article>`).join('');

  $('#payrollRecentBatches').innerHTML = batches.slice(0, 6).map(item => {
    const progress = payrollBatchProgress(item);
    return `<article class="payroll-recent-row"><div><span>${escapeHtml(item.salaryMonth)}</span><strong>${escapeHtml(item.projectName || '未关联项目')}</strong><small>${item.employeeCount || 0} 人 · ${escapeHtml(item.statusName)}</small></div><div class="payroll-recent-progress"><span>查看 ${progress.viewedCount}/${item.employeeCount || 0}</span><div class="payroll-progress-track"><i style="width:${progress.viewRate}%"></i></div><span>签收 ${progress.signedCount}/${item.employeeCount || 0}</span><div class="payroll-progress-track signed"><i style="width:${progress.signRate}%"></i></div></div><button class="table-button" type="button" data-payroll-batch-detail="${item.id}">详情</button></article>`;
  }).join('') || '<div class="empty-panel"><strong>暂无工资批次</strong><small>导入工资表后会显示在这里</small></div>';

  const pendingPublish = Number(data.pendingBatchCount || 0);
  const failed = batches.reduce((sum, item) => sum + Number(item.deliveryFailedCount || 0), 0);
  const unread = Math.max(0, employeeCount - viewedCount);
  const unsigned = Number(data.unsignedTotal || 0);
  const disputes = (state.payrollDisputes || []).filter(item => [0, 1].includes(Number(item.handleStatus))).length;
  $('#payrollOverviewTasks').innerHTML = [
    ['待处理批次', pendingPublish, 'pending', '草稿、复核和待发放统一查看'], ['发送失败', failed, 'failed', '需检查手机号或短信状态'],
    ['员工未查看', unread, 'unread', '可进入记录查看并催签'], ['员工待签收', unsigned, 'unsigned', '已查看但尚未确认'],
    ['待处理异议', disputes, 'disputes', '需薪资专员核对处理']
  ].map(([label, value, filter, note]) => `<button type="button" data-payroll-record-filter="${filter}"><span>${label}</span><strong>${value}</strong><small>${note}</small></button>`).join('');
}

function payrollRecordMatches(item) {
  if (state.payrollRecordMonth && item.salaryMonth !== state.payrollRecordMonth) return false;
  if (state.payrollRecordFilter === 'published') return item.status === 'PUBLISHED';
  const pendingBatchStatuses = new Set([1, 2, 3, 4]);
  if (state.payrollRecordFilter === 'pending') return pendingBatchStatuses.has(Number(item.batchStatus));
  if (state.payrollRecordFilter === 'failed') return Number(item.deliveryFailedCount || 0) > 0;
  if (state.payrollRecordFilter === 'unsigned') return Number(item.unsignedCount || 0) > 0;
  if (state.payrollRecordFilter === 'unread') return item.status === 'PUBLISHED' && Number(item.viewedCount || 0) < Number(item.employeeCount || 0);
  return true;
}

function renderPayrollRecords(data = state.payrollOverviewData || { batches: [] }) {
  const batches = (data.batches || []).filter(payrollRecordMatches);
  const groups = batches.reduce((result, item) => {
    const month = item.salaryMonth || '未设置月份';
    if (!result[month]) result[month] = [];
    result[month].push(item);
    return result;
  }, {});
  $('#payrollRecordSummary').textContent = `共 ${batches.length} 个批次`;
  $('#payrollRecordsGroups').innerHTML = Object.entries(groups).sort(([left], [right]) => right.localeCompare(left)).map(([month, items]) => `
    <section class="payroll-record-month"><div class="payroll-record-month-head"><strong>${escapeHtml(month)}</strong><span>${items.length} 个批次 · ${items.reduce((sum, item) => sum + Number(item.employeeCount || 0), 0)} 人</span></div><div class="payroll-record-list">${items.map(item => {
      const progress = payrollBatchProgress(item);
      const expiry = item.viewExpiresMinutes == null ? '不限时' : item.viewExpiresMinutes < 1440 ? `${item.viewExpiresMinutes}分钟` : `${Math.round(item.viewExpiresMinutes / 1440)}天`;
      return `<article class="payroll-record-card"><div class="payroll-record-title"><div><strong>${escapeHtml(item.projectName || '未关联项目')}</strong><small>${escapeHtml(item.batchNo)}</small></div>${badge(item.statusName, item.status === 'PUBLISHED' ? 'green' : 'blue')}</div><div class="payroll-record-metrics"><span><small>计薪人数</small><strong>${item.employeeCount || 0}人</strong></span><span><small>应发工资</small><strong>${money(item.grossTotal)}</strong></span><span><small>实发工资</small><strong>${money(item.netTotal)}</strong></span><span><small>有效查看</small><strong>${expiry}</strong></span></div><div class="payroll-record-progress"><div><span>员工已查看 ${progress.viewedCount}/${item.employeeCount || 0}</span><strong>${progress.viewRate}%</strong></div><div class="payroll-progress-track"><i style="width:${progress.viewRate}%"></i></div><div><span>员工已签收 ${progress.signedCount}/${item.employeeCount || 0}</span><strong>${progress.signRate}%</strong></div><div class="payroll-progress-track signed"><i style="width:${progress.signRate}%"></i></div></div><div class="payroll-record-footer"><span>发放成功 ${item.deliverySuccessCount || 0} 人 · 发放失败 ${item.deliveryFailedCount || 0} 人</span>${payrollBatchActions(item)}</div></article>`;
    }).join('')}</div></section>`).join('') || '<div class="empty-panel"><strong>暂无符合条件的发放记录</strong><small>可调整工资月份或状态筛选</small></div>';
}

async function loadPayrollOverview() {
  setPanelLoading('#payrollView');
  try {
    const data = await api('/api/payroll/overview');
    state.payrollOverviewData = data;
    renderPayrollOverview(data);
    renderPayrollRecords(data);
  } finally { setPanelLoaded('#payrollView'); }
}

function payrollDisputeTone(status) {
  return { 0: 'amber', 1: 'blue', 2: 'green', 3: 'red' }[Number(status)] || 'blue';
}

async function loadPayrollDisputes() {
  setPanelLoading('#payrollDisputeTableBody');
  try {
    const handleStatus = encodeURIComponent($('#payrollDisputeStatusFilter')?.value ?? '0');
    const result = await api(`/api/payroll/disputes?handleStatus=${handleStatus}&page=1&pageSize=50`);
    state.payrollDisputes = result.list || [];
    const openCount = state.payrollDisputes.filter(item => [0, 1].includes(Number(item.handleStatus))).length;
    $('#payrollDisputeSummary').textContent = `当前列表 ${result.total || 0} 项 · 待推进 ${openCount} 项`;
    const canManage = (state.user?.permissions || []).includes('payroll:manage');
    $('#payrollDisputeTableBody').innerHTML = state.payrollDisputes.map(item => {
      const action = [0, 1].includes(Number(item.handleStatus)) && canManage
        ? `<button class="table-button" type="button" data-handle-payroll-dispute="${item.id}">立即处理</button>`
        : '<span class="muted">已完成</span>';
      return `<tr><td><strong>${escapeHtml(item.employeeName)}</strong></td><td>${escapeHtml(item.salaryMonth)}</td><td>${escapeHtml(item.customerName || '-')}<small>${escapeHtml(item.projectName || '-')}</small></td><td><strong>${money(item.netAmount)}</strong></td><td class="payroll-dispute-reason">${escapeHtml(item.disputeReason)}</td><td>${badge(item.handleStatusName, payrollDisputeTone(item.handleStatus))}</td><td>${escapeHtml(item.handleRemark || '-')}<small>${escapeHtml(item.handlerName || '')}</small></td><td>${action}</td></tr>`;
    }).join('') || emptyRow(8, '暂无工资异议', '员工提交工资异议后会显示在这里');
  } finally {
    setPanelLoaded('#payrollDisputeTableBody');
  }
}

async function loadPayroll() {
  await Promise.all([loadPayrollOverview(), loadPayrollDisputes()]);
  renderPayrollOverview();
}

function payrollDetailTone(status) {
  return { 未发布: 'blue', 未发放: 'blue', 发放成功: 'green', 发放失败: 'red', 待查看: 'amber', 待签字: 'amber', 已签收: 'green', 有异议: 'red' }[status] || 'blue';
}

function renderPayrollSmsSummary(summary, progress = {}) {
  const data = summary || { total: 0, pending: 0, sent: 0, failed: 0, skippedNoPhone: 0, items: [] };
  const retryableCount = Number(data.retryableCount || 0);
  const remindableCount = Number(progress.pendingViewCount || 0) + Number(progress.pendingSignCount || 0);
  const retryButton = $('[data-payroll-sms-action="retry"]');
  const remindButton = $('[data-payroll-sms-action="remind"]');
  if (retryButton) {
    retryButton.disabled = Boolean(state.payrollSmsBusy) || retryableCount === 0;
    retryButton.textContent = retryableCount ? `补发失败短信（${retryableCount}）` : '无可补发短信';
  }
  if (remindButton) {
    const batchStatus = Number(state.payrollBatchDetail?.batch?.batchStatus || 0);
    const batchPublished = batchStatus === 5;
    remindButton.disabled = Boolean(state.payrollSmsBusy) || !batchPublished || remindableCount === 0;
    remindButton.textContent = !batchPublished
      ? '批次未发布'
      : remindableCount
      ? `催签未签收员工（${remindableCount}）`
      : '全部已签收';
  }
  $('#payrollSmsSummary').innerHTML = [
    ['任务总数', data.total || 0],
    ['待发送', data.pending || 0],
    ['已发送', data.sent || 0],
    ['失败', data.failed || 0],
    ['无手机号', data.skippedNoPhone || 0]
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');
  $('#payrollSmsList').innerHTML = (data.items || []).slice(0, 12).map(item => `
    <div class="payroll-sms-item">
      <strong>${escapeHtml(item.employeeName || '-')}</strong>
      <span>****${escapeHtml(item.phoneTail || '----')}</span>
      <span>${escapeHtml(item.deliveryStatusName || '-')}</span>
      <small>${escapeHtml(item.errorSummary || item.lastAttemptAt || '-')}</small>
    </div>`).join('') || '<p class="muted">暂无短信发送记录</p>';
}

const payrollDetailStatusLabels = {
  all: '全部',
  pending: '待送达',
  unviewed: '已送达未查看',
  viewed_unsigned: '已查看未签收',
  signed: '已签收',
  dispute: '员工反馈',
  failed: '发送失败',
  withdrawn: '已撤回'
};

function renderPayrollBatchStatusTabs(rows) {
  const counts = PayrollWorkbench.countStatuses(rows);
  $('#payrollBatchProgress').innerHTML = Object.entries(payrollDetailStatusLabels).map(([key, label]) => `
    <button type="button" role="tab" class="payroll-status-tab ${state.payrollDetailFilter === key ? 'active' : ''}"
      aria-selected="${state.payrollDetailFilter === key}" data-payroll-detail-filter="${key}">
      <span>${label}</span><strong>${counts[key] || 0}</strong>
    </button>`).join('');
}

function renderPayrollBatchEmployeeRows() {
  const detail = state.payrollBatchDetail || {};
  const rows = detail.list || [];
  renderPayrollBatchStatusTabs(rows);
  const visibleRows = PayrollWorkbench.filterRows(rows, {
    status: state.payrollDetailFilter,
    keyword: state.payrollDetailKeyword
  });
  const activeLabel = payrollDetailStatusLabels[state.payrollDetailFilter] || '全部';
  $('#payrollBatchVisibleSummary').textContent = `${activeLabel} · 当前显示 ${visibleRows.length} 人${state.payrollDetailKeyword ? ` · 搜索“${state.payrollDetailKeyword}”` : ''}`;
  $('#payrollBatchEmployeeBody').innerHTML = visibleRows.map(item => {
    const smsNote = item.smsErrorSummary
      ? `<small class="payroll-delivery-error" title="${escapeHtml(item.smsErrorSummary)}">${escapeHtml(item.smsErrorSummary)}</small>`
      : '';
    const signatureInfo = item.signaturePreviewUrl
      ? `<div class="payroll-signature-cell"><strong>${escapeHtml(item.signedName || '已签名')}</strong><button class="table-button" type="button" data-view-payroll-signature="${item.id}" data-signed-name="${escapeHtml(item.signedName || item.employeeName)}" data-signed-at="${escapeHtml(item.signedAt || '')}">查看签名</button></div>`
      : '<span class="muted">暂无签名</span>';
    const feedback = item.displayStatus === '有异议'
      ? '<span class="payroll-feedback-state has-feedback">待处理反馈</span>'
      : '<span class="payroll-feedback-state">无反馈</span>';
    const itemsHtml = (item.items && item.items.length)
      ? `<details class="payroll-items-detail"><summary>${item.items.length} 项</summary><div class="payroll-items-list">${item.items.map(entry => `<div class="payroll-item-row"><span>${escapeHtml(entry.label)}</span><strong>${escapeHtml(String(entry.value ?? ''))}</strong></div>`).join('')}</div></details>`
      : '<span class="muted">无</span>';
    const amountWarningHtml = item.hasAmountWarning && Array.isArray(item.amountWarnings)
      ? `<details class="payroll-amount-warning"><summary>金额异常</summary><ul>${item.amountWarnings.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul></details>`
      : '';
    return `<tr>
      <td><strong>${escapeHtml(item.employeeName)}</strong><small>${escapeHtml(item.deptName || '未关联部门')} · ${escapeHtml(item.phoneMasked || '手机号未登记')}</small></td>
      <td><span class="payroll-amount-pair"><small>应发 ${money(item.grossAmount)}</small><strong>实发 ${money(item.netAmount)}</strong></span>${amountWarningHtml}</td>
      <td>${itemsHtml}</td>
      <td><div class="payroll-channel-stack"><span class="payroll-bind-state ${item.wechatBound ? 'bound' : 'unbound'}">微信${item.wechatBound ? '已绑定' : '未绑定'}</span><span class="payroll-sms-state">短信 · ${escapeHtml(item.smsStatusName || '未创建通知')}</span>${smsNote}</div></td>
      <td>${badge(item.deliveryStatus, payrollDetailTone(item.deliveryStatus))}</td>
      <td><div class="payroll-receipt-stack">${badge(item.viewed ? '已查看' : '未查看', item.viewed ? 'blue' : 'amber')}${badge(item.displayStatus, payrollDetailTone(item.displayStatus))}</div></td>
      <td>${feedback}</td>
      <td>${signatureInfo}</td>
      <td><span class="payroll-time-cell"><small>查看/签收</small><strong>${escapeHtml(item.receiptAt || item.signedAt || '-')}</strong></span></td>
    </tr>`;
  }).join('') || emptyRow(9, '没有符合条件的员工', '可切换状态页签或重置搜索条件');
}

async function exportPayrollBatchDetail(type) {
  const batch = state.payrollBatchDetail?.batch;
  if (!batch?.id) throw new Error('工资批次信息无效，请重新打开详情');
  const ext = type === 'receipt' ? 'pdf' : 'csv';
  const requestSessionVersion = state.sessionVersion;
  const response = await fetch(`/api/payroll/batches/${batch.id}/${type}-export.${ext}`, {
    credentials: 'same-origin',
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
  });
  assertCurrentSession(requestSessionVersion);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || '工资条记录导出失败');
  }
  const suffix = type === 'receipt' ? '签收记录' : '发放明细';
  const blob = await response.blob();
  assertCurrentSession(requestSessionVersion);
  triggerBlobDownload(blob, `${batch.salaryMonth || '工资条'}-${suffix}.${ext}`);
  toast(`${suffix}已导出`, 'success');
}

async function openPayrollBatchDetail(batchId, page = 1) {
  const modal = $('#payrollBatchDetailModal');
  if (!modal.open) modal.showModal();
  if (Number(state.payrollBatchDetail?.batch?.id || 0) !== Number(batchId)) {
    state.payrollDetailFilter = 'all';
    state.payrollDetailKeyword = '';
    $('#payrollBatchEmployeeSearch').value = '';
  }
  setPanelLoading('#payrollBatchEmployeeBody');
  try {
    const [result, smsSummary] = await Promise.all([
      api(`/api/payroll/batches/${batchId}/details?page=${page}&pageSize=100`),
      api(`/api/payroll/batches/${batchId}/sms-summary`, { context: '加载短信发送状态' }).catch(error => {
        if (isSessionSupersededError(error)) throw error;
        toast(`工资批次已加载，但短信状态加载失败：${error.message}`, 'error');
        return null;
      })
    ]);
    state.payrollBatchDetail = result;
    state.payrollBatchDetail.smsSummary = smsSummary;
    const { batch, progress } = result;
    renderPayrollSmsSummary(smsSummary, progress);
    $('#payrollBatchDetailMonth').textContent = batch.salaryMonth || '-';
    $('#payrollBatchDetailProject').textContent = `${batch.customerName || '-'} / ${batch.projectName || '-'}`;
    $('#payrollBatchDetailNo').textContent = batch.batchNo || '-';
    $('#payrollBatchDetailNet').textContent = money(batch.netTotal);
    $('#payrollBatchDetailStatus').textContent = batch.statusName || '-';
    $('#payrollDetailEmployeeView').value = String(batch.employeeViewEnabled ?? 1);
    $('#payrollDetailViewOnce').value = String(batch.viewOnce || 0);
    $('#payrollDetailViewExpires').value = batch.viewExpiresMinutes == null ? '' : String(batch.viewExpiresMinutes);
    const policyButton = $('#payrollSaveViewPolicy');
    if (policyButton) policyButton.disabled = Number(batch.batchStatus) > 4;
    renderPayrollBatchEmployeeRows();
    const pageCount = Math.max(1, Math.ceil(Number(result.total || 0) / Number(result.pageSize || 100)));
    $('#payrollBatchDetailPager').innerHTML = pageCount > 1
      ? `<button type="button" class="secondary-button" data-payroll-detail-page="${Math.max(1, result.page - 1)}" ${result.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${result.page} / ${pageCount} 页</span><button type="button" class="secondary-button" data-payroll-detail-page="${Math.min(pageCount, result.page + 1)}" ${result.page >= pageCount ? 'disabled' : ''}>下一页</button>`
      : `<span>共 ${result.total || 0} 名员工</span>`;
  } catch (error) {
    if (isSessionSupersededError(error)) throw error;
    $('#payrollBatchEmployeeBody').innerHTML = emptyRow(8, '批次详情加载失败', escapeHtml(error.message));
    throw error;
  } finally {
    setPanelLoaded('#payrollBatchEmployeeBody');
  }
}

async function savePayrollViewPolicy() {
  const batchId = Number(state.payrollBatchDetail?.batch?.id || 0);
  if (!batchId) return;
  const employeeViewEnabled = Number($('#payrollDetailEmployeeView').value);
  const viewOnce = Number($('#payrollDetailViewOnce').value);
  if (viewOnce === 1 && employeeViewEnabled !== 1) throw new Error('阅后即焚必须先开启员工端查看权限');
  await api(`/api/payroll/batches/${batchId}/view-policy`, {
    method: 'PUT',
    body: JSON.stringify({ employeeViewEnabled, viewOnce, viewExpiresMinutes: $('#payrollDetailViewExpires').value ? Number($('#payrollDetailViewExpires').value) : null })
  });
  toast('工资条查看策略已保存', 'success');
  await openPayrollBatchDetail(batchId);
}

async function withdrawPayrollBatch(batchId) {
  const reason = window.prompt('请输入撤回原因（5-200字）');
  if (reason === null) return;
  const normalizedReason = String(reason).trim();
  if (normalizedReason.length < 5 || normalizedReason.length > 200) {
    throw new Error('撤回原因需填写5至200字');
  }
  const confirmed = await confirmDialog({
    title: '确认撤回工资条',
    message: '撤回后，该批次全部工资条将暂时无法在员工端查看，历史审计记录仍会保留。',
    confirmText: '确认撤回',
    danger: true
  });
  if (!confirmed) return;
  await api(`/api/payroll/batches/${batchId}/withdraw`, {
    method: 'PUT',
    body: JSON.stringify({ confirmed: true, reason: normalizedReason })
  });
  toast('工资条已撤回至待发放', 'success');
  await Promise.all([loadPayroll(), loadOffice()]);
}

async function openPayrollSignature(payslipId, signedName, signedAt) {
  const requestSessionVersion = state.sessionVersion;
  const response = await fetch(`/api/payroll/payslips/${payslipId}/signature`, {
    credentials: 'same-origin',
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
  });
  assertCurrentSession(requestSessionVersion);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    if (response.status === 401) {
      const message = payload?.message || '登录已过期，请重新登录';
      rememberAuthMessage(message);
      logout(false, false);
      setLoginError(message);
    }
    throw new Error(payload?.message || '员工签名加载失败');
  }
  const blob = await response.blob();
  assertCurrentSession(requestSessionVersion);
  if (state.payrollSignatureObjectUrl) URL.revokeObjectURL(state.payrollSignatureObjectUrl);
  state.payrollSignatureObjectUrl = URL.createObjectURL(blob);
  $('#payrollSignatureImage').src = state.payrollSignatureObjectUrl;
  $('#payrollSignatureEmployee').textContent = signedName || '员工已签名';
  $('#payrollSignatureTime').textContent = signedAt || '-';
  $('#payrollSignatureModal').showModal();
}

async function handlePayrollSmsAction(action) {
  if (state.payrollSmsBusy) return;
  const batchId = Number(state.payrollBatchDetail?.batch?.id || 0);
  if (!batchId) return;
  const reminder = action === 'remind';
  const confirmed = await confirmDialog({
    title: reminder ? '发送工资条催签提醒' : '重试工资条短信',
    message: reminder
      ? '确认向该批次尚未签收的员工创建催签短信任务？'
      : '确认重试该批次发送失败或原无手机号的短信？',
    confirmText: reminder ? '确认催签' : '确认重试'
  });
  if (!confirmed) return;
  state.payrollSmsBusy = true;
  const buttons = $$('[data-payroll-sms-action]');
  buttons.forEach(button => { button.disabled = true; });
  try {
    const url = reminder
      ? `/api/payroll/batches/${batchId}/sms-reminders`
      : `/api/payroll/batches/${batchId}/sms-retry`;
    const result = await api(url, {
      method: 'POST', body: JSON.stringify({ confirmed: true })
    });
    toast(reminder
      ? `催签任务已创建：${result.created || 0}条`
      : `已重置${result.queued || 0}条补发任务`, 'success');
    const summary = await api(`/api/payroll/batches/${batchId}/sms-summary`);
    state.payrollBatchDetail.smsSummary = summary;
    renderPayrollSmsSummary(summary, state.payrollBatchDetail?.progress);
  } finally {
    state.payrollSmsBusy = false;
    renderPayrollSmsSummary(
      state.payrollBatchDetail?.smsSummary,
      state.payrollBatchDetail?.progress
    );
  }
}

function openPayrollDispute(disputeId) {
  const item = state.payrollDisputes.find(row => Number(row.id) === Number(disputeId));
  if (!item) return;
  $('#payrollDisputeId').value = item.id;
  $('#payrollDisputeEmployee').textContent = item.employeeName || '-';
  $('#payrollDisputeMonth').textContent = item.salaryMonth || '-';
  $('#payrollDisputeProject').textContent = `${item.customerName || '-'} / ${item.projectName || '-'}`;
  $('#payrollDisputeNet').textContent = money(item.netAmount);
  $('#payrollDisputeReason').textContent = item.disputeReason || '-';
  $('#payrollDisputeRemark').value = item.handleRemark || '';
  $('#payrollDisputeModal').showModal();
}

async function handlePayrollDisputeAction(action) {
  const disputeId = Number($('#payrollDisputeId').value || 0);
  const remark = String($('#payrollDisputeRemark').value || '').trim();
  if (!disputeId) throw new Error('工资异议记录无效，请刷新后重试');
  if (remark.length < 5 || remark.length > 500) throw new Error('处理说明需填写5至500字');
  const actionNames = { processing: '标记为处理中', resolve: '确认已经解决', reject: '核对后驳回' };
  if (!actionNames[action]) throw new Error('工资异议处理操作无效');
  if (action === 'resolve' || action === 'reject') {
    const confirmed = await confirmDialog({
      title: actionNames[action],
      message: '完成后员工工资条将恢复为待签收状态。',
      confirmText: actionNames[action],
      danger: action === 'reject'
    });
    if (!confirmed) return;
  }
  await api(`/api/payroll/disputes/${disputeId}/handle`, {
    method: 'PUT',
    body: JSON.stringify({ action, remark })
  });
  $('#payrollDisputeModal').close();
  toast('工资异议处理完成', 'success');
  return loadPayroll();
}

function resetPayrollImport(options = {}) {
  const templates = state.payrollImport.templates || [];
  state.payrollImport = {
    sourceRows: [], headers: [], header: null, headerSignature: '', suggestedMapping: [], mapping: [],
    mappingRequired: false, parsedRows: [], preview: null, fileName: '', sheetName: '',
    templates, activeTemplateId: 0
  };
  const preview = $('#payrollImportPreview');
  const summary = $('#payrollImportSummary');
  const body = $('#payrollImportPreviewBody');
  const fileName = $('#payrollFileName');
  const confirmButton = $('#payrollConfirmButton');
  const mappingPanel = $('#payrollMappingPanel');
  if (preview) preview.classList.add('hidden');
  if (summary) summary.innerHTML = '';
  if (body) body.innerHTML = '';
  if (fileName) fileName.textContent = '';
  if (confirmButton) confirmButton.disabled = true;
  if (mappingPanel) {
    mappingPanel.classList.add('hidden');
    mappingPanel.classList.remove('needs-review');
    mappingPanel.open = false;
  }
  if ($('#payrollMappingRows')) $('#payrollMappingRows').innerHTML = '';
  if (!options.keepResult) {
    $('#payrollBatchResult')?.classList.add('hidden');
    if ($('#payrollBatchResult')) $('#payrollBatchResult').innerHTML = '';
  }
}

const payrollMappingChoices = [
  ['employeeName', '员工姓名'], ['employeeNo', '工号'], ['idCardNo', '身份证号'], ['phone', '手机号'],
  ['baseSalary', '基本工资'], ['positionSalary', '岗位工资'], ['performanceSalary', '绩效工资'],
  ['allowanceAmount', '补贴'], ['pieceAmount', '计件工资'], ['overtime15Amount', '1.5倍加班费'],
  ['overtime20Amount', '2倍加班费'], ['overtime30Amount', '3倍加班费'], ['grossAmount', '应发工资'],
  ['socialDeduction', '社保扣款'], ['taxDeduction', '个税'], ['advanceDeduction', '预支扣回'],
  ['otherDeduction', '其他扣款'], ['netAmount', '实发工资'], ['custom:income', '收入项目'],
  ['custom:deduction', '扣款项目'], ['custom:display', '展示项'], ['ignore', '不导入']
];

async function payrollHeaderSignature(headers) {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持工资表安全签名，请升级浏览器');
  const normalized = (headers || []).map(header => PayrollImport.normalizeHeader(header)).join('\u001f');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function loadPayrollTemplates(projectId) {
  const projectIdNum = Number(projectId);
  if (!Number.isSafeInteger(projectIdNum) || projectIdNum <= 0) {
    state.payrollImport.templates = [];
    renderPayrollTemplateSelect();
    return;
  }
  const data = await api(`/api/payroll/templates?projectId=${projectIdNum}`);
  state.payrollImport.templates = (data && data.list) || [];
  renderPayrollTemplateSelect();
}

function renderPayrollTemplateSelect() {
  const select = $('#payrollTemplateSelect');
  if (!select) return;
  const templates = state.payrollImport.templates || [];
  const options = [
    '<option value="0">默认（自动识别）</option>',
    ...templates.map(template => `<option value="${template.id}">${escapeHtml(template.name)}</option>`)
  ].join('');
  const current = String(state.payrollImport.activeTemplateId || 0);
  select.innerHTML = options;
  select.value = current;
}

function applyPayrollTemplate(templateId) {
  const id = Number(templateId) || 0;
  state.payrollImport.activeTemplateId = id;
  if (!id || !state.payrollImport.headers.length) return;
  const template = (state.payrollImport.templates || []).find(item => Number(item.id) === id);
  if (!template) return;
  const mapping = PayrollColumnMapping.applyTemplateMapping(
    template,
    state.payrollImport.headers,
    state.payrollImport.suggestedMapping
  );
  try {
    reparsePayrollImport(mapping);
  } catch (_error) {
    // 模板与当前表不兼容时保留原映射，由映射面板提示缺失项。
  }
}

function showPayrollTemplateSaveForm() {
  $('#payrollSaveTemplateButton')?.classList.add('hidden');
  $('#payrollTemplateNameInput')?.classList.remove('hidden');
  $('#payrollTemplateNameInput')?.focus();
  $('#payrollSaveTemplateConfirm')?.classList.remove('hidden');
  $('#payrollSaveTemplateCancel')?.classList.remove('hidden');
}

function hidePayrollTemplateSaveForm() {
  $('#payrollSaveTemplateButton')?.classList.remove('hidden');
  const input = $('#payrollTemplateNameInput');
  if (input) { input.classList.add('hidden'); input.value = ''; }
  $('#payrollSaveTemplateConfirm')?.classList.add('hidden');
  $('#payrollSaveTemplateCancel')?.classList.add('hidden');
}

async function savePayrollTemplate() {
  if (!state.payrollImport.headers.length || !state.payrollImport.mapping.length) {
    toast('请先上传工资表并完成字段识别', 'error');
    return;
  }
  const projectId = Number($('#payrollProjectSelect').value);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    toast('请先选择所属项目', 'error');
    return;
  }
  const name = String($('#payrollTemplateNameInput').value || '').trim();
  if (!name) {
    toast('请输入模板名称', 'error');
    return;
  }
  await api('/api/payroll/templates', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      name,
      sourceHeaders: state.payrollImport.headers,
      mapping: state.payrollImport.mapping
    })
  });
  toast('工资表模板已保存', 'success');
  hidePayrollTemplateSaveForm();
  await loadPayrollTemplates(projectId);
  state.payrollImport.activeTemplateId = 0;
  renderPayrollTemplateSelect();
}

function renderPayrollMappingPanel() {
  const panel = $('#payrollMappingPanel');
  const rows = $('#payrollMappingRows');
  const status = $('#payrollMappingStatus');
  if (!panel || !rows || !status || !state.payrollImport.mapping.length) return;
  panel.classList.remove('hidden');
  panel.classList.toggle('needs-review', state.payrollImport.mappingRequired);
  panel.open = PayrollColumnMapping.shouldKeepPanelOpen(panel.open, state.payrollImport.mappingRequired);
  status.textContent = state.payrollImport.mappingRequired
    ? '需要补全员工身份或实发工资用途'
    : '系统已自动识别，可展开检查';
  rows.innerHTML = state.payrollImport.mapping.map((item, index) => {
    const selectedChoice = PayrollColumnMapping.choiceForMapping(item);
    const options = payrollMappingChoices.map(([value, label]) => (
      `<option value="${value}"${value === selectedChoice ? ' selected' : ''}>${label}</option>`
    )).join('');
    return `<label class="payroll-mapping-row"><span class="payroll-mapping-source"><strong>${escapeHtml(item.sourceHeader || `第${index + 1}列`)}</strong><small>原表第 ${index + 1} 列</small></span><select data-payroll-mapping-choice="${index}" aria-label="${escapeHtml(item.sourceHeader || `第${index + 1}列`)}用途">${options}</select></label>`;
  }).join('');
}

function reparsePayrollImport(mapping = state.payrollImport.mapping) {
  state.payrollImport.mapping = mapping;
  state.payrollImport.mappingRequired = PayrollColumnMapping.mappingRequiresReview(mapping);
  state.payrollImport.preview = null;
  $('#payrollImportPreview')?.classList.add('hidden');
  if ($('#payrollConfirmButton')) $('#payrollConfirmButton').disabled = true;
  renderPayrollMappingPanel();
  try {
    const parsed = PayrollImport.parseMappedPayrollRows(
      state.payrollImport.sourceRows,
      state.payrollImport.header,
      mapping
    );
    state.payrollImport.parsedRows = parsed.rows;
    state.payrollImport.mappingRequired = false;
    renderPayrollMappingPanel();
    return parsed;
  } catch (error) {
    state.payrollImport.parsedRows = [];
    state.payrollImport.mappingRequired = true;
    renderPayrollMappingPanel();
    $('#payrollMappingStatus').textContent = error.message;
    throw error;
  }
}

async function preparePayrollMapping(parsed, projectId) {
  if (typeof PayrollColumnMapping === 'undefined') throw new Error('工资字段映射模块未加载，请刷新页面重试');
  const headers = parsed.headers || [];
  const headerSignature = await payrollHeaderSignature(headers);
  let profile = null;
  if (Number(projectId) > 0) {
    profile = await api(`/api/payroll/import-profiles?projectId=${Number(projectId)}&headerSignature=${headerSignature}`);
  }
  const mapping = PayrollColumnMapping.selectReusableMapping({
    headers,
    headerSignature,
    profile,
    suggestedMapping: parsed.columnMapping
  });
  state.payrollImport.sourceRows = parsed.sourceRows || [];
  state.payrollImport.headers = headers;
  state.payrollImport.header = {
    index: Number(parsed.headerRowIndex || 0),
    rowCount: Number(parsed.headerRowCount || 1),
    headers
  };
  state.payrollImport.headerSignature = headerSignature;
  state.payrollImport.suggestedMapping = parsed.suggestedMapping || parsed.columnMapping || [];
  state.payrollImport.mapping = mapping;
  state.payrollImport.mappingRequired = PayrollColumnMapping.mappingRequiresReview(mapping);
  renderPayrollMappingPanel();
  return reparsePayrollImport(mapping);
}

function payrollRowsFromText(text) {
  const rows = PayrollImport.parseDelimitedRows(text);
  if (!rows.length) throw new Error('请选择工资表文件，或粘贴 Excel 内容');
  return { ...PayrollImport.parseFlexiblePayrollRows(rows), sourceRows: rows };
}

async function readPayrollFile(file) {
  if (!file) throw new Error('请选择工资表文件');
  if (/\.xls$/i.test(file.name || '')) throw new Error('旧版 .xls 暂不支持，请在 Excel 中另存为 .xlsx 或 .csv 后上传');
  if (!/\.(csv|xlsx)$/i.test(file.name || '')) throw new Error('仅支持 .csv / .xlsx 文件');
  if (file.size > 10 * 1024 * 1024) throw new Error('工资表文件不能超过10MB');
  if (typeof PayrollImport === 'undefined') throw new Error('工资智能解析模块未加载，请刷新页面重试');
  if (/\.csv$/i.test(file.name || '')) {
    const text = await readFileAsText(file, '工资表读取失败');
    return { ...payrollRowsFromText(text), sheetName: 'CSV' };
  }
  if (typeof ExcelJS === 'undefined') throw new Error('Excel 组件未加载，请刷新页面重试');
  const buffer = await readFileAsArrayBuffer(file, '工资表读取失败');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const failures = [];
  for (const worksheet of workbook.worksheets) {
    const rows = worksheetToRows(worksheet);
    try {
      const parsed = PayrollImport.parseFlexiblePayrollRows(rows);
      return { ...parsed, sourceRows: rows, sheetName: worksheet.name };
    } catch (error) {
      failures.push(`${worksheet.name}：${error.message}`);
    }
  }
  throw new Error(`没有找到可识别的工资明细工作表。${failures.slice(0, 3).join('；')}`);
}

function renderPayrollImportPreview(preview) {
  const panel = $('#payrollImportPreview');
  const summary = $('#payrollImportSummary');
  const body = $('#payrollImportPreviewBody');
  const confirmButton = $('#payrollConfirmButton');
  if (!panel || !summary || !body || !confirmButton) return;
  panel.classList.remove('hidden');
  const warningRows = Number(preview.warningRows ?? preview.rows.filter(item => item.warnings?.length).length);
  summary.innerHTML = [
    `<span>总计 <strong>${preview.totalRows}</strong> 行</span>`,
    `<span class="success">可导入 <strong>${preview.validRows}</strong> 行</span>`,
    `<span class="${preview.errorRows ? 'danger' : ''}">无法创建 <strong>${preview.errorRows}</strong> 行</span>`,
    `<span class="${warningRows ? 'warning' : ''}">异常提示 <strong>${warningRows}</strong> 行</span>`
  ].join('');
  body.innerHTML = preview.rows.map(item => {
    const gross = Number(item.grossAmount || 0);
    const net = Number(item.netAmount || 0);
    const sourceItems = Array.isArray(item.itemSnapshot) ? item.itemSnapshot : [];
    const itemsHtml = sourceItems.length
      ? `<details class="payroll-items-detail" open><summary>${sourceItems.length} 项</summary><div class="payroll-items-list">${sourceItems.map(entry => `<div class="payroll-item-row"><span>${escapeHtml(entry.label || '')}</span><strong>${escapeHtml(String(entry.value ?? ''))}</strong></div>`).join('')}</div></details>`
      : '<span class="muted">无可展示项目</span>';
    const messages = [
      ...(item.errors || []).map(message => `<span class="payroll-row-error">${escapeHtml(message)}</span>`),
      ...(item.warnings || []).map(message => `<span class="payroll-row-warning">${escapeHtml(message)}</span>`)
    ].join('') || '<span class="payroll-row-success">校验通过</span>';
    return `<tr class="${item.errors?.length ? 'has-error' : ''}"><td>${item.rowNumber}</td><td><strong>${escapeHtml(item.employeeName || '-')}</strong><small>${escapeHtml(item.employeeNo || '')}</small></td><td>${money(gross)}</td><td>${money(Math.max(0, gross - net))}</td><td><strong>${money(net)}</strong></td><td>${itemsHtml}</td><td>${messages}</td></tr>`;
  }).join('');
  confirmButton.disabled = preview.errorRows > 0;
}

async function previewPayrollImport(event) {
  if (event) event.preventDefault();
  const form = $('#payrollBatchForm');
  if (!form.reportValidity()) return;
  if (!state.payrollImport.parsedRows.length) {
    if (typeof PayrollImport === 'undefined') throw new Error('工资智能解析模块未加载，请刷新页面重试');
    const parsed = payrollRowsFromText(form.elements.tableData.value);
    state.payrollImport.sourceRows = parsed.sourceRows;
    state.payrollImport.sheetName = '粘贴内容';
    await preparePayrollMapping(parsed, Number(form.projectId.value));
  }
  const preview = await api('/api/payroll/batches/preview', {
    method: 'POST',
    body: JSON.stringify({
      projectId: Number(form.projectId.value),
      headerSignature: state.payrollImport.headerSignature,
      sourceHeaders: state.payrollImport.headers,
      mapping: state.payrollImport.mapping,
      sheetName: state.payrollImport.sheetName,
      rows: state.payrollImport.parsedRows
    })
  });
  state.payrollImport.preview = preview;
  renderPayrollImportPreview(preview);
  const manualEntry = document.querySelector('.payroll-manual-entry');
  if (manualEntry) manualEntry.open = false;
  if (preview.errorRows > 0) toast(`发现 ${preview.errorRows} 行无法创建，请修改员工身份或非法数据`, 'error');
  else if (preview.warningRows > 0) toast(`发现 ${preview.warningRows} 行金额异常提示，仍可继续创建工资条`, 'warning');
  else toast(`校验通过，可创建 ${preview.validRows} 人工资批次`, 'success');
}

async function confirmPayrollBatchImport() {
  const form = $('#payrollBatchForm');
  const preview = state.payrollImport.preview;
  if (!preview) throw new Error('请先解析并预览工资表');
  if (preview.errorRows > 0) throw new Error('工资表存在无法创建的数据，请修正员工身份或非法金额后重新预览');
  if (!state.payrollImport.parsedRows.length) throw new Error('工资表数据已失效，请重新上传');
  const warningRows = preview.rows.filter(item => item.warnings?.length).length;
  if (warningRows > 0) {
    const confirmed = await confirmDialog({
      title: '工资数据存在异常提示',
      message: `${warningRows} 行工资的应发、实发或明细核对存在差异。系统将保留原表金额，确认仍然创建工资条吗？`,
      confirmText: '仍然创建工资条',
      danger: true
    });
    if (!confirmed) return;
  }
  const button = $('#payrollConfirmButton');
  button.disabled = true;
  try {
    const data = await api('/api/payroll/batches', {
      method: 'POST',
      body: JSON.stringify({
        projectId: Number(form.projectId.value),
        salaryMonth: form.salaryMonth.value,
        payrollType: 3,
        employeeViewEnabled: Number(form.employeeViewEnabled.value),
        viewOnce: Number(form.viewOnce.value),
        viewExpiresMinutes: form.viewExpiresMinutes.value ? Number(form.viewExpiresMinutes.value) : null,
        headerSignature: state.payrollImport.headerSignature,
        sourceHeaders: state.payrollImport.headers,
        mapping: state.payrollImport.mapping,
        sheetName: state.payrollImport.sheetName,
        rows: state.payrollImport.parsedRows
      })
    });
    $('#payrollBatchResult').classList.remove('hidden');
    $('#payrollBatchResult').innerHTML = `<strong>工资批次 ${escapeHtml(data.batchNo)} 创建成功，共 ${data.employeeCount} 人。</strong>`;
    await Promise.all([loadPayroll(), loadOffice()]);
    window.setTimeout(() => {
      $('#payrollBatchModal').close();
      form.reset();
      resetPayrollImport({ keepResult: true });
    }, 900);
  } catch (error) {
    button.disabled = false;
    throw error;
  }
}

function bindPayrollFileZone() {
  const zone = $('#payrollFileZone');
  const input = $('#payrollFileInput');
  if (!zone || !input) return;
  const loadFile = async file => {
    if (!file) return;
    resetPayrollImport();
    $('#payrollFileName').textContent = `正在智能识别：${file.name} …`;
    try {
      const parsed = await readPayrollFile(file);
      state.payrollImport.fileName = file.name;
      state.payrollImport.sheetName = parsed.sheetName;
      try {
        await preparePayrollMapping(parsed, Number($('#payrollProjectSelect').value));
      } catch (error) {
        if (!state.payrollImport.mappingRequired) throw error;
      }
      $('#payrollBatchForm').elements.tableData.value = '';
      const itemCount = state.payrollImport.mapping.filter(item => item.includeInPayslip).length;
      const rowCount = state.payrollImport.parsedRows.length || parsed.rows.length;
      $('#payrollFileName').textContent = `已识别：${file.name} / ${parsed.sheetName}（${rowCount} 行，${itemCount} 个工资项目）`;
    } catch (error) {
      $('#payrollFileName').textContent = '';
      throw error;
    }
  };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => loadFile(input.files?.[0]).catch(error => toast(error.message, 'error')));
  ['dragenter', 'dragover'].forEach(name => zone.addEventListener(name, event => {
    event.preventDefault();
    zone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(name => zone.addEventListener(name, event => {
    event.preventDefault();
    zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', event => loadFile(event.dataTransfer?.files?.[0]).catch(error => toast(error.message, 'error')));
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
  } catch (error) {
    if (isSessionSupersededError(error)) throw error;
    renderTableFailure('#blacklistTableBody', 8, '黑名单加载失败', error, 'blacklist');
    throw error;
  } finally { setPanelLoaded('#blacklistTableBody'); }
}

let _permRoles = [], _permProjects = [], _permTree = [], _permDepartments = [];
registerSessionCleanupHook(() => {
  _permRoles = [];
  _permProjects = [];
  _permTree = [];
  _permDepartments = [];
  if (duplicateIdentityCheckTimer) {
    window.clearTimeout(duplicateIdentityCheckTimer);
    duplicateIdentityCheckTimer = null;
  }
});

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

    const isCompanyAdmin = (state.user?.roles || []).some(role => role.roleCode === 'company_admin');
    const canManageRolePermissions = isCompanyAdmin;
    const canManageSystemUsers = isCompanyAdmin;
    $('#createPermissionUserButton').classList.toggle('hidden', !canManageSystemUsers);

    /* 渲染角色卡片 */
    $('#permissionRoleCards').innerHTML = roles.map((role, index) => {
      const permCount = role.permissions?.length || 0;
      const scopeBadge = role.dataScope === 1 ? '全公司' : (role.dataScopeName || '自定义');
      const statusBadge = role.status === 1 ? '' : badge('停用', 'amber');
      const permissionPreview = (role.permissions || []).slice(0, 3).map(p => p.permName).join(' · ');
      const configButton = canManageRolePermissions
        ? `<button class="secondary-button role-card-config" type="button" data-config-role="${role.id}">${role.roleCode === 'company_admin' ? '查看全部权限' : '配置权限'}</button>`
        : '';
      return `<article class="role-card" data-role-id="${role.id}"><div class="role-number">0${index + 1}</div><div><span>${escapeHtml(role.roleCode)}</span><h3>${escapeHtml(role.roleName)}</h3><p>${escapeHtml(permissionPreview || '暂无权限')}${permCount > 3 ? ' …' : ''}</p><div class="role-card-meta"><strong>${role.userCount}个账号 · ${permCount}项权限</strong>${badge(scopeBadge, role.dataScope === 1 ? 'green' : 'blue')}${statusBadge}</div>${configButton}</div></article>`;
    }).join('');

    /* 渲染用户表格 */
    $('#permissionUserTableBody').innerHTML = users.length ? users.map(user => {
      const roleBadges = (user.roles || []).map(r => badge(r.roleName, 'blue')).join(' ');
      const projText = renderUserProjects(user.projects, user.roles);
      const canDelete = isCompanyAdmin && user.username !== 'admin' && Number(user.id) !== Number(state.user?.id) && !user.employeeId;
      const managementActions = canManageSystemUsers
        ? `<div class="row-actions"><button class="link-button" data-edit-user="${user.id}">编辑</button><button class="link-button" data-reset-pwd="${user.id}" data-username="${escapeHtml(user.realName)}">重置密码</button>${user.status === 1 ? `<button class="link-button danger" data-toggle-user="${user.id}" data-status="0">停用</button>` : `<button class="link-button" data-toggle-user="${user.id}" data-status="1">启用</button>`}${canDelete ? `<button class="link-button danger" data-delete-user="${user.id}" data-user-label="${escapeHtml(`${user.realName}（${user.username}）`)}">删除</button>` : ''}</div>`
        : '<span class="muted">只读</span>';
      return `<tr><td><strong>${escapeHtml(user.realName)}</strong><small>${escapeHtml(user.username)}</small></td><td>${user.mobile || '-'}</td><td>${roleBadges}</td><td>${projText}</td><td>${badge(user.status === 1 ? '启用' : '停用', user.status === 1 ? 'green' : 'amber')}</td><td>${managementActions}</td></tr>`;
    }).join('') : emptyRow(6, '暂无系统账号', '点击"新增账号"创建');
  } catch (error) {
    if (isSessionSupersededError(error)) throw error;
    _permRoles = [];
    _permProjects = [];
    _permTree = [];
    _permDepartments = [];
    $('#permissionRoleCards').innerHTML = '';
    renderTableFailure('#permissionUserTableBody', 6, '权限账号加载失败', error, 'permissions');
    throw error;
  } finally { setPanelLoaded('#permissionUserTableBody'); }
}

/* 用户已授权项目按客户分组展示 */
function renderUserProjects(projects, roles = []) {
  if (!projects || !projects.length) {
    const hasCompanyAdminRole = roles.some(role => role.roleCode === 'company_admin');
    return `<span class="muted">${hasCompanyAdminRole ? '全部项目' : '未分配项目'}</span>`;
  }
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
  if (action === 'interviews') return openRosterStatus(6);
  if (action === 'pending-arrival') return openRosterStatus(1);
  if (action === 'employees') return openRosterStatus(2);
  if (action === 'talents') return switchView('talents');
  if (action === 'dashboard') return switchView('dashboard');
  if (action === 'projects') return switchView('projects');
  if (action === 'advances') return switchView('advances');
  if (action === 'payroll') return switchView('payroll');
  if (action === 'blacklist') return switchView('blacklist');
  if (action === 'recruitment-sources') return switchView('recruitmentSources');
  if (action === 'payroll-create') {
    return loadProjects().then(() => {
      $('#payrollProjectSelect').innerHTML = optionHtml(state.projects, 'id', 'projectName');
      const form = $('#payrollBatchForm');
      form.reset();
      resetPayrollImport();
      hidePayrollTemplateSaveForm();
      $('#payrollBatchModal').showModal();
      const projectId = Number($('#payrollProjectSelect').value);
      if (projectId > 0) return loadPayrollTemplates(projectId);
    }).catch(error => toast(error.message, 'error'));
  }
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadEmployees()]);
}

async function refreshEmployeeWorkspace() {
  await Promise.all([refreshAll(), loadOffice()]);
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
  $('#copyEmployeeBindCodeButton').addEventListener('click', () => {
    copyEmployeeBindCode().catch(error => toast(error.message || '复制失败', 'error'));
  });

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
  window.addEventListener('error', event => {
    console.error('Unhandled window error:', event.error || event.message);
    toast(event.error?.message || event.message || '页面操作出现异常，请刷新后重试', 'error');
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
    EmployeeBatch.headers,
    EmployeeBatch.example
  ));
  $('#employeeXlsxTemplateButton').addEventListener('click', () => downloadXlsxTemplate(
    '员工批量录入模板.xlsx',
    EmployeeBatch.headers,
    EmployeeBatch.example
  ).catch(error => toast(error.message || '模板下载失败', 'error')));
  bindBatchFileZone('employeeFileZone', 'employeeFileInput', 'batchEmployeeForm', 'employeeFileName',
    EmployeeBatch.headers);
  $('#auditRefreshButton').addEventListener('click', () => loadAuditLogs().catch(error => toast(error.message)));
  $('#createClientButton').addEventListener('click', () => {
    $('#clientForm').reset();
    $('#clientModal').showModal();
  });
  $('#addCustomerProjectButton').addEventListener('click', () => {
    $('#customerProjectsEditor').insertAdjacentHTML('beforeend', customerProjectEditorHtml());
  });
  $('#createTalentButton').addEventListener('click', () => $('#talentModal').showModal());
  $('#talentSearchButton')?.addEventListener('click', submitTalentSearch);
  $('#talentSearchInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') submitTalentSearch();
  });
  $('#talentSearchClear')?.addEventListener('click', () => {
    const input = $('#talentSearchInput');
    if (input) input.value = '';
    submitTalentSearch();
  });
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
  ).catch(error => toast(error.message || '模板下载失败', 'error')));
  $('#payrollCsvExampleButton').addEventListener('click', () => downloadCsvTemplate(
    '工资导入示例格式.csv',
    ['员工姓名', '联系电话', '底薪', '夜班奖', '住宿扣款', '实发工资', '班组'],
    ['张三', '13800138000', '4500', '380', '150', '4730', 'A组']
  ));
  $('#payrollXlsxExampleButton').addEventListener('click', () => downloadXlsxTemplate(
    '工资导入示例格式.xlsx',
    ['员工姓名', '联系电话', '底薪', '夜班奖', '住宿扣款', '实发工资', '班组'],
    ['张三', '13800138000', '4500', '380', '150', '4730', 'A组']
  ).catch(error => toast(error.message || '示例下载失败', 'error')));
  bindPayrollFileZone();
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
      return refreshAfterSuccess(loadPermissions(), '账号列表');
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
        return refreshAfterSuccess(loadPermissions(), '权限列表');
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
  $('#employeeForm')?.elements.idCardNo?.addEventListener('input', event => scheduleWebExistingEmployeeCheck(event.currentTarget.form));
  $('#mobileEmployeeForm')?.elements.idCardNo?.addEventListener('input', event => scheduleWebExistingEmployeeCheck(event.currentTarget.form));
  if ($('#advanceMonthFilter') && !$('#advanceMonthFilter').value) {
    $('#advanceMonthFilter').value = localDateTimeInputValue().slice(0, 7);
  }
  $('#advanceMonthFilter')?.addEventListener('change', () => loadAdvances().catch(error => toast(error.message)));
  $('#advanceAllMonthsButton')?.addEventListener('click', () => {
    $('#advanceMonthFilter').value = '';
    loadAdvances().catch(error => toast(error.message));
  });
  $('#batchEmployeeForm').addEventListener('submit', event => submitEmployeeBatch(event).catch(error => toast(error.message)));
  $('#transferForm').addEventListener('submit', event => submitTransfer(event).catch(error => toast(error.message)));
  $('#transferCustomerSelect').addEventListener('change', updateTransferProjectOptions);
  $('#resignForm').addEventListener('submit', event => submitResign(event).catch(error => toast(error.message)));
  $('#certificateForm').addEventListener('submit', event => submitCertificate(event).catch(error => toast(error.message)));
  $('#passwordForm').addEventListener('submit', event => changePassword(event).catch(error => toast(error.message)));
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
  $('#payrollBatchForm').addEventListener('submit', event => previewPayrollImport(event).catch(error => toast(error.message, 'error')));
  $('#payrollBatchEmployeeSearchForm').addEventListener('submit', event => {
    event.preventDefault();
    state.payrollDetailKeyword = $('#payrollBatchEmployeeSearch').value.trim();
    renderPayrollBatchEmployeeRows();
  });
  $('#payrollSaveViewPolicy')?.addEventListener('click', () => savePayrollViewPolicy().catch(error => toast(error.message, 'error')));
  $('#payrollRecordStatusFilter')?.addEventListener('change', event => {
    state.payrollRecordFilter = event.currentTarget.value || 'all';
    renderPayrollRecords();
  });
  $('#payrollRecordMonthFilter')?.addEventListener('change', event => {
    state.payrollRecordMonth = event.currentTarget.value || '';
    renderPayrollRecords();
  });
  $('#payrollRecordReset')?.addEventListener('click', () => {
    state.payrollRecordFilter = 'all';
    state.payrollRecordMonth = '';
    $('#payrollRecordStatusFilter').value = 'all';
    $('#payrollRecordMonthFilter').value = '';
    renderPayrollRecords();
  });
  $('#payrollBatchEmployeeSearchReset').addEventListener('click', () => {
    $('#payrollBatchEmployeeSearch').value = '';
    state.payrollDetailKeyword = '';
    renderPayrollBatchEmployeeRows();
  });
  $('#payrollConfirmButton').addEventListener('click', () => confirmPayrollBatchImport().catch(error => toast(error.message, 'error')));
  $('#payrollProjectSelect').addEventListener('change', () => {
    state.payrollImport.preview = null;
    $('#payrollImportPreview').classList.add('hidden');
    $('#payrollConfirmButton').disabled = true;
    state.payrollImport.activeTemplateId = 0;
    loadPayrollTemplates(Number($('#payrollProjectSelect').value)).catch(error => toast(error.message, 'error'));
    if (state.payrollImport.sourceRows.length) {
      const parsed = {
        sourceRows: state.payrollImport.sourceRows,
        headers: state.payrollImport.headers,
        headerRowIndex: state.payrollImport.header?.index,
        headerRowCount: state.payrollImport.header?.rowCount,
        columnMapping: state.payrollImport.suggestedMapping,
        suggestedMapping: state.payrollImport.suggestedMapping
      };
      preparePayrollMapping(parsed, Number($('#payrollProjectSelect').value))
        .catch(error => toast(error.message, 'error'));
    }
  });
  $('#payrollMappingRows').addEventListener('change', event => {
    const select = event.target.closest('[data-payroll-mapping-choice]');
    if (!select) return;
    const index = Number(select.dataset.payrollMappingChoice);
    const mapping = state.payrollImport.mapping.map((item, itemIndex) => (
      itemIndex === index ? PayrollColumnMapping.applyMappingChoice(item, select.value) : item
    ));
    try {
      reparsePayrollImport(mapping);
    } catch (_error) {
      // 映射未补全时保留当前选择，由面板直接提示缺失项。
    }
  });
  $('#payrollTemplateSelect').addEventListener('change', event => {
    applyPayrollTemplate(event.target.value);
  });
  $('#payrollSaveTemplateButton').addEventListener('click', showPayrollTemplateSaveForm);
  $('#payrollSaveTemplateConfirm').addEventListener('click', () => savePayrollTemplate().catch(error => toast(error.message, 'error')));
  $('#payrollSaveTemplateCancel').addEventListener('click', hidePayrollTemplateSaveForm);
  $('#payrollBatchForm').elements.tableData.addEventListener('input', () => {
    state.payrollImport.parsedRows = [];
    state.payrollImport.preview = null;
    state.payrollImport.fileName = '';
    state.payrollImport.sheetName = '';
    state.payrollImport.sourceRows = [];
    state.payrollImport.headers = [];
    state.payrollImport.header = null;
    state.payrollImport.headerSignature = '';
    state.payrollImport.suggestedMapping = [];
    state.payrollImport.mapping = [];
    state.payrollImport.mappingRequired = false;
    $('#payrollFileName').textContent = '';
    $('#payrollMappingPanel').classList.add('hidden');
    $('#payrollImportPreview').classList.add('hidden');
    $('#payrollConfirmButton').disabled = true;
  });
  $('#payrollDisputeStatusFilter').addEventListener('change', () => loadPayrollDisputes().catch(error => toast(error.message, 'error')));
  $('#channelForm').addEventListener('submit', event => { event.preventDefault(); saveRecruitmentSource(event.currentTarget).catch(error => toast(error.message, 'error')); });
  $('#createChannelButton').addEventListener('click', () => openChannelModal());
  $$('[data-roster-mode]').forEach(button => button.addEventListener('click', () => {
    state.rosterViewMode = button.dataset.rosterMode;
    $$('[data-roster-mode]').forEach(item => item.classList.toggle('active', item === button));
    renderEmployees();
  }));
  $('#primaryNavigation')?.addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (button) switchView(button.dataset.view);
  });
  $$('.mobile-tabbar button[data-view]').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });
  $('[data-mobile-nav-more]')?.addEventListener('click', () => {
    renderMobileNavigation();
    updateMobileNavigationActive();
    $('#mobileNavigationDialog').showModal();
  });

  document.addEventListener('click', async event => {
    const retryView = event.target.closest('[data-retry-view]');
    if (retryView) {
      switchView(retryView.dataset.retryView);
      return;
    }

    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) {
      if (closeButton.dataset.closeModal === 'payrollSignatureModal' && state.payrollSignatureObjectUrl) {
        URL.revokeObjectURL(state.payrollSignatureObjectUrl);
        state.payrollSignatureObjectUrl = '';
        $('#payrollSignatureImage').removeAttribute('src');
      }
      $(`#${closeButton.dataset.closeModal}`).close();
      return;
    }

    const mobileNavigationItem = event.target.closest('[data-mobile-nav-view]');
    if (mobileNavigationItem) {
      $('#mobileNavigationDialog').close();
      switchView(mobileNavigationItem.dataset.mobileNavView);
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

    const lifecycleStep = event.target.closest('[data-lifecycle-status]');
    if (lifecycleStep) {
      if (!canRunOfficeAction('employees')) {
        toast('当前账号没有查看员工名单的权限', 'error');
        return;
      }
      openRosterStatus(Number(lifecycleStep.dataset.lifecycleStatus));
      return;
    }

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
    const manageClientCard = event.target.closest('[data-manage-client]');
    if (manageClientCard) {
      openClientManagement(Number(manageClientCard.dataset.manageClient)).catch(error => toast(error.message, 'error'));
      return;
    }
    const projectRoster = event.target.closest('[data-project-roster]');
    if (projectRoster) {
      openProjectRoster(Number(projectRoster.dataset.projectRoster));
      return;
    }
    const talentOnboard = event.target.closest('[data-talent-onboard]');
    if (talentOnboard) {
      openTalentOnboarding(Number(talentOnboard.dataset.talentOnboard)).catch(error => toast(error.message, 'error'));
      return;
    }

    const payrollWorkspaceTab = event.target.closest('[data-payroll-workspace-tab]');
    if (payrollWorkspaceTab) {
      switchPayrollWorkspace(payrollWorkspaceTab.dataset.payrollWorkspaceTab);
      return;
    }

    const payrollRecordFilter = event.target.closest('[data-payroll-record-filter]');
    if (payrollRecordFilter) {
      const filter = payrollRecordFilter.dataset.payrollRecordFilter || 'all';
      if (filter === 'disputes') {
        switchPayrollWorkspace('disputes');
        return;
      }
      state.payrollRecordFilter = ['pending', 'failed', 'unsigned', 'unread'].includes(filter) ? filter : 'all';
      const statusSelect = $('#payrollRecordStatusFilter');
      if (statusSelect) statusSelect.value = ['pending', 'failed', 'unsigned'].includes(filter) ? filter : 'all';
      renderPayrollRecords();
      switchPayrollWorkspace('records');
      return;
    }

    const publishPayrollButton = event.target.closest('[data-publish-payroll]');
    if (publishPayrollButton) {
      const batchId = Number(publishPayrollButton.dataset.publishPayroll);
      const confirmed = await confirmDialog({
        title: '发布工资条',
        message: '发布后，该批次工资条将进入待签收状态并对对应员工可见。',
        confirmText: '确认发布'
      });
      if (!confirmed) return;
      api(`/api/payroll/batches/${batchId}/publish`, { method: 'PUT', body: '{}' })
        .then(() => { toast('工资条已发布', 'success'); return Promise.all([loadPayroll(), loadOffice()]); })
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const withdrawPayrollButton = event.target.closest('[data-withdraw-payroll]');
    if (withdrawPayrollButton) {
      withdrawPayrollBatch(Number(withdrawPayrollButton.dataset.withdrawPayroll))
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const payrollBatchDetailButton = event.target.closest('[data-payroll-batch-detail]');
    if (payrollBatchDetailButton) {
      openPayrollBatchDetail(Number(payrollBatchDetailButton.dataset.payrollBatchDetail))
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const payrollDetailFilterButton = event.target.closest('[data-payroll-detail-filter]');
    if (payrollDetailFilterButton) {
      state.payrollDetailFilter = payrollDetailFilterButton.dataset.payrollDetailFilter || 'all';
      renderPayrollBatchEmployeeRows();
      return;
    }

    const payrollDetailExportButton = event.target.closest('[data-payroll-detail-export]');
    if (payrollDetailExportButton) {
      exportPayrollBatchDetail(payrollDetailExportButton.dataset.payrollDetailExport)
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const payrollDetailPageButton = event.target.closest('[data-payroll-detail-page]');
    if (payrollDetailPageButton && !payrollDetailPageButton.disabled) {
      const batchId = Number(state.payrollBatchDetail?.batch?.id || 0);
      if (batchId) openPayrollBatchDetail(batchId, Number(payrollDetailPageButton.dataset.payrollDetailPage))
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const payrollSmsAction = event.target.closest('[data-payroll-sms-action]');
    if (payrollSmsAction) {
      handlePayrollSmsAction(payrollSmsAction.dataset.payrollSmsAction)
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const payrollSignatureButton = event.target.closest('[data-view-payroll-signature]');
    if (payrollSignatureButton) {
      openPayrollSignature(
        Number(payrollSignatureButton.dataset.viewPayrollSignature),
        payrollSignatureButton.dataset.signedName,
        payrollSignatureButton.dataset.signedAt
      ).catch(error => toast(error.message, 'error'));
      return;
    }

    const payrollDisputeButton = event.target.closest('[data-handle-payroll-dispute]');
    if (payrollDisputeButton) {
      openPayrollDispute(Number(payrollDisputeButton.dataset.handlePayrollDispute));
      return;
    }

    const payrollDisputeAction = event.target.closest('[data-payroll-dispute-action]');
    if (payrollDisputeAction) {
      handlePayrollDisputeAction(payrollDisputeAction.dataset.payrollDisputeAction)
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const submitPayrollButton = event.target.closest('[data-submit-payroll]');
    if (submitPayrollButton) {
      const batchId = Number(submitPayrollButton.dataset.submitPayroll);
      const confirmed = await confirmDialog({
        title: '提交工资复核',
        message: '提交后需由具备工资复核权限的账号审核，审核前不能发布。',
        confirmText: '确认提交'
      });
      if (!confirmed) return;
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
        .then(() => {
          toast(status === 1 ? '账号已启用' : '账号已停用', 'success');
          return refreshAfterSuccess(loadPermissions(), '账号状态列表');
        })
        .catch(error => toast(error.message, 'error'));
      return;
    }

    const deleteUserBtn = event.target.closest('[data-delete-user]');
    if (deleteUserBtn) {
      const confirmed = await confirmDialog({
        title: '删除系统账号',
        message: `确定删除${deleteUserBtn.dataset.userLabel || '该账号'}吗？删除后将立即退出登录并清除角色和项目权限，历史操作记录仍会保留。`,
        confirmText: '确认删除',
        danger: true
      });
      if (!confirmed) return;
      try {
        await api(`/api/system/users/${Number(deleteUserBtn.dataset.deleteUser)}`, { method: 'DELETE' });
        toast('账号已删除', 'success');
        await refreshAfterSuccess(loadPermissions(), '系统账号列表');
      } catch (error) {
        toast(error.message || '账号删除失败', 'error');
      }
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
    if (action === 'reveal-id-card') {
      toggleRosterIdCard(actionButton).catch(error => toast(error.message, 'error'));
      return;
    }
    if (action === 'detail') openEmployeeModal(Number(id), { readOnly: true }).catch(error => toast(error.message));
    if (action === 'edit') openEmployeeModal(Number(id)).catch(error => toast(error.message));
    if (action === 'employee-bind-code') {
      withSubmitLock(actionButton, () => openEmployeeBindCode(Number(id)), '生成中…')
        .catch(error => toast(error.message || '绑定码生成失败', 'error'));
    }
    if (action === 'reactivate') reactivateExistingEmployee(Number(id)).catch(error => toast(error.message));
    if (action === 'transfer') openTransferModal(id);
    if (action === 'resign') openResignModal(id);
    if (action === 'certificate') openCertificateModal(id);
    if (action === 'approve-advance') approveAdvance(id).catch(error => toast(error.message));
    if (action === 'pay-advance') payAdvance(id).catch(error => toast(error.message));
    if (action === 'assign-onsite') openProjectOnsiteModal(Number(actionButton.dataset.project)).catch(error => toast(error.message, 'error'));
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
  $('#customerSelect')?.addEventListener('change', () => updateRosterProjectOptions());
  $('#mFormCustomerSelect')?.addEventListener('change', event => updateEmployeeProjectOptions(event.currentTarget.form));
  $('#employeeForm')?.elements.employeeStatus?.addEventListener('change', event => syncEmployeeFormRequirements(event.currentTarget.form));
  $('#mobileEmployeeForm')?.elements.employeeStatus?.addEventListener('change', event => syncEmployeeFormRequirements(event.currentTarget.form));
  $('#employeeForm')?.addEventListener('input', resetWebTalentSelection);
  $('#employeeForm')?.addEventListener('input', event => syncEmployeeEntryPresentation(event.currentTarget));
  $('#mobileEmployeeForm')?.addEventListener('input', resetWebTalentSelection);
  document.querySelectorAll('#employeeEntryModeSwitch [data-entry-mode]').forEach(button => {
    button.addEventListener('click', () => {
      const form = $('#employeeForm');
      form.elements.employeeStatus.value = button.dataset.entryMode;
      syncEmployeeFormRequirements(form, button.dataset.entryMode);
    });
  });
  $('#onboardingBatchButton')?.addEventListener('click', () => {
    $('#employeeModal').close();
    $('#batchEmployeeForm').reset();
    $('#batchEmployeeResult').classList.add('hidden');
    $('#batchEmployeeModal').showModal();
  });
  $('#onboardingTalentButton')?.addEventListener('click', () => {
    $('#employeeModal').close();
    switchView('talents');
  });

  const mobileSearch = $('#mobileEmpSearch');
  if (mobileSearch) {
    const debouncedMobileSearch = debounce(() => {
      loadMobileEmployees(mobileSearch.value.trim()).catch(err => toast(err.message, 'error'));
    }, 400);
    mobileSearch.addEventListener('input', debouncedMobileSearch);
  }
}

async function init() {
  setSystemStatus('loading');
  initializeRosterTableTools();
  bindEvents();
  initBackToTop();
  localStorage.removeItem('hrRosterToken');
  localStorage.removeItem('hrRosterUser');
  try {
    state.user = await api('/api/auth/me', { context: '恢复登录状态' });
  } catch (error) {
    logout(false, false);
    setLoginError(consumeAuthMessage() || error.message || '登录状态读取失败，请重新登录');
    return;
  }
  await activateAuthenticatedSession(state.user);
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
    if (isSessionSupersededError(err)) return;
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
  const statusMap = { 1: { text: '待到岗', cls: 'pending' }, 2: { text: '在职', cls: 'active' }, 3: { text: '离职', cls: 'resigned' }, 4: { text: '黑名单', cls: 'resigned' }, 5: { text: '未入职', cls: 'pending' }, 6: { text: '面试', cls: 'pending' } };
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
  delete form.dataset.talentCheckKey;
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
    if (result.idCardNo) {
      const precheck = await api('/api/employees/precheck', {
        method: 'POST',
        body: JSON.stringify({ name: result.name || '', idCardNo: result.idCardNo })
      });
      if (precheck.checks?.duplicate?.passed === false) {
        await openExistingEmployeeRecord(precheck.checks.duplicate, { mobile: true });
      }
    }
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
    if (!id && !(await checkWebTalentCandidates(form, body))) return;
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
  setSystemStatus('loading');
  try {
    await loadBootstrap();
  } catch (error) {
    setSystemStatus('error');
    throw error;
  }
  clearCache();
  const results = await Promise.allSettled([refreshAll(), loadOffice()]);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length === results.length) {
    setSystemStatus('error');
    throw failures[0].reason;
  }
  if (failures.length) {
    setSystemStatus('warning');
    const message = failures.map(result => result.reason?.message || '未知错误').join('；');
    toast(`部分数据加载失败：${message}`, 'error');
  } else {
    setSystemStatus('online');
  }
  if (state.employees[0]) {
    await selectEmployee(state.employees[0].id).catch(error => {
      setSystemStatus('warning');
      toast(`员工详情加载失败：${error.message}`, 'error');
    });
  }
  switchView('office');
}

init().catch(error => {
  setSystemStatus('error');
  console.error('Init error:', error);
  toast(error.message || '系统初始化失败，请刷新页面', 'error');
});
