const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const app = read('public/app.js');
const html = read('public/index.html');
const routes = read('src/routes/system.routes.js');
const controller = read('src/controllers/system.controller.js');
const service = read('src/services/system.service.js');
const operations = read('src/services/operations.service.js');

assertIncludes(app, 'data-action="assign-onsite"', '项目卡缺少派遣驻厂操作');
assertIncludes(app, '>派遣驻厂</button>', '项目卡按钮名称未调整为“派遣驻厂”');
assertIncludes(app, "if (action === 'assign-onsite')", '派遣驻厂按钮没有点击处理');
assertIncludes(app, 'openProjectOnsiteModal(Number(actionButton.dataset.project))', '派遣驻厂未关联当前项目');
assertIncludes(app, 'async function openProjectOnsiteModal(projectId)', '缺少驻厂专员选择弹窗加载逻辑');
assertIncludes(app, 'async function saveProjectOnsiteAssignment(event)', '缺少驻厂项目授权保存逻辑');
assertIncludes(html, 'id="projectOnsiteModal"', '缺少派遣驻厂弹窗');
assertIncludes(html, 'id="projectOnsiteAssigneeList"', '派遣驻厂弹窗缺少驻厂专员列表');

assertIncludes(routes, "router.get('/system/projects/:id/onsite-assignees'", '缺少驻厂项目授权查询接口');
assertIncludes(routes, "router.put('/system/projects/:id/onsite-assignees'", '缺少驻厂项目授权保存接口');
assertIncludes(controller, 'getProjectOnsiteAssignees', '控制器缺少驻厂项目授权查询');
assertIncludes(controller, 'updateProjectOnsiteAssignees', '控制器缺少驻厂项目授权保存');
assertIncludes(service, 'async function getProjectOnsiteAssignees', '服务层缺少驻厂项目授权查询');
assertIncludes(service, 'async function updateProjectOnsiteAssignees', '服务层缺少驻厂项目授权保存');
assertIncludes(service, "r.role_code = 'onsite_staff'", '驻厂人员候选账号未限定 onsite_staff 角色');
assertIncludes(service, 'INSERT IGNORE INTO sys_user_project', '保存时未写入用户项目授权关系');
assertIncludes(service, 'DELETE up FROM sys_user_project up', '取消派遣时未撤销原驻厂项目授权');
assertIncludes(service, "'project_onsite_assignment'", '派遣驻厂敏感操作未写审计日志');
assertIncludes(operations, 'onsiteManagerNames', '项目列表未返回已派遣驻厂专员');

console.log('客户项目派遣驻厂授权链路检查通过。');
