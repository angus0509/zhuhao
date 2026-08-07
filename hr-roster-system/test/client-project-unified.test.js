const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const operations = fs.readFileSync(path.join(root, 'src/services/operations.service.js'), 'utf8');
const portalRoutes = fs.readFileSync(path.join(root, 'src/routes/portal.routes.js'), 'utf8');
const operationRoutes = fs.readFileSync(path.join(root, 'src/routes/operations.routes.js'), 'utf8');

assert(html.includes('客户与项目统一录入'), '新增客户弹窗必须统一录入客户和首个项目');
assert(!html.includes('id="createProjectButton"'), '页面不应保留独立新建项目按钮');
assert(!html.includes('id="projectModal"'), '页面不应保留独立新建项目弹窗');
assert(!app.includes("'待激活'"), '客户单位不应再显示待激活状态');
assert(operations.includes('return db.transaction(async connection =>'), '客户和项目创建必须使用数据库事务');
assert(operations.includes('VALUES (:companyId, :customerId, :projectCode, :projectName'), '新增客户时必须同步写入首个项目');
assert(operations.includes('managerUserId, 2)'), '首个项目必须直接进入生效状态');
assert(portalRoutes.includes("requirePermission('customer:manage'), requirePermission('project:manage')"), '统一新增客户必须同时校验客户和项目管理权限');
assert(html.includes('id="clientManageModal"'), '企业管理员必须能打开客户项目管理弹窗');
assert(app.includes('data-manage-client'), '客户卡片必须提供点击管理入口');
assert(app.includes('openClientManagement'), '页面必须加载客户及项目详情');
assert(operations.includes('async function getCustomerDetail'), '后端必须提供客户项目详情');
assert(operations.includes('async function updateCustomerPortfolio'), '后端必须支持统一修改客户项目情况');
assert(operationRoutes.includes("router.put('/customers/:id'"), '必须提供客户项目统一更新接口');

console.log('client-project-unified-tests-ok');
