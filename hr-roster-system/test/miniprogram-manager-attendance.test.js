const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'wechat-miniprogram/miniprogram');
const pagePath = path.join(miniRoot, 'pages/attendance-management/index.js');
const appConfig = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));
const homeJs = fs.readFileSync(path.join(miniRoot, 'pages/home/index.js'), 'utf8');
const homeWxml = fs.readFileSync(path.join(miniRoot, 'pages/home/index.wxml'), 'utf8');

assert.ok(appConfig.pages.includes('pages/attendance-management/index'), '小程序未注册管理端考勤查看页');
assert.match(homeJs, /canViewAttendance:\s*hasPermission\(session\.user, 'attendance:view'\)/,
  '驻厂首页未按考勤查看权限控制入口');
assert.match(homeJs, /goAttendanceManagement[\s\S]*pages\/attendance-management\/index/,
  '驻厂首页考勤入口未跳转到管理考勤页');
assert.match(homeWxml, /wx:if="\{\{canViewAttendance\}\}"[\s\S]*bindtap="goAttendanceManagement"/,
  '驻厂首页未展示受权限控制的考勤查看入口');

const requests = [];
const switches = [];
let definition = null;
const session = {
  token: 'manager-token',
  user: { id: 8, companyId: 1, accountType: 'MANAGER', permissions: ['attendance:view', 'attendance:review'] }
};
vm.runInNewContext(fs.readFileSync(pagePath, 'utf8'), {
  console,
  Date,
  Promise,
  Page(value) { definition = value; },
  wx: {
    setNavigationBarTitle() {},
    switchTab(options) { switches.push(options.url); },
    stopPullDownRefresh() {},
    showToast() {}
  },
  require(requestPath) {
    if (requestPath.endsWith('/utils/request')) return options => {
      requests.push(options.url);
      if (options.url.startsWith('/attendance/corrections')) return Promise.resolve({ list: [] });
      return Promise.resolve({ list: [] });
    };
    if (requestPath.endsWith('/utils/auth')) return {
      requireManagerSession: () => session,
      hasPermission: (user, code) => user.permissions.includes(code)
    };
    throw new Error(`未提供测试依赖：${requestPath}`);
  }
}, { filename: pagePath });

assert.ok(definition, '管理端考勤页未注册 Page');
const page = {
  ...definition,
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(patch) { Object.assign(this.data, patch); }
};

async function main() {
  await page.onShow.call(page);
  assert.ok(requests.some(url => url.startsWith('/attendance/daily?date=')), '未读取当日考勤');
  assert.ok(requests.some(url => url.startsWith('/attendance/monthly?month=')), '未读取月度汇总');
  assert.ok(requests.some(url => url === '/attendance/corrections?status=PENDING'), '审核账号未读取待审核异常');
  assert.equal(page.data.canReview, true);

  const employeeSession = { user: { accountType: 'EMPLOYEE', employeeId: 99, permissions: [] } };
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  assert.match(pageSource, /requireManagerSession\(\)/, '管理考勤页未阻止员工账号进入');
  assert.match(pageSource, /hasPermission\(session\.user, 'attendance:view'\)/, '管理考勤页未校验查看权限');
  assert.notEqual(employeeSession.user.accountType, 'MANAGER');

  const wxml = fs.readFileSync(path.join(miniRoot, 'pages/attendance-management/index.wxml'), 'utf8');
  assert.match(wxml, /今日考勤/);
  assert.match(wxml, /月度汇总/);
  assert.match(wxml, /围栏异常/);
  console.log('miniprogram-manager-attendance-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
