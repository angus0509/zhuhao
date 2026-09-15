const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'wechat-miniprogram/miniprogram');
const employeeSession = {
  token: 'employee-token',
  user: {
    id: 91,
    companyId: 7,
    employeeId: 1001,
    accountType: 'EMPLOYEE',
    roles: [],
    permissions: [],
    dataScope: 4
  }
};

function freshRequire(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function instantiatePage(config) {
  const instance = {
    data: clone(config.data || {}),
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  for (const [name, method] of Object.entries(config)) {
    if (typeof method === 'function') instance[name] = method.bind(instance);
  }
  return instance;
}

function instantiateComponent(config) {
  const instance = {
    data: clone(config.data || {}),
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  for (const [name, method] of Object.entries(config.methods || {})) {
    instance[name] = method.bind(instance);
  }
  return instance;
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const requestUrls = [];
  const navigation = [];
  const navigationTitles = [];
  global.wx = {
    getStorageSync(key) {
      if (key === 'youyi_hr_token') return employeeSession.token;
      if (key === 'youyi_hr_user') return employeeSession.user;
      return '';
    },
    removeStorageSync() {},
    request(options) {
      requestUrls.push(options.url);
      options.success({
        statusCode: 200,
        data: {
          code: 0,
          data: {
            employeeId: 1001,
            name: '张三',
            idCardMasked: '320***********1234',
            phoneMasked: '138****0000',
            customerName: '甲客户',
            projectName: '装配项目',
            positionName: '普工',
            employeeStatusName: '在职',
            wechatBound: true,
            latestPayslip: {
              id: 31,
              salaryMonth: '2026-08',
              receiptStatus: 1,
              receiptStatusName: '待签收',
              netAmount: '9999.00'
            }
          }
        }
      });
    },
    switchTab(options) {
      navigation.push(options.url);
    },
    navigateTo(options) {
      navigation.push(options.url);
    },
    setNavigationBarTitle(options) {
      navigationTitles.push(options.title);
    },
    showModal() {},
    stopPullDownRefresh() {}
  };
  global.getApp = () => ({
    globalData: { runtimeVersion: { version: '1.1.10', envVersion: 'develop' } },
    captureRuntimeVersion() {},
    logout() {}
  });

  const employeeTitles = {
    home: '员工首页',
    payroll: '我的工资条',
    advances: '消息',
    profile: '我的'
  };
  for (const pageName of ['home', 'payroll', 'advances', 'profile']) {
    let pageConfig = null;
    global.Page = config => { pageConfig = config; };
    freshRequire(path.join(miniRoot, `pages/${pageName}/index.js`));
    const page = instantiatePage(pageConfig);
    const requestCountBefore = requestUrls.length;
    page.onShow();
    await flushPromises();
    assert.equal(page.data.employeeMode, true, `${pageName} 根页应进入员工模式`);
    assert.equal(
      requestUrls.length,
      requestCountBefore,
      `${pageName} 根页判定员工会话后不得请求管理端接口`
    );
    assert.equal(navigationTitles.at(-1), employeeTitles[pageName], `${pageName} 应显示员工端标题`);
  }

  let homeComponent = null;
  global.Component = config => { homeComponent = config; };
  freshRequire(path.join(miniRoot, 'components/employee-home-panel/index.js'));
  const home = instantiateComponent(homeComponent);
  homeComponent.lifetimes.attached.call(home);
  await flushPromises();
  assert.equal(requestUrls.filter(url => url.endsWith('/me/profile')).length, 1, '员工首页应只请求本人资料');
  assert.equal(home.data.profile.name, '张三');
  assert.equal(home.data.profile.latestPayslip.salaryMonth, '2026-08');
  home.goPayslip();
  assert.equal(navigation.at(-1), '/pages/payroll/index', '查看工资条应进入共享工资根页');
  home.goAttendance();
  assert.equal(navigation.at(-1), '/pages/attendance/index', '员工首页考勤入口应进入考勤打卡页');

  const homeWxml = fs.readFileSync(
    path.join(miniRoot, 'components/employee-home-panel/index.wxml'),
    'utf8'
  );
  assert.match(homeWxml, /查看工资条/);
  assert.match(homeWxml, /考勤打卡/, '员工首页必须展示考勤打卡文字');
  assert.match(homeWxml, /bindtap="goAttendance"/, '员工首页考勤入口必须绑定跳转事件');
  assert.doesNotMatch(homeWxml, /netAmount|grossAmount|payableAmount/, '员工首页不得渲染工资金额');

  const profileWxml = fs.readFileSync(
    path.join(miniRoot, 'components/employee-profile-panel/index.wxml'),
    'utf8'
  );
  assert.match(profileWxml, /idCardMasked/);
  assert.match(profileWxml, /phoneMasked/);
  assert.doesNotMatch(profileWxml, /permissionCount|dataScopeText/, '员工我的页不得展示管理权限信息');

  for (const [pageName, componentName] of [
    ['home', 'employee-home-panel'],
    ['payroll', 'employee-payslip-list'],
    ['advances', 'employee-empty-panel'],
    ['profile', 'employee-profile-panel']
  ]) {
    const pageJson = JSON.parse(fs.readFileSync(path.join(miniRoot, `pages/${pageName}/index.json`), 'utf8'));
    assert.ok(
      Object.values(pageJson.usingComponents || {}).some(value => value.includes(componentName)),
      `${pageName} 根页应注册 ${componentName}`
    );
    const pageWxml = fs.readFileSync(path.join(miniRoot, `pages/${pageName}/index.wxml`), 'utf8');
    assert.match(pageWxml, /employeeMode/, `${pageName} 根页应根据账号类型分流渲染`);
  }

  console.log('miniprogram-employee-home-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
