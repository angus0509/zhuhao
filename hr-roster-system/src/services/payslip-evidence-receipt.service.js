const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const db = require('../db');
const { createError } = require('../utils/response');
const { projectScope } = require('../utils/data-scope');
const { DEFAULT_UPLOAD_ROOT } = require('./payslip-signature.service');
const { hashPayslipEvidenceSnapshot } = require('./payslip-evidence-snapshot.service');

const PDF_FONT_PATH = path.resolve(__dirname, '..', 'assets', 'fonts', 'NotoSansSC-Regular.ttf');
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_NO_PATTERN = /^PSR-\d{8}-[A-Z0-9]{12}$/;
const PAYSLIP_RECEIPT_STATEMENT_V2 = '本人确认已查看并收到本期工资条。本次签收仅证明工资条已送达本人，不代表本人放弃对工资计算、考勤、扣款及实际支付情况提出异议的权利。本人同意使用当前登录账号和本次手写签名完成电子签收。';
const PAYSLIP_RECEIPT_STATEMENT_V2_1 = '公司已通过本系统向本人送达本期工资条。本人确认当前登录账号由本人使用，已查看工资条所展示的全部内容，并由本人完成手写签名和电子签收。系统记录的登录账号、签收时间、工资条内容摘要、签名文件及电子回执，可作为本次工资条送达和签收过程的留痕。本人如对工资计算、考勤、扣款或实际支付情况存在异议，应及时通过系统提交，公司将按规定核查处理。';

function statementTextForVersion(version) {
  if (version === '2.0') return PAYSLIP_RECEIPT_STATEMENT_V2;
  if (version === '2.1') return PAYSLIP_RECEIPT_STATEMENT_V2_1;
  throw createError('工资条签收声明版本无效，暂不能生成回执', 409);
}
function parseSnapshot(value) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || ''));
  } catch (_error) {
    return null;
  }
}

function requirePositiveInteger(value, message) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw createError(message);
  return result;
}

function requireHash(value, message) {
  const result = String(value || '').toLowerCase();
  if (!HASH_PATTERN.test(result)) throw createError(message, 409);
  return result;
}

function safeStoragePath(uploadRoot, storagePath, companyId = null) {
  const normalizedStoragePath = String(storagePath || '');
  if (companyId != null) {
    const expectedPrefix = `company-${Number(companyId)}${path.sep}`;
    if (!normalizedStoragePath.startsWith(expectedPrefix)) {
      throw createError('电子回执存储路径不属于当前企业目录', 400);
    }
  }
  const absolutePath = path.resolve(uploadRoot, normalizedStoragePath);
  if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw createError('电子回执存储路径不安全', 400);
  }
  return absolutePath;
}

async function realStoragePath(filesystem, uploadRoot, storagePath, companyId) {
  const lexicalFile = safeStoragePath(uploadRoot, storagePath, companyId);
  const lexicalCompanyRoot = path.resolve(uploadRoot, `company-${Number(companyId)}`);
  const lexicalDirectory = path.dirname(lexicalFile);
  const [realUploadRoot, realCompanyRoot, realDirectory, realFile] = await Promise.all([
    filesystem.realpath(uploadRoot),
    filesystem.realpath(lexicalCompanyRoot),
    filesystem.realpath(lexicalDirectory),
    filesystem.realpath(lexicalFile)
  ]);
  if (!realCompanyRoot.startsWith(`${realUploadRoot}${path.sep}`)
    || !realDirectory.startsWith(`${realCompanyRoot}${path.sep}`)
    || !realFile.startsWith(`${realDirectory}${path.sep}`)) {
    throw createError('电子回执存储路径存在不安全的符号链接', 400);
  }
  return realFile;
}

async function realStorageDirectory(filesystem, uploadRoot, directory, companyId) {
  const lexicalCompanyRoot = path.resolve(uploadRoot, `company-${Number(companyId)}`);
  const [realUploadRoot, realCompanyRoot, realDirectory] = await Promise.all([
    filesystem.realpath(uploadRoot),
    filesystem.realpath(lexicalCompanyRoot),
    filesystem.realpath(directory)
  ]);
  if (!realCompanyRoot.startsWith(`${realUploadRoot}${path.sep}`)
    || !realDirectory.startsWith(`${realCompanyRoot}${path.sep}`)) {
    throw createError('电子回执存储目录存在不安全的符号链接', 400);
  }
  return realDirectory;
}

async function verifiedCompanyRoot(filesystem, uploadRoot, companyId) {
  const lexicalCompanyRoot = path.resolve(uploadRoot, `company-${Number(companyId)}`);
  const [realUploadRoot, realCompanyRoot] = await Promise.all([
    filesystem.realpath(uploadRoot),
    filesystem.realpath(lexicalCompanyRoot)
  ]);
  if (!realCompanyRoot.startsWith(`${realUploadRoot}${path.sep}`)) {
    throw createError('电子回执企业目录存在不安全的符号链接', 400);
  }
  return realCompanyRoot;
}

function receiptDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}${parts.month}${parts.day}`;
}

function wrapText(font, text, size, maxWidth) {
  const source = String(text ?? '');
  if (!source) return [''];
  const lines = [];
  let line = '';
  for (const character of source) {
    const candidate = `${line}${character}`;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function renderReceiptPdf(payload, signatureBuffer, dependencies = {}) {
  const filesystem = dependencies.fs || fs;
  const fontPath = dependencies.fontPath || PDF_FONT_PATH;
  const onLabelDraw = typeof dependencies.onLabelDraw === 'function'
    ? dependencies.onLabelDraw
    : () => {};
  const fontBytes = dependencies.fontBytes || await filesystem.readFile(fontPath);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  // 完整嵌入中文字体，避免 fontkit 子集化造成部分 CJK 字形乱码。
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });
  const asciiFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const signatureImage = await pdfDoc.embedPng(signatureBuffer);
  pdfDoc.setTitle(`工资条电子签收回执 ${payload.receiptNo}`);
  pdfDoc.setSubject('工资条送达与电子签收证据回执');
  pdfDoc.setAuthor(payload.companyName || '工资条系统');
  pdfDoc.setKeywords([
    '工资条电子签收回执',
    payload.receiptNo,
    payload.statementVersion,
    payload.payslip?.salaryMonth || '',
    payload.payslip?.employeeName || ''
  ]);
  pdfDoc.setProducer('HR Roster Payslip Evidence Service');
  pdfDoc.setCreator('HR Roster Payslip Evidence Service');

  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  const MARGIN = 46;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const COLOR_TEXT = rgb(0.12, 0.14, 0.18);
  const COLOR_MUTED = rgb(0.38, 0.42, 0.48);
  const COLOR_LINE = rgb(0.82, 0.84, 0.88);
  const COLOR_ACCENT = rgb(0.08, 0.31, 0.53);
  let page;
  let y;
  let pageNumber = 0;

  function addPage() {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
    y = PAGE_HEIGHT - MARGIN;
    const footerLabel = '电子签收回执 · ';
    page.drawText(footerLabel, {
      x: MARGIN,
      y: 22,
      size: 7.5,
      font,
      color: COLOR_MUTED
    });
    page.drawText(payload.receiptNo, {
      x: MARGIN + font.widthOfTextAtSize(footerLabel, 7.5),
      y: 22,
      size: 7.5,
      font: asciiFont,
      color: COLOR_MUTED
    });
    const numberText = `第 ${pageNumber} 页`;
    page.drawText(numberText, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(numberText, 7.5),
      y: 22,
      size: 7.5,
      font,
      color: COLOR_MUTED
    });
  }

  function ensureSpace(height) {
    if (y - height < 42) addPage();
  }

  function drawSectionTitle(title) {
    ensureSpace(28);
    y -= 10;
    page.drawText(title, { x: MARGIN, y, size: 11, font, color: COLOR_ACCENT });
    y -= 8;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.7,
      color: COLOR_LINE
    });
    y -= 14;
  }

  function drawLabelValue(label, value, options = {}) {
    const labelWidth = options.labelWidth || 92;
    const size = options.size || 9;
    const lineHeight = options.lineHeight || 14;
    const normalizedValue = String(value || '-');
    const valueFont = /^[\x20-\x7E]*$/.test(normalizedValue) ? asciiFont : font;
    const valueLines = wrapText(valueFont, normalizedValue, size, CONTENT_WIDTH - labelWidth);
    let continuation = false;
    valueLines.forEach((line, index) => {
      if (y - lineHeight < 42) {
        addPage();
        continuation = index > 0;
      }
      if (index === 0 || continuation) {
        const drawnLabel = continuation ? `${label}（续）` : label;
        page.drawText(drawnLabel, {
          x: MARGIN,
          y,
          size,
          font,
          color: COLOR_MUTED
        });
        onLabelDraw(drawnLabel, { pageNumber, continuation });
      }
      page.drawText(line, {
        x: MARGIN + labelWidth,
        y,
        size,
        font: valueFont,
        color: COLOR_TEXT
      });
      y -= lineHeight;
      continuation = false;
    });
  }

  addPage();
  page.drawText('工资条电子签收回执', { x: MARGIN, y, size: 20, font, color: COLOR_TEXT });
  y -= 26;
  page.drawText('PAYSLIP ELECTRONIC RECEIPT', { x: MARGIN, y, size: 8, font: asciiFont, color: COLOR_MUTED });
  y -= 24;
  drawLabelValue('回执编号', payload.receiptNo);
  drawLabelValue('生成时间', payload.generatedAt);
  drawLabelValue('企业名称', payload.companyName);

  drawSectionTitle('工资条信息');
  drawLabelValue('工资月份', payload.payslip?.salaryMonth);
  drawLabelValue('客户单位', payload.payslip?.customerName);
  drawLabelValue('所属项目', payload.payslip?.projectName);
  drawLabelValue('员工姓名', payload.payslip?.employeeName);

  const items = Array.isArray(payload.payslip?.items) ? payload.payslip.items : [];
  for (const item of items) {
    drawLabelValue(String(item?.name || '展示项目'), String(item?.value ?? ''));
  }

  drawSectionTitle('签收信息');
  drawLabelValue('签收姓名', payload.signedName);
  drawLabelValue('签收时间', payload.signedAt);
  drawLabelValue('签收账号ID', String(payload.signedUserId));
  drawLabelValue('挑战记录ID', String(payload.challengeId));
  drawLabelValue('声明版本', payload.statementVersion);
  drawLabelValue('签收声明', payload.statementText, { labelWidth: 72, lineHeight: 15 });

  ensureSpace(92);
  page.drawText('手写签名', { x: MARGIN, y, size: 9, font, color: COLOR_MUTED });
  const maxWidth = 250;
  const maxHeight = 70;
  const scale = Math.min(maxWidth / signatureImage.width, maxHeight / signatureImage.height, 1);
  const width = signatureImage.width * scale;
  const height = signatureImage.height * scale;
  page.drawRectangle({
    x: MARGIN + 92,
    y: y - 72,
    width: maxWidth,
    height: 76,
    borderColor: COLOR_LINE,
    borderWidth: 0.7
  });
  page.drawImage(signatureImage, {
    x: MARGIN + 92 + (maxWidth - width) / 2,
    y: y - 70 + (70 - height) / 2,
    width,
    height
  });
  y -= 88;

  drawSectionTitle('完整性摘要');
  drawLabelValue('工资条内容 SHA-256', payload.payslipContentSha256, { labelWidth: 126, size: 7.5, lineHeight: 11 });
  drawLabelValue('签名文件 SHA-256', payload.signatureSha256, { labelWidth: 126, size: 7.5, lineHeight: 11 });
  drawLabelValue('证据链头 HMAC', payload.evidenceChainHead, { labelWidth: 126, size: 7.5, lineHeight: 11 });

  return Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
}

function createPayslipEvidenceReceiptService(dependencies = {}) {
  const database = dependencies.db || db;
  const filesystem = dependencies.fs || fs;
  const uploadRoot = path.resolve(dependencies.uploadRoot || DEFAULT_UPLOAD_ROOT);
  const now = dependencies.now || (() => new Date());
  const randomBytes = dependencies.randomBytes || crypto.randomBytes;
  const renderPdf = dependencies.renderReceiptPdf || renderReceiptPdf;

  async function createReceipt(connection, context = {}) {
    const companyId = requirePositiveInteger(context.companyId, '企业参数无效');
    const payslipId = requirePositiveInteger(context.payslipId, '工资条参数无效');
    const employeeId = requirePositiveInteger(context.employeeId, '员工参数无效');
    const userId = requirePositiveInteger(context.userId, '员工账号参数无效');
    const signatureId = requirePositiveInteger(context.signatureId, '工资条签名无效');
    const challengeId = requirePositiveInteger(context.challengeId, '签收挑战无效');
    const [[existing]] = await connection.execute(
      `SELECT receipt_no receiptNo,storage_path storagePath,receipt_sha256 receiptSha256
       FROM salary_evidence_receipt
       WHERE company_id=:companyId AND salary_detail_id=:payslipId AND status=1
       LIMIT 1 FOR UPDATE`,
      { companyId, payslipId }
    );
    if (existing) {
      return {
        receiptNo: existing.receiptNo,
        storagePath: existing.storagePath,
        receiptSha256: existing.receiptSha256,
        created: false
      };
    }

    const evidenceSnapshot = parseSnapshot(context.evidenceSnapshot);
    const payslipContentSha256 = requireHash(context.payslipContentSha256, '工资条内容摘要无效');
    const signatureSha256 = requireHash(context.signatureSha256, '工资条签名摘要无效');
    const evidenceChainHead = requireHash(context.evidenceChainHead, '工资条证据链头无效');
    if (evidenceSnapshot?.schemaVersion !== '1.0'
      || hashPayslipEvidenceSnapshot(evidenceSnapshot) !== payslipContentSha256) {
      throw createError('工资条证据快照无效，暂不能生成回执', 409);
    }
    const statementVersion = String(context.statementVersion || '');
    const statementText = statementTextForVersion(statementVersion);

    let signatureFile;
    try {
      signatureFile = await realStoragePath(
        filesystem,
        uploadRoot,
        context.signatureStoragePath,
        companyId
      );
    } catch (error) {
      if (error?.statusCode) throw error;
      throw createError('工资条签名文件不存在，请联系管理员检查备份', 404);
    }
    const signatureBuffer = await filesystem.readFile(signatureFile);
    if (crypto.createHash('sha256').update(signatureBuffer).digest('hex') !== signatureSha256) {
      throw createError('工资条签名文件完整性校验失败', 409, 'PAYSLIP_SIGNATURE_INTEGRITY_FAILED');
    }

    const generatedAt = now();
    if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) {
      throw createError('电子回执生成时间无效');
    }
    const suffix = randomBytes(12).toString('hex').toUpperCase().slice(0, 12);
    const receiptNo = `PSR-${receiptDate(generatedAt)}-${suffix}`;
    const payload = {
      schemaVersion: '1.0',
      receiptNo,
      generatedAt: generatedAt.toISOString(),
      companyName: String(context.companyName || '').trim(),
      payslip: evidenceSnapshot,
      signedName: String(context.signedName || '').trim(),
      signedAt: context.signedAt,
      signedUserId: userId,
      challengeId,
      statementVersion,
      statementText,
      payslipContentSha256,
      signatureSha256,
      evidenceChainHead
    };
    const pdf = await renderPdf(payload, signatureBuffer);
    const receiptSha256 = crypto.createHash('sha256').update(pdf).digest('hex');
    const relativePath = path.join(`company-${companyId}`, 'payslip-receipts', `${receiptNo}.pdf`);
    const absolutePath = safeStoragePath(uploadRoot, relativePath, companyId);
    const realCompanyRoot = await verifiedCompanyRoot(filesystem, uploadRoot, companyId);
    const receiptDirectory = path.join(realCompanyRoot, 'payslip-receipts');
    await filesystem.mkdir(receiptDirectory, { recursive: true, mode: 0o700 });
    const writeDirectory = await realStorageDirectory(
      filesystem,
      uploadRoot,
      receiptDirectory,
      companyId
    );
    const writePath = path.join(writeDirectory, path.basename(absolutePath));
    await filesystem.writeFile(writePath, pdf, { mode: 0o600, flag: 'wx' });
    try {
      await connection.execute(
        `INSERT INTO salary_evidence_receipt
         (company_id,salary_detail_id,employee_id,signature_id,challenge_id,receipt_no,
          statement_version,payslip_content_sha256,signature_sha256,evidence_chain_head,
          receipt_payload,storage_path,receipt_sha256,generated_at,status,created_by)
         VALUES (:companyId,:payslipId,:employeeId,:signatureId,:challengeId,:receiptNo,
          :statementVersion,:payslipContentSha256,:signatureSha256,:evidenceChainHead,
          :receiptPayload,:storagePath,:receiptSha256,:generatedAt,1,:userId)`,
        {
          companyId,
          payslipId,
          employeeId,
          signatureId,
          challengeId,
          receiptNo,
          statementVersion,
          payslipContentSha256,
          signatureSha256,
          evidenceChainHead,
          receiptPayload: JSON.stringify(payload),
          storagePath: relativePath,
          receiptSha256,
          generatedAt,
          userId
        }
      );
    } catch (error) {
      try {
        await filesystem.unlink(writePath);
      } catch (_cleanupError) {
        // 数据库写入失败时尽力移除孤立文件，原始错误优先返回。
      }
      throw error;
    }
    return { receiptNo, storagePath: relativePath, receiptSha256, created: true };
  }

  async function resolveReceipt(row, missingMessage, companyId) {
    if (!row) throw createError(missingMessage, 404);
    if (!RECEIPT_NO_PATTERN.test(String(row.receiptNo || ''))) {
      throw createError('电子回执编号无效', 409, 'PAYSLIP_RECEIPT_INVALID');
    }
    let file;
    let bytes;
    try {
      file = await realStoragePath(filesystem, uploadRoot, row.storagePath, companyId);
      bytes = await filesystem.readFile(file);
    } catch (error) {
      if (error?.statusCode) throw error;
      throw createError('电子回执文件不存在，请联系管理员检查备份', 404);
    }
    const receiptSha256 = requireHash(row.receiptSha256, '电子回执摘要无效');
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== receiptSha256) {
      throw createError('电子回执文件完整性校验失败', 409, 'PAYSLIP_RECEIPT_INTEGRITY_FAILED');
    }
    return { file, buffer: bytes, receiptNo: row.receiptNo, receiptSha256 };
  }

  async function resolveEmployeeReceipt(companyId, payslipId, user) {
    const employeeId = Number(user?.employeeId || 0);
    if (user?.accountType !== 'EMPLOYEE' || !employeeId) {
      throw createError('仅员工本人可以下载电子签收回执', 403);
    }
    const normalizedPayslipId = requirePositiveInteger(payslipId, '工资条参数无效');
    const row = await database.first(
      `SELECT r.receipt_no receiptNo,r.storage_path storagePath,r.receipt_sha256 receiptSha256
       FROM salary_detail d
       JOIN salary_evidence_receipt r ON r.company_id=d.company_id
         AND r.salary_detail_id=d.id AND r.employee_id=d.employee_id AND r.status=1
       WHERE d.company_id=:companyId AND d.id=:payslipId AND d.employee_id=:employeeId
         AND d.receipt_status=2
       LIMIT 1`,
      { companyId: Number(companyId), payslipId: normalizedPayslipId, employeeId }
    );
    return resolveReceipt(row, '电子签收回执不存在或无本人访问权限', companyId);
  }

  async function resolvePayrollReceipt(companyId, payslipId, user) {
    const normalizedPayslipId = requirePositiveInteger(payslipId, '工资条参数无效');
    const params = { companyId: Number(companyId), payslipId: normalizedPayslipId };
    const row = await database.first(
      `SELECT r.receipt_no receiptNo,r.storage_path storagePath,r.receipt_sha256 receiptSha256
       FROM salary_detail d
       JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
       JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
       JOIN salary_evidence_receipt r ON r.company_id=d.company_id
         AND r.salary_detail_id=d.id AND r.employee_id=d.employee_id AND r.status=1
       WHERE d.company_id=:companyId AND d.id=:payslipId ${projectScope(user, params, 'p')}
       LIMIT 1`,
      params
    );
    return resolveReceipt(row, '电子签收回执不存在或无项目权限', companyId);
  }

  async function removeReceiptFile(storagePath) {
    const match = String(storagePath || '').match(/^company-(\d+)[/\\]/);
    if (!match) throw createError('电子回执存储路径不安全', 400);
    const file = await realStoragePath(filesystem, uploadRoot, storagePath, Number(match[1]));
    try {
      await filesystem.unlink(file);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  return {
    createReceipt,
    resolveEmployeeReceipt,
    resolvePayrollReceipt,
    removeReceiptFile
  };
}

const service = createPayslipEvidenceReceiptService();

module.exports = {
  ...service,
  createPayslipEvidenceReceiptService,
  renderReceiptPdf,
  PAYSLIP_RECEIPT_STATEMENT_V2,
  PAYSLIP_RECEIPT_STATEMENT_V2_1
};
