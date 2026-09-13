const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const polish = fs.readFileSync('public/interaction-polish.js', 'utf8');

assert.doesNotMatch(html + app + polish, />工资发放</, '网页端入口仍显示“工资发放”');
assert.match(html, /工资条发放管理/);
assert.match(html, /发放记录/);
// 这些记录字段由 app.js 根据批次数据动态渲染，需连同脚本源码检查。
const payrollUiSource = `${html}\n${app}`;
assert.match(payrollUiSource, /发放成功/);
assert.match(payrollUiSource, /发放失败/);
assert.match(payrollUiSource, /已签收/);
assert.match(payrollUiSource, /待签收/);

for (const field of ['deliverySuccessCount', 'deliveryFailedCount', 'signedCount', 'unsignedCount']) {
  assert.match(app, new RegExp(`item\\.${field}`), `批次列表缺少统计字段：${field}`);
}
assert.match(app, /item\.canWithdraw[\s\S]*data-withdraw-payroll=/,
  '工资条撤回入口必须受后端撤回资格控制');
assert.match(app, /item\.withdrawBlockedReason/,
  '不可撤回时必须显示具体原因');
assert.match(app, /\/api\/payroll\/batches\/\$\{batchId\}\/withdraw/);
assert.match(app, /撤回原因/);
assert.match(app, /confirmed:\s*true/);

assert.match(html, /送达状态/);
assert.match(html, /短信通知/);
assert.match(html, /查看 \/ 签收/);
assert.match(html, /签名凭证/);
assert.match(app, /item\.signedName/);
assert.match(app, /data-view-payroll-signature=/, '详情缺少查看员工签名按钮');
assert.match(app, /\/api\/payroll\/payslips\/\$\{payslipId\}\/signature/);

console.log('web-payroll-delivery-withdraw-tests-ok');
