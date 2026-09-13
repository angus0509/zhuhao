const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const authPath = path.join(root, 'wechat-miniprogram/miniprogram/utils/auth.js');
const tabBarPath = path.join(root, 'wechat-miniprogram/miniprogram/custom-tab-bar/index.js');
const tabBarUtilPath = path.join(root, 'wechat-miniprogram/miniprogram/utils/tab-bar.js');
const appPath = path.join(root, 'wechat-miniprogram/miniprogram/app.js');

function freshRequire(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}

function createStorageWx() {
  const storage = new Map();
  const navigation = [];
  return {
    storage,
    navigation,
    api: {
      getStorageSync(key) {
        return storage.get(key);
      },
      setStorageSync(key, value) {
        storage.set(key, value);
      },
      removeStorageSync(key) {
        storage.delete(key);
      },
      reLaunch(options) {
        navigation.push({ method: 'reLaunch', ...options });
      },
      switchTab(options) {
        navigation.push({ method: 'switchTab', ...options });
        if (typeof options.success === 'function') options.success();
      }
    }
  };
}

function instantiateTabBar(component, route) {
  const instance = {
    data: JSON.parse(JSON.stringify(component.data)),
    setData(patch) {
      Object.assign(this.data, patch);
      if (
        component.observers
        && component.observers['selected, accountType']
        && ('selected' in patch || 'accountType' in patch)
      ) {
        component.observers['selected, accountType'].call(
          this,
          this.data.selected,
          this.data.accountType
        );
      }
    }
  };
  global.getCurrentPages = () => [{ route }];
  for (const [name, method] of Object.entries(component.methods)) {
    instance[name] = method.bind(instance);
  }
  component.lifetimes.attached.call(instance);
  return instance;
}

const wxState = createStorageWx();
global.wx = wxState.api;
const appState = {
  globalData: { session: { token: 'stale', user: { accountType: 'MANAGER' } } },
  setSession(session) {
    this.globalData.session = session;
  }
};
global.getApp = () => appState;

const auth = freshRequire(authPath);
assert.equal(
  auth.isEmployeeSession({ token: 'employee-token', user: { accountType: 'EMPLOYEE', employeeId: 18 } }),
  true,
  '有效员工账号应识别为员工会话'
);
assert.equal(
  auth.isEmployeeSession({ token: 'manager-token', user: { accountType: 'MANAGER', employeeId: 18 } }),
  false,
  '管理账号即使关联员工档案也不能识别为员工会话'
);
assert.equal(
  auth.isEmployeeSession({ token: 'employee-token', user: { accountType: 'EMPLOYEE' } }),
  false,
  '缺少员工档案标识的账号不能进入员工端'
);

let tabBarComponent = null;
global.Component = config => {
  tabBarComponent = config;
};

auth.saveSession({ token: 'employee-token', user: { accountType: 'EMPLOYEE', employeeId: 18 } });
freshRequire(tabBarPath);
const employeeTabBar = instantiateTabBar(tabBarComponent, 'pages/payroll/index');
assert.deepEqual(
  employeeTabBar.data.list.map(item => [item.pagePath, item.text]),
  [
    ['/pages/home/index', '首页'],
    ['/pages/payroll/index', '工资条'],
    ['/pages/profile/index', '我的']
  ],
  '员工端应只显示三个真实可用入口'
);
assert.equal(employeeTabBar.data.selected, 1, '员工工资条页应选中员工菜单第二项');
employeeTabBar.setData({ selected: 2 });
assert.equal(
  employeeTabBar.data.selected,
  1,
  '旧页面按静态菜单序号同步时，员工菜单仍应按当前路由恢复正确选中项'
);

auth.saveSession({ token: 'manager-token', user: { accountType: 'MANAGER' } });
const managerTabBar = instantiateTabBar(tabBarComponent, 'pages/payroll/index');
assert.deepEqual(
  managerTabBar.data.list.map(item => item.text),
  ['工作台', '驻厂', '预支', '工资条', '我的'],
  '管理端菜单必须保持现有五项不变'
);
assert.equal(managerTabBar.data.selected, 3, '管理端工资页应继续选中第四项');

// 复现真实设备问题：自定义菜单实例仍是管理端列表，但本地会话已切成员工。
// 工资条页的静态索引恰好为 1 时，旧同步逻辑会提前返回，页面仍显示“驻厂”菜单。
managerTabBar.setData({ selected: 1, switching: false });
auth.saveSession({ token: 'employee-token', user: { accountType: 'EMPLOYEE', employeeId: 18 } });
const { syncTabBar } = freshRequire(tabBarUtilPath);
syncTabBar({ getTabBar: () => managerTabBar }, 1);
assert.equal(managerTabBar.data.accountType, 'EMPLOYEE', '工资条页显示时必须把残留管理菜单切成员工菜单');
assert.deepEqual(
  managerTabBar.data.list.map(item => item.text),
  ['首页', '工资条', '我的'],
  '员工工资条页不能继续显示工作台、驻厂和预支菜单'
);
assert.equal(managerTabBar.data.selected, 1, '员工工资条菜单应稳定选中工资条');

auth.clearSessionAndRedirectToLogin();
assert.equal(auth.getSession(), null, '会话失效后应清除本地登录信息');
assert.equal(global.getApp().globalData.session, null, '会话失效后应清除应用内存会话');
assert.deepEqual(
  wxState.navigation.at(-1),
  { method: 'reLaunch', url: '/pages/login/index' },
  '会话失效后应返回登录页'
);

let appConfig = null;
global.App = config => {
  appConfig = config;
};
auth.saveSession({ token: 'employee-token', user: { accountType: 'EMPLOYEE', employeeId: 18 } });
freshRequire(appPath);
appConfig.onLaunch.call(appConfig, { path: 'pages/login/index' });
assert.deepEqual(
  wxState.navigation.at(-1),
  { method: 'switchTab', url: '/pages/home/index' },
  '已登录账号从登录页启动时应进入共享首页根路径'
);

console.log('miniprogram-employee-shell-tests-ok');
