// 花名册列设置与当前页排序。仅保存展示偏好，不保存任何员工数据。
const rosterColumnConfig = [
  ['idx', '序号', true, false],
  ['name', '姓名', true, false],
  ['gender', '性别', false, true],
  ['edu', '学历', false, true],
  ['idcard', '身份证号码', false, true],
  ['phone', '电话', true, true],
  ['customer', '工作单位', true, true],
  ['position', '岗位', true, true],
  ['wtype', '工资类型', false, true],
  ['hire', '入职日期', true, true],
  ['contract', '合同期限', false, true],
  ['employment', '用工模式', true, true],
  ['fee', '费用模式', false, true],
  ['leave', '离职时间', false, true],
  ['channel', '招聘渠道', true, true],
  ['remark', '备注', false, true],
  ['ops', '操作', true, false]
];

const defaultRosterColumns = new Set(rosterColumnConfig.filter(column => column[2]).map(column => column[0]));
let rosterVisibleColumns = loadRosterVisibleColumns();
let rosterSortKey = '';
let rosterSortAsc = true;

function loadRosterVisibleColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem('hrRosterVisibleColumns') || 'null');
    const valid = new Set(rosterColumnConfig.map(column => column[0]));
    if (Array.isArray(saved)) {
      const selected = new Set(saved.filter(column => valid.has(column)));
      selected.add('idx');
      selected.add('name');
      selected.add('ops');
      return selected;
    }
  } catch (_error) {
    // 无效的本地偏好直接回退默认列。
  }
  return new Set(defaultRosterColumns);
}

function rosterVisibleColumnCount() {
  return rosterColumnConfig.filter(column => rosterVisibleColumns.has(column[0])).length;
}

function applyRosterColumnVisibility() {
  rosterColumnConfig.forEach(([key]) => {
    const visible = rosterVisibleColumns.has(key);
    $$(`.roster-table .col-${key}`).forEach(cell => cell.classList.toggle('column-hidden', !visible));
  });
}

function updateRosterSortIndicators() {
  $$('.roster-table th[data-sort-key]').forEach(header => {
    const active = header.dataset.sortKey === rosterSortKey;
    header.setAttribute('aria-sort', active ? (rosterSortAsc ? 'ascending' : 'descending') : 'none');
    header.classList.toggle('sort-active', active);
    header.dataset.sortDirection = active ? (rosterSortAsc ? 'asc' : 'desc') : '';
  });
}

function rosterSortValue(row, key) {
  const value = row?.[key];
  if (value == null) return '';
  if (typeof value === 'number') return value;
  return String(value).trim();
}

function getSortedRosterRows(rows) {
  const result = [...rows];
  if (!rosterSortKey) return result;
  result.sort((left, right) => {
    const a = rosterSortValue(left, rosterSortKey);
    const b = rosterSortValue(right, rosterSortKey);
    const compared = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
    return rosterSortAsc ? compared : -compared;
  });
  return result;
}

function finalizeRosterTableRender() {
  applyRosterColumnVisibility();
  updateRosterSortIndicators();
}

function renderRosterColumnOptions() {
  const dropdown = $('#rosterColumnDropdown');
  if (!dropdown) return;
  dropdown.innerHTML = rosterColumnConfig.map(([key, label, _defaultVisible, configurable]) => `
    <label class="column-option ${configurable ? '' : 'locked'}">
      <input type="checkbox" value="${key}" ${rosterVisibleColumns.has(key) ? 'checked' : ''} ${configurable ? '' : 'disabled'} />
      <span>${escapeHtml(label)}</span>
    </label>
  `).join('');
}

function initializeRosterTableTools() {
  renderRosterColumnOptions();
  applyRosterColumnVisibility();
  const toggle = $('#rosterColumnToggle');
  const dropdown = $('#rosterColumnDropdown');
  if (toggle && dropdown) {
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      dropdown.classList.toggle('hidden');
      toggle.setAttribute('aria-expanded', String(!dropdown.classList.contains('hidden')));
    });
    dropdown.addEventListener('click', event => event.stopPropagation());
    dropdown.addEventListener('change', event => {
      const input = event.target.closest('input[type="checkbox"]');
      if (!input || input.disabled) return;
      if (input.checked) rosterVisibleColumns.add(input.value);
      else rosterVisibleColumns.delete(input.value);
      localStorage.setItem('hrRosterVisibleColumns', JSON.stringify([...rosterVisibleColumns]));
      applyRosterColumnVisibility();
    });
    document.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    });
  }

  $$('.roster-table th[data-sort-key]').forEach(header => {
    const sort = () => {
      const key = header.dataset.sortKey;
      if (rosterSortKey === key) rosterSortAsc = !rosterSortAsc;
      else {
        rosterSortKey = key;
        rosterSortAsc = true;
      }
      renderEmployees();
    };
    header.addEventListener('click', sort);
    header.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        sort();
      }
    });
  });
  updateRosterSortIndicators();
}
