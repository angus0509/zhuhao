const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const service = read('src/services/employee.service.js');
const controller = read('src/controllers/employee.controller.js');
const page = read('public/index.html');
const app = read('public/app.js');
const migration = read('sql/migrate-onsite-employee-edit-permission-20260806.mysql.sql');
const deploy = read('scripts/deploy-production.sh');

if (!page.includes('id="formProjectSelect"') || !page.includes('id="mFormProjectSelect"')) {
  throw new Error('新增及编辑员工表单缺少所属项目');
}
if (!app.includes("permissions.includes('employee:update')")) throw new Error('花名册编辑按钮未按 employee:update 权限显示');
if (controller.includes('canReadForEditing')) throw new Error('employee:update 不得绕过敏感信息独立权限');
if (!controller.includes("req.user.permissions.includes('employee:sensitive:view')")) throw new Error('员工敏感信息未使用独立权限');
if (!service.includes('j.project_id IN (${keys.join(\', \')})')) throw new Error('员工服务未按授权项目隔离驻厂员工');
if (!service.includes('ownerLegacyCondition')) throw new Error('驻厂人员无法继续管理自己录入的未分配项目历史员工');
if (!service.includes('applyDataScope(where, params, await resolveDataScope(companyId, user));')) throw new Error('驻厂“我的员工”列表未叠加当前项目授权范围');
if (!service.includes('await assertNewEmployeeScope(companyId, normalizedBody, user, connection);')) throw new Error('编辑员工时未校验目标项目范围');
if (!service.includes('project_id = :projectId')) throw new Error('编辑员工时无法保存所属项目');
if (!service.includes("throw createError('授权项目范围账号必须选择所属项目'")) throw new Error('驻厂新增或编辑员工未强制关联授权项目');
if (!service.includes("throw createError('该身份证号已存在员工档案')")) throw new Error('员工编辑缺少身份证重复校验');
if (!service.includes('projectName ? projectMap.get')) throw new Error('批量录入未支持所属项目精确关联');
if (!migration.includes("p.permission_code='employee:update'") || !migration.includes("r.role_code='onsite_staff'")) throw new Error('缺少驻厂员工编辑权限迁移');
if (!deploy.includes('migrate-onsite-employee-edit-permission-20260806.mysql.sql') || !deploy.includes('ONSITE_EDIT_BROKEN')) throw new Error('生产部署未执行或核对驻厂编辑权限迁移');

console.log('roster-edit-scope-tests-ok');
