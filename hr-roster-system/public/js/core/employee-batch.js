(function initEmployeeBatch(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.EmployeeBatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createEmployeeBatch() {
  // 模板、上传解析和接口字段共用这一份定义，避免改表头后出现整列错位。
  const fields = [
    { key: 'name', header: '姓名', aliases: ['员工姓名'], example: '张三', required: true },
    { key: 'gender', header: '性别', example: '男' },
    { key: 'education', header: '学历', example: '大专' },
    { key: 'idCardNo', header: '身份证号码', aliases: ['身份证号', '证件号码'], example: '320101199001011234' },
    { key: 'address', header: '地址', aliases: ['身份证地址', '住宅地址'], example: '江苏省常州市新北区示例路1号' },
    { key: 'phone', header: '电话', aliases: ['手机号', '手机号码', '联系电话'], example: '13800138000' },
    { key: 'customerName', header: '工作单位', aliases: ['客户单位', '单位'], example: '某制造公司' },
    { key: 'projectName', header: '所属项目', aliases: ['项目', '项目名称'], example: '一厂项目' },
    { key: 'positionName', header: '岗位', aliases: ['岗位名称'], example: '普工' },
    { key: 'workType', header: '工资类型', aliases: ['计薪方式'], example: '计时' },
    { key: 'hireDate', header: '入职日期', aliases: ['预计入职日期'], example: '2026-08-18' },
    { key: 'employmentType', header: '用工模式', example: '派遣' },
    { key: 'feeMode', header: '费用模式', example: '' },
    { key: 'channelSource', header: '招聘渠道', aliases: ['招聘来源', '招聘人', '供应商'], example: '员工介绍' },
    { key: 'remark', header: '备注', example: '' },
    { key: 'bankName', header: '开户行', example: '工商银行常州分行' },
    { key: 'bankCardNo', header: '银行卡号', example: '6212000000000000000' },
    { key: 'emergencyContact', header: '紧急联系人', example: '李四' },
    { key: 'emergencyPhone', header: '紧急电话', aliases: ['紧急联系人电话'], example: '13900139000' },
    { key: 'employeeStatus', header: '录入状态', aliases: ['状态'], example: '待到岗' }
  ];

  const headers = fields.map(field => field.header);
  const example = fields.map(field => field.example);
  const normalizeHeader = value => String(value || '').replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
  const headerMap = new Map();
  fields.forEach(field => {
    [field.header, ...(field.aliases || [])].forEach(label => headerMap.set(normalizeHeader(label), field));
  });

  function inspectEmployeeHeaders(actualHeaders) {
    const columns = (actualHeaders || []).map(value => {
      const actual = String(value || '').trim();
      const field = headerMap.get(normalizeHeader(actual));
      return { actual, canonical: field?.header || '', key: field?.key || '' };
    });
    const recognizedKeys = new Set(columns.map(column => column.key).filter(Boolean));
    return {
      columns,
      missingRequired: fields.filter(field => field.required && !recognizedKeys.has(field.key)).map(field => field.header)
    };
  }

  function parseDelimitedRows(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
    const separator = source.split('\n').find(line => line.trim())?.includes('\t') ? '\t' : ',';
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

  function parseEmployeeBatchTable(text) {
    const rows = parseDelimitedRows(text);
    if (!rows.length) throw new Error('请粘贴至少一行数据');

    const firstRowMatches = rows[0].map(value => headerMap.get(normalizeHeader(value)) || null);
    const recognizedCount = firstRowMatches.filter(Boolean).length;
    const hasHeader = recognizedCount >= 2 || firstRowMatches.some(field => field?.key === 'name');
    let mappings = fields.map((field, index) => ({ field, index }));
    let dataRows = rows;

    if (hasHeader) {
      const seen = new Set();
      mappings = firstRowMatches.flatMap((field, index) => {
        if (!field) return [];
        if (seen.has(field.key)) throw new Error(`表头“${field.header}”重复，请只保留一列`);
        seen.add(field.key);
        return [{ field, index }];
      });
      const missing = fields.filter(field => field.required && !seen.has(field.key)).map(field => field.header);
      if (missing.length) throw new Error(`缺少必需表头：${missing.join('、')}`);
      dataRows = rows.slice(1);
    }

    if (!dataRows.length) throw new Error('请粘贴至少一行数据');
    if (dataRows.length > 200) throw new Error('单次最多录入200行');
    return dataRows.map(row => Object.fromEntries(
      mappings.map(({ field, index }) => [field.key, String(row[index] || '').trim()])
    ));
  }

  return { fields, headers, example, inspectEmployeeHeaders, parseEmployeeBatchTable };
}));
