const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/operations.service');

const scopedUser = {
  id: 9,
  companyId: 1,
  dataScope: 5,
  scopeDeptIds: [],
  permissions: ['payroll:view']
};

// 1x1 透明 PNG，作为员工手写签名的最小合法样例
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function inflateFlateStreams(buffer) {
  const text = buffer.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    let raw = match[1].replace(/\r?\n$/, '');
    try {
      chunks.push(zlib.inflateSync(Buffer.from(raw, 'latin1')));
    } catch (_error) {
      // 非 FlateDecode 流，跳过
    }
  }
  return Buffer.concat(chunks);
}

async function main() {
  // ---- 发放明细 CSV 导出 ----
  assert.equal(typeof service.exportPayrollBatchCsv, 'function', '缺少工资条批次导出服务');
  assert.equal(typeof service.exportPayrollReceiptPdf, 'function', '缺少工资条签收记录 PDF 导出服务');

  const csvCalls = [];
  const original = { first: db.first, query: db.query };
  db.first = async (sql, params) => {
    csvCalls.push({ type: 'first', sql, params });
    return { id: 61, batchNo: 'GZ202608001', salaryMonth: '2026-08', batchStatus: 5, customerName: '甲客户', projectName: '装配项目' };
  };
  db.query = async (sql, params) => {
    csvCalls.push({ type: 'query', sql, params });
    if (/INSERT INTO hr_operation_log/.test(sql)) return { affectedRows: 1 };
    return [{
      id: 901,
      employeeName: '=HYPERLINK("bad")',
      phone: '13800138000',
      grossAmount: 8150,
      netAmount: 6900,
      receiptStatus: 2,
      viewed: 1,
      signedName: '张三',
      signedAt: '2026-08-12 10:00:00',
      receiptAt: '2026-08-12 10:01:00',
      smsDeliveryStatus: 'SENT',
      smsErrorSummary: null,
      openDisputeId: null
    }];
  };
  try {
    const csv = await service.exportPayrollBatchCsv(1, 61, 'delivery', scopedUser, {
      operatorId: 9,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent'
    });
    assert.equal(csv.count, 1);
    assert.match(csv.csv, /^\uFEFF/);
    assert.match(csv.csv, /138\*\*\*\*8000/, '导出手机号必须脱敏');
    assert.doesNotMatch(csv.csv, /13800138000/, '导出禁止包含完整手机号');
    assert.match(csv.csv, /'=HYPERLINK/, 'CSV 必须阻止公式注入');
    assert.match(csv.csv, /发放状态/);
    assert.match(csv.csv, /8150\.00/);
  } finally {
    Object.assign(db, original);
  }
  const csvSql = csvCalls.map(item => item.sql).join('\n');
  assert.match(csvSql, /sys_user_project/, '工资条导出必须执行项目数据隔离');
  assert.match(csvSql, /INSERT INTO hr_operation_log/, '工资条导出必须记录审计日志');
  assert.ok(csvCalls.some(item => item.params?.actionType === 'export_payroll_delivery'), '发放明细导出审计类型错误');

  // ---- 签收记录 PDF 导出 ----
  const uploadRoot = path.resolve(__dirname, '..', 'uploads');
  const signatureRel = `company-1/payslip-signatures/export-test-${Date.now()}.png`;
  const signatureAbs = path.resolve(uploadRoot, signatureRel);
  await fs.mkdir(path.dirname(signatureAbs), { recursive: true });
  await fs.writeFile(signatureAbs, Buffer.from(PNG_BASE64, 'base64'));

  const pdfCalls = [];
  const original2 = { first: db.first, query: db.query };
  db.first = async (sql, params) => {
    pdfCalls.push({ type: 'first', sql, params });
    return { id: 61, batchNo: 'GZ202608001', salaryMonth: '2026-08', batchStatus: 5, customerName: '甲客户', projectName: '装配项目' };
  };
  db.query = async (sql, params) => {
    pdfCalls.push({ type: 'query', sql, params });
    if (/INSERT INTO hr_operation_log/.test(sql)) return { affectedRows: 1 };
    return [
      {
        id: 901,
        employeeName: '张三',
        phone: '13800138000',
        netAmount: 6900,
        receiptStatus: 2,
        receiptAt: '2026-08-12 10:01:00',
        viewed: 1,
        signedName: '张三',
        signedAt: '2026-08-12 10:00:00',
        signatureStoragePath: signatureRel,
        openDisputeId: null
      },
      {
        id: 902,
        employeeName: '李四',
        phone: '13900139000',
        netAmount: 7200,
        receiptStatus: 0,
        receiptAt: null,
        viewed: 0,
        signedName: null,
        signedAt: null,
        signatureStoragePath: null,
        openDisputeId: null
      }
    ];
  };
  let pdf;
  try {
    pdf = await service.exportPayrollReceiptPdf(1, 61, scopedUser, {
      operatorId: 9,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent'
    });
  } finally {
    Object.assign(db, original2);
    await fs.unlink(signatureAbs).catch(() => {});
  }

  assert.equal(pdf.count, 2);
  assert.ok(Buffer.isBuffer(pdf.buffer));
  assert.equal(pdf.buffer.slice(0, 5).toString(), '%PDF-');
  assert.ok(pdf.buffer.length > 3000, 'PDF 应包含字体与签名图片，体积不能过小');
  const loaded = await PDFDocument.load(pdf.buffer);
  assert.ok(loaded.getPageCount() >= 1, '生成的 PDF 必须可被解析');

  const inflated = inflateFlateStreams(pdf.buffer).toString('latin1');
  assert.match(inflated, /\/Image/, '签收记录 PDF 必须包含签名图片对象');
  assert.match(inflated, /\bDo\b/, '签收记录 PDF 必须绘制签名图片');
  assert.match(inflated, /\/FontFile2|\/FontFile3/, '签收记录 PDF 必须嵌入中文字体子集');

  const pdfSql = pdfCalls.map(item => item.sql).join('\n');
  assert.match(pdfSql, /sys_user_project/, '签收记录 PDF 导出必须执行项目数据隔离');
  assert.match(pdfSql, /hr_attachment/, '签收记录 PDF 导出必须关联签名附件');
  assert.match(pdfSql, /INSERT INTO hr_operation_log/, '签收记录 PDF 导出必须记录审计日志');
  assert.ok(pdfCalls.some(item => item.params?.actionType === 'export_payroll_receipts_pdf'), '签收 PDF 导出审计类型错误');

  // ---- 路由断言 ----
  const routes = require('../src/routes/operations.routes');
  const stack = routes.stack || [];
  const csvRoutes = stack.filter(layer => /export\.csv$/.test(String(layer.route?.path || '')));
  const pdfRoutes = stack.filter(layer => /export\.pdf$/.test(String(layer.route?.path || '')));
  assert.equal(csvRoutes.length, 1, '发放明细导出应保留为 CSV 接口');
  assert.equal(pdfRoutes.length, 1, '签收记录导出应改为 PDF 接口');
  for (const layer of [...csvRoutes, ...pdfRoutes]) {
    assert.ok(layer.route.methods.get);
    assert.ok(layer.route.stack.length >= 3, '导出接口必须包含鉴权、限流和权限校验');
  }

  console.log('payroll-batch-export-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
