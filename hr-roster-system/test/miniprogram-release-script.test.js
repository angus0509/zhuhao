const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../scripts/verify-miniprogram-release.sh'), 'utf8');

assert.match(source, /release\.json/, '上传前脚本必须读取统一版本文件');
assert.match(source, /database[^\n]*connected/, '上传前脚本必须确认生产数据库连接');
assert.match(source, /view=activeRoster/, '上传前脚本必须确认后端和网页已经先上线');
assert.match(source, /禁止先上传小程序/, 'Web/API未上线时必须阻止小程序上传');
assert.doesNotMatch(source, /^\s*"?\$DEVTOOLS_CLI"?\s+upload/m, '只读检查脚本不得实际执行上传');

console.log('miniprogram-release-script-tests-ok');
