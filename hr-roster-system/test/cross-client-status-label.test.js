const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dictionaries = read('src/utils/dictionaries.js');
const miniChannels = read('wechat-miniprogram/miniprogram/pages/channels/index.wxml');
const webApp = read('public/app.js');

assert.match(dictionaries, /employeeStatus:\s*\{[^}]*1:\s*'待到岗'/s, '共享员工状态字典必须将状态1标记为待到岗');
assert.doesNotMatch(miniChannels, /employeeStatus === 1 \? '待入职'/, '小程序招聘渠道员工列表不能显示过时的待入职文案');
assert.match(webApp, /statusMap\s*=\s*\{[^}]*1:\s*\{ text: '待到岗'/s, '网页员工状态必须显示待到岗');

console.log('cross-client-status-label-tests-ok');
