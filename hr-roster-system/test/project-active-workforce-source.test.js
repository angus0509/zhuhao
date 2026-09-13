const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/services/operations.service.js'), 'utf8');
const listProjects = source.slice(source.indexOf('async function listProjects'), source.indexOf('async function createProject'));
const operationsHome = source.slice(source.indexOf('async function operationsHome'), source.indexOf('async function createNotice'));

assert.match(listProjects, /hr_employee_job project_job[\s\S]*project_job\.project_id = p\.id[\s\S]*project_job\.job_status = 1/, '项目在岗人数未读取当前任职关系');
assert.match(listProjects, /project_employee\.employee_status = 2[\s\S]*project_employee\.deleted_at IS NULL/, '项目在岗人数未限定有效在职员工');
assert.doesNotMatch(listProjects, /FROM factory_staff fs/, '项目健康度仍读取已停用的驻厂人员表');

assert.match(operationsHome, /FROM hr_employee_job home_job[\s\S]*home_job\.job_status = 1[\s\S]*home_employee\.employee_status = 2/, '办公中心当前在岗未读取有效任职员工');
assert.doesNotMatch(operationsHome, /FROM factory_staff fs JOIN labor_project/, '办公中心当前在岗仍读取已停用的驻厂人员表');

console.log('project-active-workforce-source-tests-ok');
