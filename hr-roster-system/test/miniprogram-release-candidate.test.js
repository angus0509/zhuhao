const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const release = JSON.parse(read('wechat-miniprogram/release.json'));
const project = JSON.parse(read('wechat-miniprogram/project.config.json'));
const app = JSON.parse(read('wechat-miniprogram/miniprogram/app.json'));
const env = read('wechat-miniprogram/miniprogram/config/env.js');
const profile = read('wechat-miniprogram/miniprogram/pages/profile/index.wxml');

assert.match(release.version, /^\d+\.\d+\.\d+$/, '小程序候选版本号格式不正确');
assert.equal(release.appid, project.appid, '候选版本 AppID 与项目配置不一致');
assert.equal(release.apiBaseUrl, 'https://lczpt.com/api', '候选版本 API 地址不正确');
assert.match(env, /API_BASE_URL:\s*'https:\/\/lczpt\.com\/api'/, '小程序生产 API 地址不正确');
assert.equal(app.tabBar.list[1].text, '驻厂', '原生兜底菜单必须与自定义菜单名称一致');
const appSource = read('wechat-miniprogram/miniprogram/app.js');
const profileScript = read('wechat-miniprogram/miniprogram/pages/profile/index.js');
assert.ok(profileScript.includes(`versionText: '${release.version}'`), '“我的”页面版本号与候选版本不一致');
assert.ok(profile.includes('{{versionText}} · {{environmentText}}'), '“我的”页面未显示实际运行版本和环境');
assert.ok(appSource.includes('wx.getUpdateManager'), '小程序未启用微信版本更新管理器');
assert.ok(appSource.includes('updateManager.applyUpdate()'), '检测到新版本后未执行重启更新');
assert.ok(appSource.includes('wx.getAccountInfoSync'), '小程序未读取微信实际运行版本');
assert.ok(release.description.length >= 10 && release.description.length <= 100, '上传版本说明长度应为10至100字');

console.log('miniprogram-release-candidate-tests-ok');
