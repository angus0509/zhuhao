const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'wechat-miniprogram', 'miniprogram');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// 校验 app.json 声明的每个页面都具备微信小程序要求的四类文件。
const appJson = JSON.parse(read('wechat-miniprogram/miniprogram/app.json'));
assert(appJson.pages.includes('pages/tasks/index'), '小程序未注册风险与合规处理页');
for (const page of appJson.pages || []) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert(fs.existsSync(path.join(miniRoot, `${page}.${extension}`)), `页面文件缺失：${page}.${extension}`);
  }
}

const homeWxml = read('wechat-miniprogram/miniprogram/pages/home/index.wxml');
const taskJs = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');
assert(homeWxml.includes('bindtap="goAddEmployee"'), '首页缺少录入新员工入口');
assert(homeWxml.includes('data-stage="pending"') && homeWxml.includes('data-stage="active"') && homeWxml.includes('data-stage="left"'), '首页缺少驻厂快速流转入口');
assert(!homeWxml.includes('驻厂处理队列') && !homeWxml.includes('合规待办'), '首页仍保留已取消的驻厂队列或合规待办');
assert(taskJs.includes("request({ url: '/risk-alerts' })"), '风险处理页未关联风险数据');
assert(taskJs.includes("request({ url: '/work-tasks?taskStatus=0' })"), '合规处理页未关联待处理工作任务');
assert(taskJs.includes('/pages/employees/compliance/index?id='), '合同和雇主险待办无法直达合并办理');

const routeSources = [
  read('src/routes/auth.routes.js'),
  read('src/routes/employee.routes.js'),
  read('src/routes/operations.routes.js'),
  read('src/routes/ocr.routes.js')
].join('\n');

// 小程序当前使用的接口必须在生产 Express 路由中存在。
const requiredRoutes = [
  ["post", '/auth/login'],
  ["get", '/summary'],
  ["get", '/operations/home'],
  ["get", '/employees'],
  ["get", '/employees/onsite-overview'],
  ["post", '/ocr/idcard'],
  ["post", '/employees/:id/onboard'],
  ["put", '/employees/:id/arrival-result'],
  ["post", '/employees/:id/resign'],
  ["put", '/employees/:id/social-security'],
  ["get", '/advances'],
  ["post", '/advances'],
  ["put", '/advances/:id/approve'],
  ["put", '/advances/:id/pay'],
  ["get", '/payroll/overview'],
  ["put", '/payroll/batches/:id/submit'],
  ["put", '/payroll/batches/:id/review'],
  ["put", '/payroll/batches/:id/publish']
];
for (const [method, route] of requiredRoutes) {
  assert(routeSources.includes(`router.${method}('${route}'`), `生产接口未注册：${method.toUpperCase()} ${route}`);
}

const seed = read('sql/seed.mysql.sql');
function listFilesRecursive(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const fullPath = path.join(directory, item.name);
    return item.isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

const miniScripts = listFilesRecursive(path.join(miniRoot, 'pages'))
  .filter(filePath => filePath.endsWith('.js'))
  .map(filePath => fs.readFileSync(filePath, 'utf8'))
  .join('\n');

// 页面跳转必须精确匹配 app.json 注册路径；微信不会自动补全目录下的 /index。
const registeredPageRoutes = new Set((appJson.pages || []).map(page => `/${page}`));
for (const match of miniScripts.matchAll(/url:\s*[`'"](\/pages\/[^?`'"]+)/g)) {
  const route = match[1];
  assert(registeredPageRoutes.has(route), `小程序跳转路径未注册或缺少 /index：${route}`);
}
const permissionCodes = [...miniScripts.matchAll(/hasPermission\([^,]+,\s*'([^']+)'\)/g)].map(match => match[1]);
for (const code of new Set(permissionCodes)) {
  assert(seed.includes(`'${code}'`), `小程序权限码未在初始化数据中定义：${code}`);
}

const envSource = read('wechat-miniprogram/miniprogram/config/env.js');
assert(/API_BASE_URL:\s*'https:\/\/lczpt\.com\/api'/.test(envSource), '小程序生产 API 地址配置错误');

for (const page of appJson.pages || []) {
  const wxml = fs.readFileSync(path.join(miniRoot, `${page}.wxml`), 'utf8');
  assert(!wxml.includes('.slice('), `WXML 不应直接调用 JavaScript 方法：${page}.wxml`);
}

assert(!read('wechat-miniprogram/project.config.json').includes('pages/employee/login/login'), '项目配置仍包含旧登录路径');
console.log('小程序页面、接口和权限契约检查通过。');
