const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';
process.env.PAYSLIP_EVIDENCE_HMAC_SECRET = process.env.PAYSLIP_EVIDENCE_HMAC_SECRET
  || 'test-evidence-secret-at-least-32-characters';

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
const evidenceSecret = process.env.PAYSLIP_EVIDENCE_HMAC_SECRET;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
      return result;
    }, Object.create(null));
  }
  return value;
}

function receiptPayloadHmac(payload) {
  return crypto.createHmac('sha256', evidenceSecret)
    .update(`payslip-receipt-payload:v1|${JSON.stringify(canonicalize(payload))}`)
    .digest('hex');
}

function acceptEvidenceRow(context, overrides = {}) {
  const row = {
    id: 1,
    companyId: context.companyId,
    payslipId: context.payslipId,
    employeeId: context.employeeId,
    userId: context.userId,
    actionType: 'ACCEPT',
    resultStatus: 2,
    createdAt: '2026-11-12T01:30:00.000Z',
    payslipContentSha256: context.payslipContentSha256,
    signatureSha256: context.signatureSha256,
    challengeId: context.challengeId,
    statementVersion: context.statementVersion,
    previousEvidenceHash: null,
    evidenceKeyVersion: 'v2',
    ipAddress: null,
    userAgent: null,
    ...overrides
  };
  const serialized = JSON.stringify([
    row.companyId, row.payslipId, row.employeeId, row.userId,
    row.actionType, row.resultStatus, row.createdAt,
    row.payslipContentSha256, row.signatureSha256, row.challengeId,
    row.statementVersion, row.previousEvidenceHash || '', row.evidenceKeyVersion,
    row.ipAddress || '', row.userAgent || ''
  ]);
  row.evidenceHash = crypto.createHmac('sha256', evidenceSecret)
    .update(`payslip-evidence-log:v2|${serialized}`)
    .digest('hex');
  return row;
}

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
  const context = {
    companyId: 1,
    companyName: '测试人力资源有限公司',
    payslipId: 901,
    employeeId: 88,
    userId: 501,
    signatureId: 801,
    challengeId: 1201,
    evidenceSnapshot,
    signedName: '张三',
    signedAt: '2026-11-12 09:30:00.999',
    statementVersion,
    payslipContentSha256: hashPayslipEvidenceSnapshot(evidenceSnapshot),
    signatureSha256: crypto.createHash('sha256').update(signaturePng).digest('hex'),
    evidenceChainHead: null,
    signatureStoragePath: 'company-1/payslip-signatures/signature.png'
  };
  context.evidenceChainHead = acceptEvidenceRow(context).evidenceHash;
  return context;
}

async function main() {
  const state = { insertParams: null, unlinks: [] };
  const renderCalls = [];
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
      renderCalls.push(payload);
      return Buffer.from('%PDF-1.7\nreceipt-test');
    }
  });

  const created = await service.createReceipt(connection, receiptContext());
  assert.match(created.receiptNo, /^PSR-20261112-[A-Z0-9]{12}$/);
  assert.equal(state.mkdir, undefined, '动态回执不得创建 PDF 目录');
  assert.equal(state.writeFile, undefined, '动态回执不得写入 PDF 文件');
  assert.deepEqual(renderCalls, [], '动态回执创建阶段不得渲染 PDF');
  assert.equal(created.storageMode, 'DYNAMIC');
  assert.equal(created.storagePath, null);
  assert.equal(created.receiptSha256, null);
  assert.equal(created.created, true);
  assert.doesNotMatch(JSON.stringify(state.insertParams), /challengeToken|一次性Base64URL随机凭证/);
  assert.equal(state.insertParams.storageMode, 'DYNAMIC');
  assert.equal(state.insertParams.storagePath, null);
  assert.equal(state.insertParams.receiptSha256, null);
  assert.match(state.insertParams.receiptPayloadHmac, /^[a-f0-9]{64}$/,
    '动态回执必须保存完整载荷HMAC');
  assert.equal(state.insertParams.receiptPayloadKeyVersion, 'v1');
  const payload = JSON.parse(state.insertParams.receiptPayload);
  assert.equal(payload.schemaVersion, '1.0');
  assert.equal(payload.statementVersion, '2.1');
  assert.equal(payload.payslip.items[2].name, '实发工资');
  assert.equal(payload.companyName, '测试人力资源有限公司');
  assert.equal(payload.statementText, PAYSLIP_RECEIPT_STATEMENT_V2_1);
  assert.equal(payload.payslip.items.length, 3);
  assert.equal(payload.signedUserId, 501);
  assert.equal(payload.challengeId, 1201);
  assert.equal(payload.evidenceChainHead, receiptContext().evidenceChainHead);
  assert.equal(Object.hasOwn(payload, 'disclaimer'), false,
    '新回执载荷不得再包含未实际到账说明');
  assert.equal(Object.hasOwn(payload, 'receiptSha256'), false, '不可变载荷不得包含动态 PDF 摘要');
  assert.deepEqual(Object.keys(payload).sort(), [
    'challengeId', 'companyName', 'evidenceChainHead', 'generatedAt',
    'payslip', 'payslipContentSha256', 'receiptNo', 'schemaVersion', 'signatureSha256',
    'signedAt', 'signedName', 'signedUserId', 'statementText', 'statementVersion'
  ].sort());

  const dynamicRenderCalls = [];
  const dynamicWrites = [];
  const dynamicRow = {
    receiptNo: created.receiptNo,
    storageMode: 'DYNAMIC',
    receiptPayload: JSON.stringify(payload),
    receiptPayloadHmac: state.insertParams.receiptPayloadHmac,
    receiptPayloadKeyVersion: 'v1',
    payslipContentSha256: receiptContext().payslipContentSha256,
    signatureStoragePath: receiptContext().signatureStoragePath,
    signatureSha256: receiptContext().signatureSha256,
    authoritativeSignatureSha256: receiptContext().signatureSha256,
    attachmentSha256: receiptContext().signatureSha256,
    evidenceChainHead: receiptContext().evidenceChainHead,
    receiptPayslipId: 901,
    receiptEmployeeId: 88,
    receiptChallengeId: 1201,
    receiptStatementVersion: '2.1',
    receiptGeneratedAt: '2026-11-12 09:31:00',
    receiptCreatedBy: 501,
    signedName: '张三',
    signedAt: '2026-11-12 09:30:00',
    signatureChallengeId: 1201,
    signatureStatementVersion: '2.1',
    challengeUserId: 501,
    storagePath: null,
    receiptSha256: null
  };
  const evidenceRows = [acceptEvidenceRow(receiptContext())];
  const dynamicDb = row => ({
    async first(sql) {
      assert.match(sql, /signature\.signature_sha256 authoritativeSignatureSha256/);
      assert.match(sql, /attachment\.file_sha256 attachmentSha256/);
      assert.match(sql, /challenge\.user_id challengeUserId/);
      return row;
    },
    async query(sql, params) {
      assert.match(sql, /FROM salary_receipt_log/);
      assert.deepEqual(params, { companyId: 1, payslipId: 901, employeeId: 88 });
      return evidenceRows;
    }
  });
  const dynamicDownloadService = createPayslipEvidenceReceiptService({
    db: dynamicDb(dynamicRow),
    fs: {
      async realpath(file) { return file; },
      async readFile(file) {
        assert.equal(file, '/safe/uploads/company-1/payslip-signatures/signature.png');
        return signaturePng;
      },
      async writeFile(...args) { dynamicWrites.push(args); }
    },
    uploadRoot: '/safe/uploads',
    renderReceiptPdf: async (renderPayload, signatureBuffer) => {
      dynamicRenderCalls.push({ renderPayload, signatureBuffer });
      return Buffer.from('%PDF-1.7\ndynamic-receipt');
    }
  });
  const dynamicResult = await dynamicDownloadService.resolveEmployeeReceipt(1, 901, {
    id: 501,
    accountType: 'EMPLOYEE',
    employeeId: 88
  });
  assert.equal(dynamicResult.file, null);
  assert.equal(dynamicResult.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.match(dynamicResult.receiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(dynamicRenderCalls.length, 1, '动态下载必须调用注入的 PDF 渲染器一次');
  assert.deepEqual(dynamicRenderCalls[0].renderPayload, payload);
  assert.equal(dynamicRenderCalls[0].signatureBuffer, signaturePng);
  assert.equal(dynamicWrites.length, 0, '动态下载不得写入磁盘');

  async function rejectDynamicRow(row, filesystem = null) {
    const integrityService = createPayslipEvidenceReceiptService({
      db: dynamicDb(row),
      fs: filesystem || {
        async realpath(file) { return file; },
        async readFile() { return signaturePng; }
      },
      uploadRoot: '/safe/uploads',
      renderReceiptPdf: async () => { throw new Error('完整性失败时不得渲染 PDF'); }
    });
    return integrityService.resolveEmployeeReceipt(1, 901, {
      id: 501,
      accountType: 'EMPLOYEE',
      employeeId: 88
    });
  }

  const tamperedPayload = JSON.parse(JSON.stringify(payload));
  tamperedPayload.payslip.items[0].value = '9999.00';
  await assert.rejects(
    () => rejectDynamicRow({ ...dynamicRow, receiptPayload: JSON.stringify(tamperedPayload) }),
    /完整性校验失败/
  );
  await assert.rejects(
    () => rejectDynamicRow(dynamicRow, {
      async realpath(file) { return file; },
      async readFile() { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }
    }),
    /签名文件不存在/
  );
  await assert.rejects(
    () => rejectDynamicRow(dynamicRow, {
      async realpath(file) { return file; },
      async readFile() { return Buffer.from('tampered-signature'); }
    }),
    /签名文件完整性校验失败/
  );
  await assert.rejects(
    () => rejectDynamicRow({ ...dynamicRow, receiptNo: 'PSR-20261112-ZZZZZZZZZZZZ' }),
    /回执编号无效|证据.*无效/
  );

  const synchronizedTampering = {
    ...dynamicRow,
    receiptPayload: JSON.stringify({ ...payload, companyName: '被篡改企业名称' })
  };
  await assert.rejects(
    () => rejectDynamicRow(synchronizedTampering),
    error => error.statusCode === 409
      && error.businessCode === 'PAYSLIP_RECEIPT_INTEGRITY_FAILED',
    '即使同步篡改可见字段，完整载荷HMAC也必须在渲染前拒绝'
  );

  for (const mutation of [
    {
      label: '签名摘要',
      payload: { ...payload, signatureSha256: '4'.repeat(64) },
      row: { signatureSha256: '4'.repeat(64) }
    },
    {
      label: '签收账号',
      payload: { ...payload, signedUserId: 999 },
      row: { receiptCreatedBy: 999 }
    },
    {
      label: '证据链头',
      payload: { ...payload, evidenceChainHead: '5'.repeat(64) },
      row: { evidenceChainHead: '5'.repeat(64) }
    }
  ]) {
    await assert.rejects(
      () => rejectDynamicRow({
        ...dynamicRow,
        ...mutation.row,
        receiptPayload: JSON.stringify(mutation.payload),
        receiptPayloadHmac: receiptPayloadHmac(mutation.payload)
      }),
      error => error.statusCode === 409 && /完整性|证据|签收|签名/.test(error.message),
      `即使重算载荷HMAC并同步篡改${mutation.label}，权威数据绑定仍必须拒绝`
    );
  }

  const payloadMutations = [
    ['signedName', '李四'],
    ['signedUserId', 999],
    ['challengeId', 999],
    ['statementVersion', '2.0'],
    ['statementText', PAYSLIP_RECEIPT_STATEMENT_V2],
    ['signedAt', '2026-11-12 09:30:01'],
    ['generatedAt', '2026-11-12T01:31:01.000Z']
  ];
  for (const [field, value] of payloadMutations) {
    const mutated = { ...payload, [field]: value };
    await assert.rejects(
      () => rejectDynamicRow({ ...dynamicRow, receiptPayload: JSON.stringify(mutated) }),
      error => /完整性|证据|签收|声明|时间/.test(error.message)
        && !/完整性失败时不得渲染/.test(error.message),
      `篡改 ${field} 必须在渲染前被拒绝`
    );
  }
  for (const [field, value] of [
    ['receiptChallengeId', 999],
    ['signatureChallengeId', 999],
    ['receiptStatementVersion', '2.0'],
    ['signatureStatementVersion', '2.0'],
    ['signedName', '李四'],
    ['signedAt', '2026-11-12 09:30:01'],
    ['receiptCreatedBy', 999],
    ['receiptGeneratedAt', '2026-11-12 01:31:01']
  ]) {
    await assert.rejects(
      () => rejectDynamicRow({ ...dynamicRow, [field]: value }),
      error => /证据|签收|声明|时间/.test(error.message)
        && !/完整性失败时不得渲染/.test(error.message),
      `权威字段 ${field} 不一致必须在渲染前被拒绝`
    );
  }
  await assert.rejects(
    () => rejectDynamicRow({ ...dynamicRow, signatureStoragePath: null }),
    error => error.statusCode === 404 && /签名文件不存在/.test(error.message)
  );

  let concurrentActive = 0;
  let concurrentPeak = 0;
  const concurrentReleases = [];
  const concurrentService = createPayslipEvidenceReceiptService({
    db: dynamicDb(dynamicRow),
    fs: {
      async realpath(file) { return file; },
      async readFile() { return signaturePng; }
    },
    uploadRoot: '/safe/uploads',
    dynamicRenderQueueLimit: 1,
    renderReceiptPdf: async () => {
      concurrentActive += 1;
      concurrentPeak = Math.max(concurrentPeak, concurrentActive);
      try {
        return await new Promise((resolve, reject) => {
          concurrentReleases.push({ resolve, reject });
        });
      } finally {
        concurrentActive -= 1;
      }
    }
  });
  const employeeUser = { id: 501, accountType: 'EMPLOYEE', employeeId: 88 };
  const concurrentOne = concurrentService.resolveEmployeeReceipt(1, 901, employeeUser);
  const concurrentTwo = concurrentService.resolveEmployeeReceipt(1, 901, employeeUser);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(concurrentReleases.length, 2, '并发上限为2时只能先启动两个渲染');
  const concurrentThree = concurrentService.resolveEmployeeReceipt(1, 901, employeeUser);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(concurrentReleases.length, 2, '第三个渲染必须进入有限队列');
  await assert.rejects(
    () => concurrentService.resolveEmployeeReceipt(1, 901, employeeUser),
    error => error.statusCode === 503 && error.businessCode === 'PAYSLIP_RECEIPT_BUSY'
  );
  concurrentReleases[0].resolve(Buffer.from('%PDF-1.7\nconcurrent-one'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(concurrentReleases.length, 3, '释放名额后队列中的渲染必须继续');
  concurrentReleases[1].resolve(Buffer.from('%PDF-1.7\nconcurrent-two'));
  concurrentReleases[2].resolve(Buffer.from('%PDF-1.7\nconcurrent-three'));
  await Promise.all([concurrentOne, concurrentTwo, concurrentThree]);
  assert.equal(concurrentPeak, 2, '动态 PDF 渲染峰值不得超过注入上限');

  let recoveryCalls = 0;
  let rejectFirstRender;
  const recoveryService = createPayslipEvidenceReceiptService({
    db: dynamicDb(dynamicRow),
    fs: {
      async realpath(file) { return file; },
      async readFile() { return signaturePng; }
    },
    uploadRoot: '/safe/uploads',
    dynamicRenderConcurrency: 1,
    dynamicRenderQueueLimit: 1,
    renderReceiptPdf: async () => {
      recoveryCalls += 1;
      if (recoveryCalls === 1) {
        return new Promise((_resolve, reject) => { rejectFirstRender = reject; });
      }
      return Buffer.from('%PDF-1.7\nrecovered');
    }
  });
  const failedRender = recoveryService.resolveEmployeeReceipt(1, 901, employeeUser);
  const queuedAfterFailure = recoveryService.resolveEmployeeReceipt(1, 901, employeeUser);
  await new Promise(resolve => setImmediate(resolve));
  rejectFirstRender(new Error('模拟渲染失败'));
  await assert.rejects(() => failedRender, /模拟渲染失败/);
  const recovered = await queuedAfterFailure;
  assert.equal(recovered.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(recoveryCalls, 2, '渲染异常后必须释放名额并继续处理队列');

  let historicalPayload = null;
  const historicalService = createPayslipEvidenceReceiptService({
    fs: filesystem,
    uploadRoot: '/safe/uploads',
    now: () => new Date('2026-11-12T09:32:00+08:00'),
    randomBytes: () => Buffer.from('LEGACY123456', 'ascii'),
    renderReceiptPdf: async () => { throw new Error('动态回执不得渲染 PDF'); }
  });
  await historicalService.createReceipt({
    async execute(sql, params = {}) {
      if (/FROM salary_evidence_receipt/.test(sql)) return [[]];
      if (/INSERT INTO salary_evidence_receipt/.test(sql)) {
        historicalPayload = JSON.parse(params.receiptPayload);
        return [{ insertId: 7002, affectedRows: 1 }];
      }
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
        storageMode: 'DYNAMIC',
        storagePath: created.storagePath,
        receiptSha256: created.receiptSha256
      }]];
    }
  }, receiptContext());
  assert.equal(existing.created, false);
  assert.equal(existing.receiptNo, created.receiptNo);
  assert.equal(existing.storageMode, 'DYNAMIC');
  assert.equal(existing.storagePath, null);
  assert.equal(existing.receiptSha256, null);

  let insertAfterUnsafeSignature = false;
  const symlinkedCreateService = createPayslipEvidenceReceiptService({
    fs: {
      async realpath(file) {
        if (file === '/safe/uploads/company-1/payslip-signatures/signature.png') {
          return '/outside/signature.png';
        }
        return file;
      },
      async readFile() { return signaturePng; },
      async mkdir() { throw new Error('签名路径无效时不得创建目录'); },
      async writeFile() { throw new Error('签名路径无效时不得写文件'); },
      async unlink() {}
    },
    uploadRoot: '/safe/uploads',
    now: () => new Date('2026-11-12T09:31:00+08:00'),
    randomBytes: () => Buffer.from('ABCDEF123456', 'ascii'),
    renderReceiptPdf: async () => { throw new Error('签名路径无效时不得渲染 PDF'); }
  });
  await assert.rejects(
    () => symlinkedCreateService.createReceipt({
      async execute(sql) {
        if (/FROM salary_evidence_receipt/.test(sql)) return [[]];
        if (/INSERT INTO salary_evidence_receipt/.test(sql)) insertAfterUnsafeSignature = true;
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    }, receiptContext()),
    /符号链接|存储路径不安全/
  );
  assert.equal(insertAfterUnsafeSignature, false, '签名路径越界时不得保存回执');

  const insertError = new Error('模拟回执数据库写入失败');
  const cleanupState = { unlinked: [] };
  const cleanupService = createPayslipEvidenceReceiptService({
    fs: {
      async realpath(file) { return file; },
      async readFile() { return signaturePng; },
      async mkdir() { throw new Error('动态回执不得创建目录'); },
      async writeFile() { throw new Error('动态回执不得写文件'); },
      async unlink(file) { cleanupState.unlinked.push(file); }
    },
    uploadRoot: '/safe/uploads',
    now: () => new Date('2026-11-12T09:31:00+08:00'),
    randomBytes: () => Buffer.from('ABCDEF123456', 'ascii'),
    renderReceiptPdf: async () => { throw new Error('动态回执不得渲染 PDF'); }
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
  assert.equal(cleanupState.unlinked.length, 0, '数据库写入失败时没有动态 PDF 需要清理');

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
    evidenceChainHead: '3'.repeat(64)
  };
  const defaultFontPath = path.resolve(__dirname, '..', 'src', 'assets', 'fonts', 'NotoSansSC-Regular.ttf');
  const originalReadFile = fsPromises.readFile;
  let defaultFontReads = 0;
  fsPromises.readFile = async (...args) => {
    if (path.resolve(String(args[0])) === defaultFontPath) defaultFontReads += 1;
    return originalReadFile(...args);
  };
  try {
    await renderReceiptPdf(realPayload, signaturePng);
    await renderReceiptPdf(realPayload, signaturePng);
  } finally {
    fsPromises.readFile = originalReadFile;
  }
  assert.equal(defaultFontReads, 1, '默认中文字体字节必须在进程内只读取一次');

  const isolatedFontBytes = await originalReadFile(defaultFontPath);
  let customFontReads = 0;
  await renderReceiptPdf(realPayload, signaturePng, {
    fs: {
      async readFile() {
        customFontReads += 1;
        return isolatedFontBytes;
      }
    }
  });
  assert.equal(customFontReads, 1, '自定义 fs 不得复用或污染默认字体缓存');
  await renderReceiptPdf(realPayload, signaturePng, {
    fontBytes: isolatedFontBytes,
    fs: { async readFile() { throw new Error('fontBytes 存在时不得读取文件'); } }
  });

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
