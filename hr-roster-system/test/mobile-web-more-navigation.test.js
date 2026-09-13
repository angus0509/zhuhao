const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const { buildNavigationModel, buildMobileNavigationItems } = require('../public/js/core/navigation-groups');

const groups = buildNavigationModel({
  activeView: 'office',
  permissions: [],
  isCompanyAdmin: true
});
const mobileItems = buildMobileNavigationItems(groups);

assert.deepEqual(
  mobileItems.map(item => item.view),
  groups.flatMap(group => group.items.map(item => item.view)),
  '手机更多菜单必须覆盖当前账号全部授权页面'
);
assert.equal(new Set(mobileItems.map(item => item.view)).size, mobileItems.length, '手机更多菜单不得出现重复页面');
assert.match(index, /data-mobile-nav-more/, '手机底部导航缺少更多入口');
assert.match(index, /id="mobileNavigationDialog"/, '手机端缺少完整导航抽屉');
assert.match(app, /buildMobileNavigationItems\(getVisibleNavigationModel/, '手机更多菜单未复用桌面权限模型');
assert.match(app, /renderMobileNavigation/, '手机更多菜单缺少渲染逻辑');

console.log('mobile-web-more-navigation-tests-ok');
