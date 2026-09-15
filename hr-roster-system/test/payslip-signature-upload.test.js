const assert = require('node:assert/strict');
const path = require('node:path');
const { createPayslipSignatureService } = require('../src/services/payslip-signature.service');
const payslipRouter = require('../src/routes/payslip.routes');
const uploadMiddleware = require('../src/middlewares/upload.middleware');

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function createHarness(options = {}) {
  const state = { writes: [], unlinks: [], queries: [] };
  const filesystem = {
    async mkdir(target, config) { state.mkdir = { target, config }; },
    async writeFile(target, buffer, config) {
      state.writes.push({ target, buffer: Buffer.from(buffer), config });
    },
    async unlink(target) { state.unlinks.push(target); }
  };
  const connection = {
    async execute(sql, params = {}) {
      state.queries.push({ sql, params });
      if (/FROM salary_detail d/.test(sql)) {
        const supportsDeparted = /employee_status\s+IN\s*\(2,3\)/i.test(sql);
        return [options.foreign || (options.departed && !supportsDeparted) ? [] : [{
          id: 901,
          employeeName: '张三',
          receiptStatus: 1,
          openDisputeId: null,
          activeSignatureId: null
        }]];
      }
      if (/INSERT INTO hr_attachment/.test(sql)) return [{ insertId: 701, affectedRows: 1 }];
      if (/INSERT INTO salary_signature/.test(sql)) {
        if (options.failSignatureInsert) throw new Error('insert failed');
        return [{ insertId: 801, affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const database = { async transaction(handler) { return handler(connection); } };
  const service = createPayslipSignatureService({
    db: database,
    fs: filesystem,
    uploadRoot: '/private/test-uploads',
    randomUUID: () => 'signature-file-id',
    now: () => new Date('2026-08-14T08:00:00.000Z')
  });
  return { service, state };
}

async function main() {
  assert.equal(typeof uploadMiddleware.singlePayslipSignature, 'function');
  const signatureRoute = payslipRouter.stack.find(layer =>
    layer.route?.path === '/me/payslips/:id/signature' && layer.route.methods.post
  );
  assert.ok(signatureRoute, '员工工资条必须注册签名上传接口');
  assert.equal(signatureRoute.route.methods.post, true);
  assert.equal(
    signatureRoute.route.stack.some(layer => layer.name === 'singlePayslipSignature'),
    true,
    '签名上传接口必须使用独立1MB PNG中间件'
  );

  const file = {
    originalname: 'signature.png',
    mimetype: 'image/png',
    size: validPng.length,
    buffer: validPng
  };
  const user = { id: 501, accountType: 'EMPLOYEE', employeeId: 88 };

  const harness = createHarness();
  const result = await harness.service.uploadMySignature(1, 901, file, {
    signedName: '张三',
    statementVersion: '1.0'
  }, user, { ipAddress: '127.0.0.1', deviceInfo: 'test-device' });
  assert.equal(result.signatureId, 801);
  assert.equal(result.signedName, '张三');
  assert.equal(harness.state.writes.length, 1);
  assert.equal(harness.state.writes[0].config.mode, 0o600);
  assert.equal(harness.state.writes[0].config.flag, 'wx');
  assert.equal(
    harness.state.writes[0].target,
    path.join('/private/test-uploads', 'company-1', 'payslip-signatures', 'signature-file-id.png')
  );
  const payslipQuery = harness.state.queries.find(item => /FROM salary_detail d/.test(item.sql));
  assert.deepEqual(payslipQuery.params, { companyId: 1, payslipId: 901, employeeId: 88 });
  const attachmentInsert = harness.state.queries.find(item => /INSERT INTO hr_attachment/.test(item.sql));
  assert.equal(attachmentInsert.params.bizType, 'payslip_signature');
  assert.equal(attachmentInsert.params.employeeId, 88);
  assert.equal(Object.hasOwn(result, 'storagePath'), false);

  const departedResult = await createHarness({ departed: true }).service.uploadMySignature(
    1,
    901,
    file,
    { signedName: '张三', statementVersion: '1.0' },
    user,
    {}
  );
  assert.equal(departedResult.signatureId, 801,
    '已离职员工应能为本人已发布工资条上传签名');

  await assert.rejects(
    () => createHarness({ foreign: true }).service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '1.0'
    }, user, {}),
    /工资条不存在|本人/
  );
  await assert.rejects(
    () => harness.service.uploadMySignature(1, 901, { ...file, buffer: Buffer.from('fake') }, {
      signedName: '张三', statementVersion: '1.0'
    }, user, {}),
    /PNG|签名/
  );

  const rollbackHarness = createHarness({ failSignatureInsert: true });
  await assert.rejects(
    () => rollbackHarness.service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '1.0'
    }, user, {}),
    /insert failed/
  );
  assert.equal(rollbackHarness.state.unlinks.length, 1, '数据库失败后必须删除签名文件');

  console.log('payslip-signature-upload-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
