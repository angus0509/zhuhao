const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PDFDocument } = require('pdf-lib');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const {
  PAYSLIP_RECEIPT_STATEMENT_V2,
  PAYSLIP_RECEIPT_STATEMENT_V2_1,
  createPayslipEvidenceReceiptService,
  renderReceiptPdf
} = require('../src/services/payslip-evidence-receipt.service');
const { hashPayslipEvidenceSnapshot } = require('../src/services/payslip-evidence-snapshot.service');

const signaturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function receiptContext(statementVersion = '2.1') {
  const evidenceSnapshot = {
    schemaVersion: '1.0',
    companyId: 1,
    salaryDetailId: 901,
    salaryMonth: '2026-10',
    employeeId: 88,
    employeeName: '张三',
    customerName: '某制造公司',
    projectName: '装配项目',
    items: [
      { name: '基本工资', value: '4200.00' },
      { name: '夜班补贴', value: '600.00' },
      { name: '实发工资', value: '4800.00' }
    ]
  };
  return {
    companyId: 1,
    companyName: '测试人力资源有限公司',
    payslipId: 901,
    employeeId: 88,
    userId: 501,
    signatureId: 801,
    challengeId: 1201,
    evidenceSnapshot,
    signedName: '张三',
    signedAt: '2026-11-12 09:30:00',
    statementVersion,
    payslipContentSha256: hashPayslipEvidenceSnapshot(evidenceSnapshot),
    signatureSha256: crypto.createHash('sha256').update(signaturePng).digest('hex'),
    evidenceChainHead: '3'.repeat(64),
    signatureStoragePath: 'company-1/payslip-signatures/signature.png'
  };
}

async function main() {
  const state = { mkdir: null, writeFile: null, insertParams: null, unlinks: [] };
  let renderedPayload = null;
  const pdfBytes = Buffer.from('%PDF-1.7\nreceipt-test');
  const connection = {
    async execute(sql, params = {}) {
      if (/FROM salary_evidence_receipt/.test(sql)) return [[]];
      if (/INSERT INTO salary_evidence_receipt/.test(sql)) {
        state.insertParams = params;
        return [{ insertId: 7001, affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const filesystem = {
    async realpath(file) { return file; },
    async readFile(file) {
      assert.equal(file, '/safe/uploads/company-1/payslip-signatures/signature.png');
      return signaturePng;
    },
    async mkdir(dir, options) { state.mkdir = { dir, options }; },
    async writeFile(file, bytes, options) { state.writeFile = { path: file, bytes, ...options }; },
    async unlink(file) { state.unlinks.push(file); }
  };
  const service = createPayslipEvidenceReceiptService({
    fs: filesystem,
    uploadRoot: '/safe/uploads',
    now: () => new Date('2026-11-12T09:31:00+08:00'),
    randomBytes: () => Buffer.from('ABCDEF123456', 'ascii'),
    renderReceiptPdf: async payload => {
      renderedPayload = payload;
      assert.equal(payload.companyName, '测试人力资源有限公司');
      assert.equal(payload.statementText, PAYSLIP_RECEIPT_STATEMENT_V2_1);
      assert.equal(payload.payslip.items.length, 3);
      assert.equal(payload.signedUserId, 501);
      assert.equal(payload.challengeId, 1201);
      assert.equal(payload.evidenceChainHead, '3'.repeat(64));
      assert.equal(payload.disclaimer, '本回执证明工资条送达和签收，不单独证明银行款项已实际到账。');
      assert.equal(Object.hasOwn(payload, 'receiptSha256'), false, 'PDF正文不得包含自身摘要');
      return pdfBytes;
    }
  });

  const created = await service.createReceipt(connection, receiptContext());
  assert.match(created.receiptNo, /^PSR-20261112-[A-Z0-9]{12}$/);
  assert.equal(created.receiptSha256, crypto.createHash('sha256').update(pdfBytes).digest('hex'));
  assert.equal(created.created, true);
  assert.equal(state.mkdir.options.mode, 0o700);
  assert.equal(state.writeFile.mode, 0o600);
  assert.equal(state.writeFile.flag, 'wx');
  assert.match(state.writeFile.path, /company-1\/payslip-receipts\//);
  assert.doesNotMatch(JSON.stringify(state.insertParams), /challengeToken|一次性Base64URL随机凭证/);
  assert.equal(state.insertParams.receiptSha256, created.receiptSha256);
  const payload = JSON.parse(state.insertParams.receiptPayload);
  assert.equal(payload.schemaVersion, '1.0');
  assert.equal(payload.statementVersion, '2.1');
  assert.equal(payload.payslip.items[2].name, '实发工资');
  assert.deepEqual(renderedPayload, payload, '数据库固定载荷必须与PDF渲染载荷完全一致');
  assert.deepEqual(Object.keys(renderedPayload).sort(), [
    'challengeId', 'companyName', 'disclaimer', 'evidenceChainHead', 'generatedAt',
    'payslip', 'payslipContentSha256', 'receiptNo', 'schemaVersion', 'signatureSha256',
    'signedAt', 'signedName', 'signedUserId', 'statementText', 'statementVersion'
  ].sort());

  let historicalPayload = null;
  const historicalService = createPayslipEvidenceReceiptService({
    fs: filesystem,
    uploadRoot: '/safe/uploads',
    now: () => new Date('2026-11-12T09:32:00+08:00'),
    randomBytes: () => Buffer.from('LEGACY123456', 'ascii'),
    renderReceiptPdf: async payloadValue => {
      historicalPayload = payloadValue;
      return Buffer.from('%PDF-1.7\nlegacy-receipt-test');
    }
  });
  await historicalService.createReceipt({
    async execute(sql) {
      if (/FROM salary_evidence_receipt/.test(sql)) return [[]];
      if (/INSERT INTO salary_evidence_receipt/.test(sql)) return [{ insertId: 7002, affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  }, receiptContext('2.0'));
  assert.equal(historicalPayload.statementVersion, '2.0');
  assert.equal(historicalPayload.statementText, PAYSLIP_RECEIPT_STATEMENT_V2,
    '历史 2.0 签名生成回执时必须保留原声明');

  const existingService = createPayslipEvidenceReceiptService({
    fs: {
      async realpath(file) { return file; },
      async readFile() { throw new Error('重复创建不应读取签名文件'); },
      async mkdir() { throw new Error('重复创建不应创建目录'); },
      async writeFile() { throw new Error('重复创建不应写文件'); }
    },
    uploadRoot: '/safe/uploads',
    renderReceiptPdf: async () => { throw new Error('重复创建不应渲染PDF'); }
  });
  const existing = await existingService.createReceipt({
    async execute(sql) {
      assert.match(sql, /salary_evidence_receipt/);
      return [[{
        receiptNo: created.receiptNo,
        storagePath: created.storagePath,
        receiptSha256: created.receiptSha256
      }]];
    }
  }, receiptContext());
  assert.equal(existing.created, false);
  assert.equal(existing.receiptNo, created.receiptNo);

  const escapedWrites = [];
  let escapedMkdirCalls = 0;
  let companyRootChecks = 0;
  const symlinkedCreateService = createPayslipEvidenceReceiptService({
    fs: {
      async realpath(file) {
        if (file === '/safe/uploads/company-1') {
          companyRootChecks += 1;
          return companyRootChecks === 1 ? file : '/outside/company-1';
        }
        return file;
      },
      async readFile() { return signaturePng; },
      async mkdir() { escapedMkdirCalls += 1; },
      async writeFile(file) { escapedWrites.push(file); },
      async unlink() {}
    },
    uploadRoot: '/safe/uploads',
    now: () => new Date('2026-11-12T09:31:00+08:00'),
    randomBytes: () => Buffer.from('ABCDEF123456', 'ascii'),
    renderReceiptPdf: async () => pdfBytes
  });
  await assert.rejects(
    () => symlinkedCreateService.createReceipt({
      async execute(sql) {
        if (/FROM salary_evidence_receipt/.test(sql)) return [[]];
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    }, receiptContext()),
    /符号链接|企业目录|存储路径不安全/
  );
  assert.equal(escapedMkdirCalls, 0, '企业目录在渲染期间被替换时不得先执行越界目录创建');
  assert.equal(escapedWrites.length, 0, '回执目录符号链接越界时不得写入文件');

  const insertError = new Error('模拟回执数据库写入失败');
  const cleanupState = { written: null, unlinked: [] };
  const cleanupService = createPayslipEvidenceReceiptService({
    fs: {
      async realpath(file) { return file; },
      async readFile() { return signaturePng; },
      async mkdir() {},
      async writeFile(file) { cleanupState.written = file; },
      async unlink(file) { cleanupState.unlinked.push(file); }
    },
    uploadRoot: '/safe/uploads',
    now: () => new Date('2026-11-12T09:31:00+08:00'),
    randomBytes: () => Buffer.from('ABCDEF123456', 'ascii'),
    renderReceiptPdf: async () => pdfBytes
  });
  await assert.rejects(
    () => cleanupService.createReceipt({
      async execute(sql) {
        if (/FROM salary_evidence_receipt/.test(sql)) return [[]];
        if (/INSERT INTO salary_evidence_receipt/.test(sql)) throw insertError;
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    }, receiptContext()),
    error => error === insertError
  );
  assert.equal(cleanupState.unlinked.length, 1);
  assert.equal(cleanupState.unlinked[0], cleanupState.written);

  const realPayload = {
    schemaVersion: '1.0',
    receiptNo: 'PSR-20261112-ABCDEF123456',
    generatedAt: '2026-11-12T01:31:00.000Z',
    companyName: '测试人力资源有限公司',
    payslip: receiptContext().evidenceSnapshot,
    signedName: '张三',
    signedAt: '2026-11-12 09:30:00',
    signedUserId: 501,
    challengeId: 1201,
    statementVersion: '2.1',
    statementText: PAYSLIP_RECEIPT_STATEMENT_V2_1,
    payslipContentSha256: receiptContext().payslipContentSha256,
    signatureSha256: receiptContext().signatureSha256,
    evidenceChainHead: '3'.repeat(64),
    disclaimer: '本回执证明工资条送达和签收，不单独证明银行款项已实际到账。'
  };
  const rendered = await renderReceiptPdf(realPayload, signaturePng);
  assert.equal(rendered.subarray(0, 5).toString(), '%PDF-');
  assert.ok(rendered.length > 10000, '真实回执应嵌入中文字体和签名图片');

  const longPayload = {
    ...realPayload,
    payslip: {
      ...realPayload.payslip,
      items: [
        { name: '超长展示说明', value: '完整展示内容'.repeat(1200) },
        ...Array.from({ length: 79 }, (_value, index) => ({
          name: `展示项目${index + 1}`,
          value: `值${index + 1}`
        }))
      ]
    }
  };
  const drawnLabels = [];
  const longPdf = await renderReceiptPdf(longPayload, signaturePng, {
    onLabelDraw(label) { drawnLabels.push(label); }
  });
  const longDocument = await PDFDocument.load(longPdf);
  assert.ok(longDocument.getPageCount() >= 6, '超长字段与80个展示项目必须逐行跨页，不得截断在页面外');
  assert.ok(drawnLabels.includes('超长展示说明（续）'), '超长字段跨页后必须标记续页');
  assert.equal(
    drawnLabels.filter(label => label.endsWith('（续）'))
      .every(label => label === '超长展示说明（续）'),
    true,
    '单行普通项目移到新页时不得误标为续页'
  );

  console.log('payslip-evidence-receipt-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
