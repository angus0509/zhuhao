const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/styles.css');
const service = read('src/services/system.service.js');
const authService = read('src/services/auth.service.js');

assertIncludes(html, 'class="modal role-permission-modal" id="rolePermissionModal"', '角色权限弹窗缺少独立竖版布局');
assertIncludes(html, 'id="rolePermissionCount"', '权限配置缺少已选/全部数量提示');
assertIncludes(html, 'id="rolePermissionSearch"', '权限配置缺少权限搜索');
assertIncludes(html, 'id="rolePermissionSelectAll"', '权限配置缺少全选入口');
assertIncludes(html, 'id="rolePermissionClearAll"', '权限配置缺少清空入口');
assertIncludes(app, 'function updateRolePermissionCount()', '权限数量未随选择更新');
assertIncludes(app, 'function filterRolePermissionTree(keyword)', '权限树缺少搜索过滤逻辑');
assertIncludes(app, 'locked ? collectPermissionCodes(_permTree)', '企业管理员未固定显示全部有效权限');
assertIncludes(app, "$('#rolePermissionSelectAll').addEventListener('click'", '全选权限按钮未绑定');
assertIncludes(app, "$('#rolePermissionClearAll').addEventListener('click'", '清空权限按钮未绑定');
assertIncludes(css, '.role-permission-modal-panel', '权限弹窗缺少独立可滚动布局');
assertIncludes(css, 'width: min(580px, calc(100vw - 28px))', '权限配置弹窗未调整为竖版宽度');
assertIncludes(css, 'max-height: min(92dvh, 900px)', '权限弹窗高度未限制在可视区域');
assertIncludes(css, 'grid-template-columns: 1fr 1fr', '竖版权限工具栏未使用分行布局');
assertIncludes(css, '#rolePermissionTree', '权限树缺少独立滚动区域');
assertIncludes(service, 'FROM sys_permission WHERE status = 1 ORDER BY sort_no, id', '后端未返回全部启用权限');
assertIncludes(authService, "roles.some(role => role.role_code === 'company_admin')", '企业管理员登录权限未兜底为全部有效权限');

console.log('权限配置完整显示、搜索、全选与滚动检查通过。');
