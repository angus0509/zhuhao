const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../scripts/verify-miniprogram-release.sh'), 'utf8');

assert.match(source, /release\.json/, '上传前脚本必须读取统一版本文件');
assert.match(source, /HEALTH_STATUS/, '上传前脚本必须按健康接口 HTTP 状态判断');
assert.match(source, /HEALTH_STATUS[^\n]*200/, '上传前脚本必须确认健康接口返回 HTTP 200');
assert.doesNotMatch(source, /database[^\n]*connected/, '上传前脚本不得依赖公网暴露数据库状态');
assert.match(source, /view=activeRoster/, '上传前脚本必须确认后端和网页已经先上线');
assert.match(source, /禁止先上传小程序/, 'Web/API未上线时必须阻止小程序上传');
assert.doesNotMatch(source, /^\s*"?\$DEVTOOLS_CLI"?\s+upload/m, '只读检查脚本不得实际执行上传');
assert.doesNotMatch(source, /printf\s+'%q\s+'/, '上传提示不得把中文说明转成难以辨认的转义字节');
assert.match(source, /printf\s+'"%s" upload --project "%s" --version "%s" --desc "%s" --lang zh\\n'/, '上传提示应输出可直接复制的中文命令');

console.log('miniprogram-release-script-tests-ok');
