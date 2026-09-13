const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

async function main() {
  const { createPayrollSignaturePreviewService } = require('../src/services/payroll-signature-preview.service');
  const queries = [];
  const auditWrites = [];
  const previewService = createPayrollSignaturePreviewService({
    db: {
      async first(sql, params) {
        queries.push({ sql, params });
        return {
          payslipId: 901,
          employeeId: 88,
          signedName: '张三',
          signedAt: '2026-08-12 10:00:00',
          storagePath: 'company-1/payslip-signatures/signature.png',
          mimeType: 'image/png',
          originalName: '工资条手写签名.png'
        };
      },
      async query(sql, params) {
        auditWrites.push({ sql, params });
        return { affectedRows: 1 };
      }
    },
    fs: { async access() {} },
    uploadRoot: '/safe/uploads'
  });
  const result = await previewService.resolveManagerSignature(1, 901, {
    id: 9,
    companyId: 1,
    dataScope: 5,
    permissions: ['payroll:view']
  });
  assert.equal(result.absolutePath, '/safe/uploads/company-1/payslip-signatures/signature.png');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.signedName, '张三');
  assert.match(queries[0].sql, /salary_signature/);
  assert.match(queries[0].sql, /hr_attachment/);
  assert.match(queries[0].sql, /sys_user_project/, '签名预览必须执行项目数据隔离');
  assert.equal(queries[0].params.companyId, 1);
  assert.equal(queries[0].params.payslipId, 901);
  assert.equal(auditWrites.length, 1, '查看员工签名必须写入审计日志');
  assert.match(auditWrites[0].sql, /hr_operation_log/);
  assert.equal(auditWrites[0].params.operatorId, 9);
  assert.equal(auditWrites[0].params.payslipId, 901);

  const traversalService = createPayrollSignaturePreviewService({
    db: { async first() { return { storagePath: '../private.key', mimeType: 'image/png' }; } },
    fs: { async access() {} },
    uploadRoot: '/safe/uploads'
  });
  await assert.rejects(
    () => traversalService.resolveManagerSignature(1, 901, { id: 9, companyId: 1, dataScope: 1 }),
    /存储路径不安全/
  );

  const routes = fs.readFileSync('src/routes/operations.routes.js', 'utf8');
  assert.match(
    routes,
    /get\('\/payroll\/payslips\/:id\/signature'[\s\S]*requirePermission\('payroll:view'\)/,
    '签名预览接口必须校验工资查看权限'
  );

  console.log('payroll-signature-preview-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
