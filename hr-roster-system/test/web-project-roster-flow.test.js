const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const employeeService = read('src/services/employee.service.js');
const prototype = read('server.js');

assert.match(html, /id="projectSelect" name="projectId"/, '花名册缺少项目筛选');
assert.ok(!html.includes('甲方确认') && !html.includes('结算对账'), '客户项目仍展示已取消的甲方交付流程');
assert.match(html, /新增客户[\s\S]*派遣驻厂[\s\S]*员工到岗[\s\S]*在职管理/, '客户项目内部流程顺序不完整');
assert.match(app, /data-project-roster=/, '项目卡缺少查看项目员工入口');
assert.match(app, /const canViewEmployees = isCompanyAdmin[\s\S]*employee:view/, '项目卡未按员工查看权限控制入口');
assert.match(app, /canViewEmployees \? `<button class="quick-btn"[^`]*data-project-roster=/, '无员工权限的账号仍会看到项目员工入口');
assert.match(app, /function openProjectRoster\(projectId\)/, '缺少项目到花名册的统一跳转逻辑');
assert.match(employeeService, /projectId:\s*query\.projectId \? Number\(query\.projectId\) : null/, '生产员工查询缺少项目筛选参数');
assert.match(employeeService, /\(:projectId IS NULL OR j\.project_id = :projectId\)/, '生产员工查询缺少项目范围条件');
assert.match(prototype, /const projectId = searchParams\.get\('projectId'\)/, '原型员工查询缺少项目筛选参数');

console.log('web-project-roster-flow-tests-ok');
