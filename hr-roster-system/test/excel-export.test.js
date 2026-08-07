const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const service = read('src/services/employee.service.js');
const controller = read('src/controllers/employee.controller.js');
const routes = read('src/routes/employee.routes.js');
const index = read('public/index.html');
const app = read('public/app.js');
const roster = read('public/js/views/roster.js');

assert(service.includes("require('exceljs')"), '服务端未引入 ExcelJS');
assert(service.includes("addWorksheet('基本信息')"), '缺少基本信息 Sheet');
assert(service.includes("addWorksheet('合同信息')"), '缺少合同信息 Sheet');
assert(service.includes("addWorksheet('雇主险信息')"), '缺少雇主险信息 Sheet');
assert(service.includes("actionType: 'export_employee_xlsx'"), 'XLSX 导出未写独立审计日志');
assert(service.includes('fileSha256'), 'XLSX 导出未记录文件摘要');
assert(service.includes('safeExcelText'), 'XLSX 导出缺少公式注入防护');
assert(routes.includes("'/export/employees.xlsx', sensitiveLimiter, requirePermission('employee:export')"), 'XLSX 接口缺少限流或导出权限');
assert(controller.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'XLSX 响应类型不正确');
assert(index.includes('id="exportXlsxLink"'), '花名册缺少 XLSX 导出入口');
assert(app.includes("exportEmployees(event, 'xlsx')"), 'XLSX 导出按钮未绑定下载逻辑');
assert(roster.includes("async function exportEmployees(event, format = 'csv')"), 'XLSX 导出逻辑未迁移到花名册视图');

console.log('excel-export-tests-ok');
