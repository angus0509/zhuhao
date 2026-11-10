const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const db = require('../src/db');
const employeeService = require('../src/services/employee.service');

const originalFirst = db.first;
const originalQuery = db.query;
let auditParams = null;

db.first = async sql => {
  if (sql.includes('COUNT(*) AS total')) return { total: 1 };
  throw new Error(`未处理的 first SQL: ${sql.slice(0, 80)}`);
};

db.query = async (sql, params) => {
  if (sql.includes('SELECT\n      e.*')) {
    return [{
      id: 9,
      employee_no: 'YY001',
      name: '=测试员工',
      gender: 1,
      id_card_no: '110101199001011234',
      phone: '13800138000',
      employee_status: 2,
      customer_name: '示例客户',
      position_name: '操作工',
      employment_type: 1,
      fee_mode: '按人服务费',
      work_type: 1,
      hire_date: '2026-08-01',
      channel_source: '内部推荐',
      contract_no: 'HT-001',
      sign_status: 1,
      contract_start_date: '2026-08-01',
      contract_end_date: '2027-07-31'
    }];
  }
  if (sql.includes('FROM hr_labor_contract')) {
    return [{ employee_id: 9, contract_no: 'HT-001', contract_type: 1, sign_status: 1, start_date: '2026-08-01', end_date: '2027-07-31' }];
  }
  if (sql.includes('INSERT INTO hr_operation_log')) {
    auditParams = params;
    return { affectedRows: 1 };
  }
  throw new Error(`未处理的 query SQL: ${sql.slice(0, 80)}`);
};

(async () => {
  try {
    const result = await employeeService.exportEmployeesExcel(1, {}, { id: 7, dataScope: 1 }, { operatorId: 7, ipAddress: '127.0.0.1' });
    assert.ok(Buffer.isBuffer(result.buffer));
    assert.equal(result.count, 1);
    assert.match(result.fileSha256, /^[a-f0-9]{64}$/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['基本信息', '合同信息']);
    const base = workbook.getWorksheet('基本信息');
    assert.equal(base.getCell('A2').value, "'=测试员工", '危险公式首字符未转义');
    assert.equal(base.getCell('C2').value, '110101********1234', '身份证号未脱敏');
    assert.equal(base.getCell('D2').value, '138****8000', '手机号未脱敏');
    assert.equal(base.getCell('L2').value, '在职');
    assert.equal(auditParams.actionType, 'export_employee_xlsx');
    assert.ok(!auditParams.afterData.includes('110101199001011234'), '审计日志泄露完整身份证号');
    assert.ok(!auditParams.afterData.includes('PK'), '审计日志不应包含 XLSX 文件正文');

    const csvResult = await employeeService.exportEmployeesCsv(1, {}, { id: 7, dataScope: 1 }, { operatorId: 7, ipAddress: '127.0.0.1' });
    const [csvHeader] = csvResult.csv.replace(/^\uFEFF/, '').split('\n');
    assert.equal(csvHeader, '姓名,手机号,客户单位,岗位,用工模式,费用模式,工资类型,入职日期,合同状态,风险数,员工状态');
    assert.doesNotMatch(csvResult.csv, /雇主险|保障中|未投保/, 'CSV 仍导出雇主险信息');
    assert.equal(auditParams.actionType, 'export_employee');
    console.log('excel-export-workbook-tests-ok');
  } finally {
    db.first = originalFirst;
    db.query = originalQuery;
    await db.pool.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
