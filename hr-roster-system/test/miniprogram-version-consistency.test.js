const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const release = JSON.parse(read('wechat-miniprogram/release.json'));
const app = read('wechat-miniprogram/miniprogram/app.js');
const profileJs = read('wechat-miniprogram/miniprogram/pages/profile/index.js');
const profileWxml = read('wechat-miniprogram/miniprogram/pages/profile/index.wxml');

assert.ok(app.includes(`version: '${release.version}'`), 'App 兜底版本与发布候选版本不一致');
assert.ok(profileJs.includes(`versionText: '${release.version}'`), '个人中心兜底版本与发布候选版本不一致');
assert.match(app, /onLaunch\(\)[\s\S]*this\.checkForUpdate\(\)/, '小程序启动时未检查新版本');
assert.match(app, /onUpdateReady[\s\S]*applyUpdate\(\)/, '新版本就绪后未强制统一更新');
assert.match(profileWxml, /\{\{versionText\}\} · \{\{environmentText\}\}/, '个人中心未展示实际版本环境');
assert.match(profileWxml, /bindtap="checkUpdate"/, '个人中心缺少手动检查新版本入口');
assert.match(profileJs, /checkForUpdate\(\{ manual: true \}\)/, '手动检查按钮未调用统一更新管理器');
assert.match(app, /updateListenersBound/, '重复手动检查可能重复注册更新监听器');
assert.match(app, /onCheckForUpdate[\s\S]*当前已是最新版本/, '手动检查无更新时没有明确反馈');
assert.match(app, /lastUpdateCheck/, '重复点击检查版本时缺少最近一次检查结果');
assert.match(app, /启动时已自动检查，请重新打开小程序重试/, '重复点击检查版本时缺少准确反馈');
assert.doesNotMatch(app, /platform\s*===?\s*['"](?:ios|android)/, '版本逻辑不应按苹果或安卓分叉');

console.log('miniprogram-version-consistency-tests-ok');
