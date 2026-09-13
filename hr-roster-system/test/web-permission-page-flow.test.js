const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const systemService = read('src/services/system.service.js');
const authMiddleware = read('src/middlewares/auth.middleware.js');
const systemRoutes = read('src/routes/system.routes.js');

assert.ok(!html.includes('id="roleConfigArea"'), '权限页面仍重复展示独立角色配置区');
assert.match(app, /const configButton = canManageRolePermissions[\s\S]*data-config-role=/, '角色卡片缺少受控的直接配置权限入口');
assert.ok(!app.includes("$('#roleConfigArea').innerHTML"), '前端仍尝试渲染已删除的重复配置区');
assert.match(app, /permCount}项权限/, '角色卡片没有使用紧凑权限数量摘要');
assert.match(systemService, /c\.customer_name customerName/, '系统账号授权项目接口缺少客户单位名称');
assert.match(systemService, /customerName:\s*p\.customerName/, '系统账号授权项目结果没有返回客户单位名称');
assert.match(app, /const canManageSystemUsers = isCompanyAdmin;/, '系统账号管理动作没有显式限定企业管理员');
assert.match(app, /canManageSystemUsers[\s\S]*data-edit-user=/, '编辑、重置密码和启停按钮未受企业管理员权限控制');
assert.match(app, /canManageRolePermissions = isCompanyAdmin;/, '角色权限配置入口没有显式限定企业管理员');
assert.match(app, /canManageRolePermissions[\s\S]*data-config-role=/, '角色权限配置按钮未受企业管理员权限控制');
assert.match(authMiddleware, /function requireCompanyAdmin\(/, '后端缺少企业管理员专用鉴权中间件');
assert.match(systemRoutes, /router\.post\('\/system\/users', requirePermission\('system:role'\), requireCompanyAdmin,/, '新增系统账号接口未限制企业管理员');
assert.match(systemRoutes, /router\.put\('\/system\/roles\/:id\/permissions', requirePermission\('system:role'\), requireCompanyAdmin,/, '角色权限保存接口未限制企业管理员');

console.log('web-permission-page-flow-tests-ok');
