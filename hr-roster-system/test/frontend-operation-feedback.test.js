const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const readOptional = file => {
  const absolutePath = path.join(root, file);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
};

const webApi = read('public/js/core/api.js');
const webApp = read('public/app.js');
const miniRequest = read('wechat-miniprogram/miniprogram/utils/request.js');
const miniUpload = read('wechat-miniprogram/miniprogram/utils/upload.js');
const miniDownload = read('wechat-miniprogram/miniprogram/utils/download.js');
const miniFeedback = readOptional('wechat-miniprogram/miniprogram/utils/feedback.js');
const miniLogin = read('wechat-miniprogram/miniprogram/pages/login/index.js');
const miniAdd = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
const miniAdvances = read('wechat-miniprogram/miniprogram/pages/advances/index.js');
const miniTasks = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');

// Web API 统一处理对象请求体、401 登录原因和带上下文的错误。
assert.match(webApi, /normalizeRequestOptions/, 'Web API 未统一规范化请求参数');
assert.match(webApi, /JSON\.stringify\(normalized\.body\)/, '对象请求体不会自动转换为 JSON');
assert.match(webApi, /rememberAuthMessage/, '401 原因未保存到登录页');
assert.match(webApi, /操作场景|context/, '接口错误缺少操作上下文');

// 已知静默刷新失败必须改成可见提示。
for (const silentPattern of [
  /loadPermissions\(\)\.catch\(\(\) => \{\}\)/,
  /sms-summary`\)\.catch\(\(\) => null\)/
]) {
  assert.doesNotMatch(webApp, silentPattern, 'Web 仍存在会导致点击无反馈的静默失败');
}
assert.match(webApp, /操作已成功，但.*刷新失败/, 'Web 缺少“成功但刷新失败”提示');

// 小程序请求、上传和下载必须共用登录失效与错误展示工具。
assert.match(miniFeedback, /function showOperationError/, '小程序缺少统一错误展示函数');
assert.match(miniFeedback, /function rememberAuthMessage/, '小程序缺少登录失效原因传递');
assert.match(miniRequest, /rememberAuthMessage/, '普通请求 401 未传递登录失效原因');
assert.match(miniUpload, /rememberAuthMessage/, '附件上传 401 未传递登录失效原因');
assert.match(miniDownload, /rememberAuthMessage/, '附件下载 401 未传递登录失效原因');
assert.match(miniLogin, /consumeAuthMessage/, '登录页未读取登录失效原因');

// 可选数据失败可以降级，但必须明确告诉用户“部分数据加载失败”。
assert.doesNotMatch(miniAdd, /recruitment-channels'\s*\}\)\.catch\(\(\) => \[\]\)/,
  '招聘渠道加载失败仍被伪装为空数据');
assert.doesNotMatch(miniAdvances, /loadAllActiveEmployees\(\)\.catch\(\(\) => \[\]\)/,
  '预支员工加载失败仍被伪装为空数据');
assert.doesNotMatch(miniTasks, /risk-alerts'\s*\}\)\.catch\(\(\) => \[\]\)/,
  '风险加载失败仍被伪装为空数据');
assert.match([miniAdd, miniAdvances, miniTasks].join('\n'), /部分数据加载失败/,
  '小程序缺少部分数据失败提示');
assert.doesNotMatch(miniTasks, /\.catch\(\(\) => null\)/,
  '待办状态更新失败仍被静默忽略');

console.log('frontend-operation-feedback-tests-ok');
