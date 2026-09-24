(function initPayrollImport(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PayrollImport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function payrollImportFactory() {
  const identityFields = new Set(['employeeNo', 'employeeName', 'idCardNo', 'phone']);
  const incomeFields = [
    'baseSalary', 'positionSalary', 'performanceSalary', 'allowanceAmount',
    'pieceAmount', 'overtime15Amount', 'overtime20Amount', 'overtime30Amount'
  ];
  const deductionFields = ['socialDeduction', 'taxDeduction', 'advanceDeduction', 'otherDeduction'];

  function parseDelimitedRows(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
    const firstLine = source.split('\n').find(line => line.trim()) || '';
    const delimiterCounts = ['\t', ',', ';', '|'].map(delimiter => {
      let count = 0;
      let quoted = false;
      for (const char of firstLine) {
        if (char === '"') quoted = !quoted;
        else if (char === delimiter && !quoted) count += 1;
      }
      return { delimiter, count };
    });
    const detectedDelimiter = delimiterCounts.sort((left, right) => right.count - left.count)[0];
    const separator = detectedDelimiter.count > 0 ? detectedDelimiter.delimiter : ',';
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === separator && !quoted) {
        row.push(cell.trim());
        cell = '';
      } else if (char === '\n' && !quoted) {
        row.push(cell.trim());
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    row.push(cell.trim());
    if (row.some(value => value !== '')) rows.push(row);
    return rows;
  }

  function normalizeHeader(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/[（(]\s*(?:元|人民币|rmb)\s*[)）]/gi, '')
      .replace(/[\s\u3000·•,，。:：;；_\-—/\\()（）【】\[\]<>《》.]/g, '');
  }

  const definitions = {
    employeeNo: ['工号', '员工工号', '员工编号', '人员编号', '职工编号', '编号', 'Employee No', 'Employee ID', 'Staff No', 'Staff ID'],
    employeeName: ['姓名', '员工姓名', '人员姓名', '职工姓名', '名字', 'Name', 'Employee Name', 'Full Name'],
    idCardNo: ['身份证号', '身份证号码', '证件号', '证件号码', '身份证号证件号码', 'ID Card No', 'ID Number', 'National ID'],
    phone: ['手机号', '手机号码', '联系电话', '员工手机号', '电话', 'Phone', 'Mobile', 'Tel'],
    baseSalary: ['基本工资', '底薪', '基础工资', '基本薪资', '底薪工资', 'Basic Salary', 'Base Salary', 'Basic Pay', 'Basic Wage'],
    positionSalary: ['岗位工资', '岗位薪资', '岗位津贴', '岗位补贴', 'Position Salary', 'Post Salary', 'Position Allowance'],
    performanceSalary: ['绩效工资', '绩效', '绩效薪资', '绩效奖金', 'Performance Salary', 'Performance Bonus', 'Merit Pay'],
    allowanceAmount: ['补贴', '补助', '津贴', '补贴合计', '各类补贴', '餐补', '餐费补贴', '交通补贴', '住房补贴', '夜班补贴', '高温补贴', '全勤奖', '奖金', '奖励', '工龄工资', 'Allowance', 'Subsidy', 'Bonus', 'Incentive'],
    pieceAmount: ['计件工资', '计件金额', '计件薪资', '计件', 'Piece Rate', 'Piece Wage', 'Piecework Pay'],
    overtime15Amount: ['15倍加班费', '15倍加班', '加班15倍', '加班15倍工资', '平时加班费', '工作日加班费', 'Overtime 1.5x', 'Overtime 1.5', 'OT 1.5'],
    overtime20Amount: ['2倍加班费', '20倍加班费', '加班2倍', '加班20倍', '周末加班费', '休息日加班费', 'Overtime 2x', 'Overtime 2', 'OT 2'],
    overtime30Amount: ['3倍加班费', '30倍加班费', '加班3倍', '加班30倍', '法定节假日加班费', '节假日加班费', 'Overtime 3x', 'Overtime 3', 'OT 3'],
    grossAmount: ['应发工资', '应发合计', '应发金额', '应发薪资', '工资合计', '应发', '应付工资', '应付合计', '应付金额', '应付薪资', '税前工资', '工资应发', 'Gross Pay', 'Gross Salary', 'Total Pay', 'Gross Amount'],
    socialDeduction: ['社保扣款', '社保个人部分', '个人社保', '社保', '社会保险', 'Social Insurance', 'Social Security'],
    taxDeduction: ['个税', '个人所得税', '代扣个税', '个人所得税扣款', '税款', '扣税', 'Tax', 'Income Tax', 'IIT', 'PAYE'],
    advanceDeduction: ['预支扣回', '预支款', '工资预支', '借款扣回', '预支工资', 'Advance', 'Advance Deduction', 'Salary Advance'],
    otherDeduction: ['其他扣款', '其它扣款', '其他扣除', '扣款合计', '住宿费', '住宿扣款', '宿舍费', '水电费', '餐费扣款', '工服扣款', '罚款', 'Other Deduction', 'Deductions'],
    netAmount: ['实发工资', '实发合计', '实发金额', '实付工资', '实发薪资', '实发', '实领工资', '实领金额', '到手工资', '实际发放', '发放金额', '发放工资', '到账工资', '实际到账', '到账金额', 'Net Pay', 'Net Salary', 'Take Home Pay', 'Net Amount']
  };

  const aliasMap = new Map();
  Object.entries(definitions).forEach(([field, aliases]) => {
    aliases.forEach(alias => aliasMap.set(normalizeHeader(alias), field));
  });

  function headerMapping(row) {
    const mapping = {};
    const recognizedHeaders = [];
    const ignoredHeaders = [];
    (row || []).forEach((cell, index) => {
      const original = String(cell == null ? '' : cell).trim();
      const field = aliasMap.get(normalizeHeader(original));
      if (field) {
        if (!mapping[field]) mapping[field] = [];
        mapping[field].push(index);
        recognizedHeaders.push({ field, index, header: original });
      } else if (original) {
        ignoredHeaders.push({ index, header: original, duplicate: false });
      }
    });
    const identityCount = Object.keys(mapping).filter(field => identityFields.has(field)).length;
    const amountCount = Object.keys(mapping).filter(field => incomeFields.includes(field)
      || deductionFields.includes(field) || field === 'grossAmount' || field === 'netAmount').length;
    return {
      headers: (row || []).map(cell => String(cell == null ? '' : cell).trim()),
      mapping,
      recognizedHeaders,
      ignoredHeaders,
      identityCount,
      amountCount,
      score: recognizedHeaders.length + identityCount * 4 + amountCount * 2
    };
  }

  const headerNoise = new Set(['元', '金额', '人民币', 'rmb', '单位'].map(normalizeHeader));

  function mergeHeaderRowsMulti(headerRows = []) {
    const columnCount = headerRows.reduce((max, row) => Math.max(max, (row || []).length), 0);
    return Array.from({ length: columnCount }, (_, index) => {
      for (let r = headerRows.length - 1; r >= 0; r -= 1) {
        const text = String(headerRows[r][index] == null ? '' : headerRows[r][index]).trim();
        if (!text) continue;
        if (headerNoise.has(normalizeHeader(text))) continue;
        return text;
      }
      return '';
    });
  }

  function compareHeaderCandidates(left, right) {
    return right.score - left.score || left.rowCount - right.rowCount || left.index - right.index;
  }

  function detectHeaderRow(rows) {
    const inspectedRows = (rows || []).slice(0, 20);
    const candidates = [];
    const maxHeaderRows = Math.min(5, inspectedRows.length);
    for (let rowCount = 1; rowCount <= maxHeaderRows; rowCount += 1) {
      for (let index = 0; index + rowCount <= inspectedRows.length; index += 1) {
        candidates.push({
          index,
          rowCount,
          ...headerMapping(mergeHeaderRowsMulti(inspectedRows.slice(index, index + rowCount)))
        });
      }
    }
    const complete = candidates
      .filter(item => item.identityCount > 0 && item.amountCount > 0)
      .sort(compareHeaderCandidates)[0];
    if (complete) return complete;
    const best = candidates.sort(compareHeaderCandidates)[0];
    if (!best || best.identityCount === 0) throw new Error('未识别到员工身份列，请至少包含姓名、工号、身份证号或手机号其中一列');
    return best;
  }

  function isNumericCell(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text.startsWith('=')) return false;
    return Number.isFinite(Number(text.replace(/[￥¥,，\s]/g, '')));
  }

  function customCategory(sourceHeader, values) {
    const header = String(sourceHeader || '').trim();
    const numeric = values.length > 0 && values.every(isNumericCell);
    if (!numeric) return 'display';
    if (/扣|扣除|代扣|税|罚|水电|住宿|宿舍|预支|借款|tax|deduction|social|insurance|advance|loan|withhold/i.test(header)) return 'deduction';
    if (/工资|薪资|薪酬|收入|应发|应付|奖金|奖励|奖$|补贴|补助|津贴|提成|计件|加班费|佣金|绩效|底薪|薪金|劳务费|salary|wage|pay|bonus|allowance|subsidy|incentive|commission|overtime|\bot\b|piece|merit/i.test(header)) {
      return 'income';
    }
    return 'display';
  }

  function categoryForField(field) {
    return identityFields.has(field) ? '' : 'display';
  }

  function sensitiveHeader(header) {
    const label = String(header || '').trim();
    const chineseSensitive = /姓名|工号|员工编号|人员编号|身份证|证件号|手机号|手机号码|联系电话|银行卡|银行账号|卡号/;
    const englishSensitive = /(?:^|[^a-z])(?:(?:employee|staff|worker)\s*(?:name|no|number|id)|full\s*name|id\s*(?:card|number)|national\s*id|phone|mobile|telephone|tel|contact\s*(?:phone|number)|bank\s*(?:account|card)|account\s*(?:no|number)|card\s*(?:no|number)|iban)(?:$|[^a-z])/i;
    return chineseSensitive.test(label) || /^name$/i.test(label) || englishSensitive.test(label);
  }

  function buildSuggestedMapping(headers, sampleRows = []) {
    if (!Array.isArray(headers) || headers.length > 100) throw new Error('工资表最多支持100列');
    const mapping = headers.map((header, columnIndex) => {
      const sourceHeader = String(header == null ? '' : header).trim();
      if (sourceHeader.length > 50) throw new Error(`工资项目名称最多50个字符：第${columnIndex + 1}列`);
      const field = aliasMap.get(normalizeHeader(sourceHeader));
      if (field) {
        return {
          columnIndex,
          sourceHeader,
          target: field,
          category: categoryForField(field),
          includeInPayslip: !identityFields.has(field)
        };
      }
      if (!sourceHeader || sensitiveHeader(sourceHeader)) {
        return { columnIndex, sourceHeader, target: 'ignore', category: '', includeInPayslip: false };
      }
      return { columnIndex, sourceHeader, target: 'custom', category: 'display', includeInPayslip: true };
    });
    const netColumns = mapping.filter(item => item.target === 'netAmount');
    netColumns.slice(0, -1).forEach(item => {
      item.target = 'custom';
      item.category = 'display';
      item.includeInPayslip = true;
    });
    const grossColumns = mapping.filter(item => item.target === 'grossAmount');
    grossColumns.slice(1).forEach(item => {
      item.target = 'custom';
      item.category = 'display';
      item.includeInPayslip = true;
    });
    return mapping;
  }

  function validateColumnMapping(mapping, options = {}) {
    if (!Array.isArray(mapping) || !mapping.length || mapping.length > 100) throw new Error('工资字段映射无效或超过100列');
    const allowedTargets = new Set([...identityFields, ...incomeFields, ...deductionFields, 'grossAmount', 'netAmount', 'custom', 'ignore']);
    const allowedCategories = new Set(['', 'income', 'deduction', 'summary', 'display']);
    const identityCount = mapping.filter(item => identityFields.has(item.target)).length;
    if (!identityCount) throw new Error('请至少指定一列员工姓名、工号、身份证号或手机号');
    const netCount = mapping.filter(item => item.target === 'netAmount').length;
    if (options.requireNet !== false && netCount !== 1) throw new Error('必须且只能指定一列实发工资');
    const criticalTargets = [...identityFields, 'grossAmount', 'netAmount'];
    if (criticalTargets.some(target => mapping.filter(item => item.target === target).length > 1)) {
      throw new Error('员工身份、应发工资或实发工资等关键字段不能重复映射');
    }
    const displayed = mapping.filter(item => item.includeInPayslip === true);
    if (displayed.length > 80) throw new Error('单人工资项目最多80项');
    const indexes = new Set();
    mapping.forEach(item => {
      if (!Number.isInteger(item.columnIndex) || item.columnIndex < 0 || indexes.has(item.columnIndex)) throw new Error('工资字段映射列号重复或无效');
      indexes.add(item.columnIndex);
      if (!allowedTargets.has(item.target) || !allowedCategories.has(item.category || '')) throw new Error('工资字段映射类型无效');
      if (String(item.sourceHeader || '').length > 50) throw new Error('工资项目名称最多50个字符');
    });
    return mapping;
  }

  function standardMappingFromColumns(mapping) {
    const result = {};
    mapping.forEach(item => {
      let field = item.target;
      if (field === 'custom') return;
      if (!identityFields.has(field) && field !== 'grossAmount' && field !== 'netAmount') return;
      if (!definitions[field]) return;
      if (!result[field]) result[field] = [];
      result[field].push(item.columnIndex);
    });
    return result;
  }

  function buildItemSnapshot(row, mapping, errors) {
    const items = [];
    mapping.slice().sort((left, right) => left.columnIndex - right.columnIndex).forEach(item => {
      if (!item.includeInPayslip || item.target === 'ignore' || identityFields.has(item.target)) return;
      const raw = String(row[item.columnIndex] == null ? '' : row[item.columnIndex]).trim();
      if (!raw) return;
      if (sensitiveHeader(item.sourceHeader)) return;
      if (raw.startsWith('=')) {
        errors.push(`${item.sourceHeader || '工资项目'}不能使用公式，请将单元格转换为固定值`);
        return;
      }
      items.push({
        label: item.sourceHeader,
        value: raw,
        category: 'display',
        sortOrder: items.length + 1
      });
    });
    return items;
  }

  function amountValue(value, label, errors) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return 0;
    if (/^[=]/.test(text)) {
      errors.push(`${label}不能使用公式，请将单元格转换为数值`);
      return 0;
    }
    const normalized = text
      .replace(/^\s*(?:RMB|CNY)\s*/i, '')
      .replace(/[￥¥,，\s]/g, '')
      .replace(/(?:人民币|元|RMB|CNY)$/i, '');
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.push(`${label}必须为非负数字`);
      return 0;
    }
    return Math.round(amount * 100) / 100;
  }

  function textValue(row, mapping, field) {
    const indexes = mapping[field] || [];
    for (const index of indexes) {
      const value = String(row[index] == null ? '' : row[index]).trim();
      if (value) return value;
    }
    return '';
  }

  function amountFieldValue(row, mapping, field, errors) {
    const indexes = mapping[field] || [];
    return indexes.reduce((sum, index) => {
      const raw = String(row[index] == null ? '' : row[index]).trim();
      if (!raw) return sum;
      return Math.round((sum + amountValue(raw, definitions[field][0], errors)) * 100) / 100;
    }, 0);
  }

  function isSummaryRow(row, mapping) {
    const identityValues = [...identityFields]
      .map(field => textValue(row, mapping, field))
      .filter(Boolean);
    const firstText = (row || []).map(cell => String(cell == null ? '' : cell).trim()).find(Boolean) || '';
    const label = identityValues.length === 1 ? identityValues[0] : (identityValues.length === 0 ? firstText : '');
    return /^(?:本月|本表|工资)?(?:合计|总计|小计)(?:[（(\s:]|$)/.test(label);
  }

  function isUnitRow(row) {
    const nonEmpty = (row || []).map(cell => String(cell == null ? '' : cell).trim()).filter(Boolean);
    if (!nonEmpty.length) return false;
    return nonEmpty.every(cell => headerNoise.has(normalizeHeader(cell)));
  }

  function parseDataRow(row, mapping, rowNumber, columnMapping = []) {
    const errors = [];
    const warnings = [];
    const item = {
      rowNumber,
      employeeNo: textValue(row, mapping, 'employeeNo'),
      employeeName: textValue(row, mapping, 'employeeName'),
      idCardNo: textValue(row, mapping, 'idCardNo').toUpperCase(),
      phone: textValue(row, mapping, 'phone'),
      errors,
      warnings
    };
    if (!item.employeeNo && !item.employeeName && !item.idCardNo && !item.phone) {
      errors.push('缺少员工身份信息');
    }
    for (const field of [...incomeFields, ...deductionFields, 'grossAmount', 'netAmount']) {
      item[field] = amountFieldValue(row, mapping, field, errors);
    }

    item.itemSnapshot = buildItemSnapshot(row, columnMapping, errors);
    item.errors = [...new Set(errors)];
    return item;
  }

  function parseMappedPayrollRows(rows, header, mapping, options = {}) {
    validateColumnMapping(mapping, { requireNet: options.requireNet !== false });
    const dataStartIndex = Number(header.index || 0) + Number(header.rowCount || 1);
    const standardMapping = standardMappingFromColumns(mapping);
    const sourceRows = rows.slice(dataStartIndex)
      .map((row, offset) => ({ row, rowNumber: dataStartIndex + offset + 1 }))
      .filter(item => (item.row || []).some(cell => String(cell == null ? '' : cell).trim() !== ''));
    const summaryRows = sourceRows.filter(item => isSummaryRow(item.row, standardMapping) || isUnitRow(item.row));
    const dataRows = sourceRows.filter(item => !isSummaryRow(item.row, standardMapping) && !isUnitRow(item.row));
    if (!dataRows.length) throw new Error('工资表中没有员工数据');
    if (dataRows.length > 500) throw new Error('单个工资批次最多500人');
    return {
      ignoredSummaryRowCount: summaryRows.length,
      rows: dataRows.map(item => parseDataRow(item.row, standardMapping, item.rowNumber, mapping))
    };
  }

  function parseFlexiblePayrollRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('工资表为空');
    const header = detectHeaderRow(rows);
    const dataStartIndex = header.index + header.rowCount;
    const sampleRows = rows.slice(dataStartIndex, dataStartIndex + 20);
    const columnMapping = buildSuggestedMapping(header.headers, sampleRows);
    const hasAmount = columnMapping.some(item => [...incomeFields, ...deductionFields, 'grossAmount', 'netAmount'].includes(item.target));
    if (!hasAmount) throw new Error('未识别到工资金额列，请至少包含基本工资、应发工资、实发工资等金额列');
    const parsed = parseMappedPayrollRows(rows, header, columnMapping, { requireNet: false });
    return {
      headerRowIndex: header.index,
      headerRowCount: header.rowCount,
      mappings: header.recognizedHeaders,
      headers: header.headers,
      columnMapping,
      ignoredHeaders: columnMapping.filter(item => item.target === 'ignore'),
      ignoredColumnCount: columnMapping.filter(item => item.target === 'ignore').length,
      ignoredSummaryRowCount: parsed.ignoredSummaryRowCount,
      rows: parsed.rows
    };
  }

  return {
    parseDelimitedRows,
    normalizeHeader,
    detectHeaderRow,
    buildSuggestedMapping,
    validateColumnMapping,
    parseMappedPayrollRows,
    parseFlexiblePayrollRows,
    definitions
  };
}));
