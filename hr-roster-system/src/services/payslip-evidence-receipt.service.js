const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const db = require('../db');
const env = require('../config/env');
const { createError } = require('../utils/response');
const { projectScope } = require('../utils/data-scope');
const { DEFAULT_UPLOAD_ROOT } = require('./payslip-signature.service');
const {
  canonicalStringify,
  hashPayslipEvidenceSnapshot
} = require('./payslip-evidence-snapshot.service');
const { verifyEvidenceRows } = require('./payslip-evidence-log.service');

const PDF_FONT_PATH = path.resolve(__dirname, '..', 'assets', 'fonts', 'NotoSansSC-Regular.ttf');
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_NO_PATTERN = /^PSR-\d{8}-[A-Z0-9]{12}$/;
const DEFAULT_DYNAMIC_RENDER_CONCURRENCY = 2;
const DEFAULT_DYNAMIC_RENDER_QUEUE_LIMIT = 8;
const RECEIPT_PAYLOAD_KEY_VERSION = 'v1';
const SHANGHAI_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});
const PAYSLIP_RECEIPT_STATEMENT_V2 = '本人确认已查看并收到本期工资条。本次签收仅证明工资条已送达本人，不代表本人放弃对工资计算、考勤、扣款及实际支付情况提出异议的权利。本人同意使用当前登录账号和本次手写签名完成电子签收。';
const PAYSLIP_RECEIPT_STATEMENT_V2_1 = '公司已通过本系统向本人送达本期工资条。本人确认当前登录账号由本人使用，已查看工资条所展示的全部内容，并由本人完成手写签名和电子签收。系统记录的登录账号、签收时间、工资条内容摘要、签名文件及电子回执，可作为本次工资条送达和签收过程的留痕。本人如对工资计算、考勤、扣款或实际支付情况存在异议，应及时通过系统提交，公司将按规定核查处理。';
let defaultPdfFontBytesPromise = null;

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

function payloadHmac(secret, payload, keyVersion) {
  if (keyVersion !== RECEIPT_PAYLOAD_KEY_VERSION) {
    throw createError('电子回执载荷密钥版本无效', 409, 'PAYSLIP_RECEIPT_INVALID');
  }
  return crypto.createHmac('sha256', secret)
    .update(`payslip-receipt-payload:${keyVersion}|${canonicalStringify(payload)}`, 'utf8')
    .digest('hex');
}

function hashesEqual(left, right) {
  const normalizedLeft = String(left || '').toLowerCase();
  const normalizedRight = String(right || '').toLowerCase();
  if (!HASH_PATTERN.test(normalizedLeft) || !HASH_PATTERN.test(normalizedRight)) return false;
  return crypto.timingSafeEqual(Buffer.from(normalizedLeft, 'hex'), Buffer.from(normalizedRight, 'hex'));
}

function timestampToSecond(value) {
  const source = String(value || '').trim();
  const databaseTimestamp = source.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:\.\d+)?$/);
  if (databaseTimestamp && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(source)) {
    return databaseTimestamp[1].replace('T', ' ');
  }
  const parsed = value instanceof Date ? value : new Date(source);
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = SHANGHAI_TIMESTAMP_FORMATTER.formatToParts(parsed).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function positiveIntegerOrDefault(value, fallback, allowZero = false) {
  const normalized = Number(value);
  const minimum = allowZero ? 0 : 1;
  return Number.isSafeInteger(normalized) && normalized >= minimum ? normalized : fallback;
}

async function receiptFontBytes(dependencies, filesystem, fontPath) {
  if (dependencies.fontBytes != null) return dependencies.fontBytes;
  if (dependencies.fs || dependencies.fontPath) return filesystem.readFile(fontPath);
  if (!defaultPdfFontBytesPromise) {
    defaultPdfFontBytesPromise = fs.readFile(PDF_FONT_PATH).catch(error => {
      defaultPdfFontBytesPromise = null;
      throw error;
    });
  }
  return defaultPdfFontBytesPromise;
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
  const fontBytes = await receiptFontBytes(dependencies, filesystem, fontPath);
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
  const evidenceSecret = dependencies.evidenceSecret ?? env.payslipEvidence.hmacSecret;
  const legacyEvidenceSecret = dependencies.legacyEvidenceSecret ?? env.auth.jwtSecret;
  const evidenceKeyVersion = dependencies.evidenceKeyVersion || env.payslipEvidence.keyVersion;
  const evidenceSecretResolver = dependencies.evidenceSecretResolver || (keyVersion => {
    if (!keyVersion) return legacyEvidenceSecret;
    return ['v1', 'v2', evidenceKeyVersion].includes(keyVersion) ? evidenceSecret : '';
  });
  const receiptPayloadKeyVersion = dependencies.receiptPayloadKeyVersion
    || RECEIPT_PAYLOAD_KEY_VERSION;
  const receiptPayloadSecretResolver = dependencies.receiptPayloadSecretResolver
    || (keyVersion => keyVersion === RECEIPT_PAYLOAD_KEY_VERSION ? evidenceSecret : '');
  const dynamicRenderConcurrency = positiveIntegerOrDefault(
    dependencies.dynamicRenderConcurrency,
    DEFAULT_DYNAMIC_RENDER_CONCURRENCY
  );
  const dynamicRenderQueueLimit = positiveIntegerOrDefault(
    dependencies.dynamicRenderQueueLimit,
    DEFAULT_DYNAMIC_RENDER_QUEUE_LIMIT,
    true
  );
  let activeDynamicRenders = 0;
  const dynamicRenderQueue = [];

  async function acquireDynamicRenderSlot() {
    if (activeDynamicRenders < dynamicRenderConcurrency) {
      activeDynamicRenders += 1;
      return;
    }
    if (dynamicRenderQueue.length >= dynamicRenderQueueLimit) {
      throw createError(
        '电子回执生成繁忙，请稍后重试',
        503,
        'PAYSLIP_RECEIPT_BUSY'
      );
    }
    await new Promise(resolve => dynamicRenderQueue.push(resolve));
  }

  function releaseDynamicRenderSlot() {
    const next = dynamicRenderQueue.shift();
    if (next) next();
    else activeDynamicRenders -= 1;
  }

  async function renderDynamicReceipt(payload, signatureBuffer) {
    await acquireDynamicRenderSlot();
    try {
      return await renderPdf(payload, signatureBuffer);
    } finally {
      releaseDynamicRenderSlot();
    }
  }

  async function loadEvidenceRows(companyId, payslipId, employeeId) {
    return database.query(
      `SELECT id,company_id companyId,salary_detail_id payslipId,employee_id employeeId,
              user_id userId,action_type actionType,result_status resultStatus,
              evidence_hash evidenceHash,previous_evidence_hash previousEvidenceHash,
              payslip_content_sha256 payslipContentSha256,signature_sha256 signatureSha256,
              challenge_id challengeId,statement_version statementVersion,
              evidence_key_version evidenceKeyVersion,ip_address ipAddress,
              user_agent userAgent,created_at createdAt
       FROM salary_receipt_log
       WHERE company_id=:companyId AND salary_detail_id=:payslipId AND employee_id=:employeeId
       ORDER BY id`,
      { companyId, payslipId, employeeId }
    );
  }

  async function verifyReceiptEvidence(row, companyId, payslipContentSha256,
    signatureSha256, evidenceChainHead) {
    const payslipId = requirePositiveInteger(row.receiptPayslipId, '工资条参数无效');
    const employeeId = requirePositiveInteger(row.receiptEmployeeId, '员工参数无效');
    const evidenceRows = await loadEvidenceRows(Number(companyId), payslipId, employeeId);
    const headIndex = evidenceRows.findIndex(item => hashesEqual(item.evidenceHash, evidenceChainHead));
    if (headIndex < 0) {
      throw createError('工资条证据链头无效，暂不能生成回执', 409, 'PAYSLIP_RECEIPT_INVALID');
    }
    const receiptChain = evidenceRows.slice(0, headIndex + 1);
    const verification = verifyEvidenceRows(receiptChain, evidenceSecretResolver);
    const acceptRow = receiptChain[headIndex];
    if (!verification.valid
      || !hashesEqual(verification.chainHead, evidenceChainHead)
      || String(acceptRow.actionType || '') !== 'ACCEPT'
      || Number(acceptRow.resultStatus) !== 2
      || Number(acceptRow.companyId) !== Number(companyId)
      || Number(acceptRow.payslipId) !== payslipId
      || Number(acceptRow.employeeId) !== employeeId
      || Number(acceptRow.userId) !== Number(row.receiptCreatedBy)
      || !hashesEqual(acceptRow.payslipContentSha256, payslipContentSha256)
      || !hashesEqual(acceptRow.signatureSha256, signatureSha256)
      || Number(acceptRow.challengeId) !== Number(row.receiptChallengeId)
      || String(acceptRow.statementVersion || '') !== String(row.receiptStatementVersion || '')) {
      throw createError('工资条证据链校验失败，暂不能生成回执', 409, 'PAYSLIP_RECEIPT_INVALID');
    }
  }

  async function createReceipt(connection, context = {}) {
    const companyId = requirePositiveInteger(context.companyId, '企业参数无效');
    const payslipId = requirePositiveInteger(context.payslipId, '工资条参数无效');
    const employeeId = requirePositiveInteger(context.employeeId, '员工参数无效');
    const userId = requirePositiveInteger(context.userId, '员工账号参数无效');
    const signatureId = requirePositiveInteger(context.signatureId, '工资条签名无效');
    const challengeId = requirePositiveInteger(context.challengeId, '签收挑战无效');
    const [[existing]] = await connection.execute(
      `SELECT receipt_no receiptNo,storage_mode storageMode,
              storage_path storagePath,receipt_sha256 receiptSha256
       FROM salary_evidence_receipt
       WHERE company_id=:companyId AND salary_detail_id=:payslipId AND status=1
       LIMIT 1 FOR UPDATE`,
      { companyId, payslipId }
    );
    if (existing) {
      return {
        receiptNo: existing.receiptNo,
        storageMode: existing.storageMode,
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
    if (Buffer.byteLength(String(evidenceSecret || ''), 'utf8') < 32) {
      throw createError('工资条证据服务配置不完整', 503, 'PAYSLIP_EVIDENCE_NOT_CONFIGURED');
    }
    const receiptPayloadSecret = receiptPayloadSecretResolver(receiptPayloadKeyVersion);
    if (Buffer.byteLength(String(receiptPayloadSecret || ''), 'utf8') < 32) {
      throw createError('工资条回执密钥版本不可用', 503, 'PAYSLIP_EVIDENCE_NOT_CONFIGURED');
    }
    const receiptPayloadHmac = payloadHmac(
      receiptPayloadSecret,
      payload,
      receiptPayloadKeyVersion
    );
    const storageMode = 'DYNAMIC';
    const storagePath = null;
    const receiptSha256 = null;
    await connection.execute(
      `INSERT INTO salary_evidence_receipt
       (company_id,salary_detail_id,employee_id,signature_id,challenge_id,receipt_no,
        statement_version,payslip_content_sha256,signature_sha256,evidence_chain_head,
        receipt_payload,receipt_payload_hmac,receipt_payload_key_version,
        storage_mode,storage_path,receipt_sha256,
        generated_at,status,created_by)
       VALUES (:companyId,:payslipId,:employeeId,:signatureId,:challengeId,:receiptNo,
        :statementVersion,:payslipContentSha256,:signatureSha256,:evidenceChainHead,
        :receiptPayload,:receiptPayloadHmac,:receiptPayloadKeyVersion,
        :storageMode,:storagePath,:receiptSha256,
        :generatedAt,1,:userId)`,
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
        receiptPayloadHmac,
        receiptPayloadKeyVersion,
        storageMode,
        storagePath,
        receiptSha256,
        generatedAt,
        userId
      }
    );
    return { receiptNo, storageMode, storagePath, receiptSha256, created: true };
  }

  async function resolveFileReceipt(row, companyId) {
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

  async function resolveDynamicReceipt(row, companyId) {
    const payload = parseSnapshot(row.receiptPayload);
    const storedPayloadKeyVersion = String(row.receiptPayloadKeyVersion || '').trim();
    const receiptPayloadSecret = receiptPayloadSecretResolver(storedPayloadKeyVersion);
    if (Buffer.byteLength(String(receiptPayloadSecret || ''), 'utf8') < 32) {
      throw createError('工资条回执密钥版本不可用', 503, 'PAYSLIP_EVIDENCE_NOT_CONFIGURED');
    }
    const storedPayloadHmac = requireHash(row.receiptPayloadHmac, '电子回执载荷摘要无效');
    if (!payload || !hashesEqual(
      payloadHmac(receiptPayloadSecret, payload, storedPayloadKeyVersion),
      storedPayloadHmac
    )) {
      throw createError(
        '电子回执完整性校验失败',
        409,
        'PAYSLIP_RECEIPT_INTEGRITY_FAILED'
      );
    }
    const payslipContentSha256 = requireHash(row.payslipContentSha256, '工资条内容摘要无效');
    const signatureSha256 = requireHash(row.signatureSha256, '工资条签名摘要无效');
    const evidenceChainHead = requireHash(row.evidenceChainHead, '工资条证据链头无效');
    const receiptChallengeId = Number(row.receiptChallengeId || 0);
    const signatureChallengeId = Number(row.signatureChallengeId || 0);
    const receiptCreatedBy = Number(row.receiptCreatedBy || 0);
    const receiptStatementVersion = String(row.receiptStatementVersion || '');
    const signatureStatementVersion = String(row.signatureStatementVersion || '');
    let expectedStatementText = '';
    try {
      expectedStatementText = statementTextForVersion(receiptStatementVersion);
    } catch (_error) {
      throw createError('工资条签收声明无效，暂不能生成回执', 409, 'PAYSLIP_RECEIPT_INVALID');
    }
    if (payload?.schemaVersion !== '1.0'
      || payload.receiptNo !== row.receiptNo
      || payload.payslipContentSha256 !== payslipContentSha256
      || payload.signatureSha256 !== signatureSha256
      || payload.evidenceChainHead !== evidenceChainHead
      || Number(payload.payslip?.companyId || 0) !== Number(companyId)
      || hashPayslipEvidenceSnapshot(payload.payslip) !== payslipContentSha256) {
      throw createError('工资条证据快照无效，暂不能生成回执', 409, 'PAYSLIP_RECEIPT_INVALID');
    }
    if (String(payload.signedName || '') !== String(row.signedName || '')
      || Number(payload.signedUserId || 0) !== receiptCreatedBy
      || Number(payload.challengeId || 0) !== receiptChallengeId
      || receiptChallengeId !== signatureChallengeId
      || String(payload.statementVersion || '') !== receiptStatementVersion
      || receiptStatementVersion !== signatureStatementVersion
      || String(payload.statementText || '') !== expectedStatementText
      || !timestampToSecond(payload.signedAt)
      || timestampToSecond(payload.signedAt) !== timestampToSecond(row.signedAt)
      || !timestampToSecond(payload.generatedAt)
      || timestampToSecond(payload.generatedAt) !== timestampToSecond(row.receiptGeneratedAt)) {
      throw createError('工资条签收证据无效，暂不能生成回执', 409, 'PAYSLIP_RECEIPT_INVALID');
    }
    if (!hashesEqual(signatureSha256, row.authoritativeSignatureSha256)
      || !hashesEqual(signatureSha256, row.attachmentSha256)
      || Number(row.challengeUserId || 0) !== receiptCreatedBy) {
      throw createError('工资条签名或签收账号证据无效，暂不能生成回执', 409, 'PAYSLIP_RECEIPT_INVALID');
    }
    await verifyReceiptEvidence(
      row,
      companyId,
      payslipContentSha256,
      signatureSha256,
      evidenceChainHead
    );

    let signatureFile;
    let signatureBuffer;
    if (!String(row.signatureStoragePath || '').trim()) {
      throw createError('工资条签名文件不存在，请联系管理员检查备份', 404);
    }
    try {
      signatureFile = await realStoragePath(
        filesystem,
        uploadRoot,
        row.signatureStoragePath,
        companyId
      );
      signatureBuffer = await filesystem.readFile(signatureFile);
    } catch (error) {
      if (error?.statusCode) throw error;
      throw createError('工资条签名文件不存在，请联系管理员检查备份', 404);
    }
    if (crypto.createHash('sha256').update(signatureBuffer).digest('hex') !== signatureSha256) {
      throw createError('工资条签名文件完整性校验失败', 409, 'PAYSLIP_SIGNATURE_INTEGRITY_FAILED');
    }

    const buffer = await renderDynamicReceipt(payload, signatureBuffer);
    const receiptSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    return { file: null, buffer, receiptNo: row.receiptNo, receiptSha256 };
  }

  async function resolveReceipt(row, missingMessage, companyId) {
    if (!row) throw createError(missingMessage, 404);
    if (!RECEIPT_NO_PATTERN.test(String(row.receiptNo || ''))) {
      throw createError('电子回执编号无效', 409, 'PAYSLIP_RECEIPT_INVALID');
    }
    if (row.storageMode === 'FILE') return resolveFileReceipt(row, companyId);
    if (row.storageMode === 'DYNAMIC') return resolveDynamicReceipt(row, companyId);
    throw createError('电子回执存储模式无效', 409, 'PAYSLIP_RECEIPT_INVALID');
  }

  async function resolveEmployeeReceipt(companyId, payslipId, user) {
    const employeeId = Number(user?.employeeId || 0);
    if (user?.accountType !== 'EMPLOYEE' || !employeeId) {
      throw createError('仅员工本人可以下载电子签收回执', 403);
    }
    const normalizedPayslipId = requirePositiveInteger(payslipId, '工资条参数无效');
    const row = await database.first(
      `SELECT r.receipt_no receiptNo,r.storage_mode storageMode,
              r.salary_detail_id receiptPayslipId,r.employee_id receiptEmployeeId,
              r.receipt_payload receiptPayload,r.receipt_payload_hmac receiptPayloadHmac,
              r.receipt_payload_key_version receiptPayloadKeyVersion,
              r.payslip_content_sha256 payslipContentSha256,
              r.signature_sha256 signatureSha256,r.evidence_chain_head evidenceChainHead,
              r.challenge_id receiptChallengeId,r.statement_version receiptStatementVersion,
              r.generated_at receiptGeneratedAt,r.created_by receiptCreatedBy,
              r.storage_path storagePath,r.receipt_sha256 receiptSha256,
              signature.signed_name signedName,signature.signed_at signedAt,
              signature.signature_sha256 authoritativeSignatureSha256,
              signature.challenge_id signatureChallengeId,
              signature.statement_version signatureStatementVersion,
              attachment.storage_path signatureStoragePath,attachment.file_sha256 attachmentSha256,
              challenge.user_id challengeUserId
       FROM salary_detail d
       JOIN salary_evidence_receipt r ON r.company_id=d.company_id
         AND r.salary_detail_id=d.id AND r.employee_id=d.employee_id AND r.status=1
       LEFT JOIN salary_signature signature ON signature.id=r.signature_id
         AND signature.company_id=r.company_id AND signature.salary_detail_id=r.salary_detail_id
         AND signature.employee_id=r.employee_id AND signature.status=1
       LEFT JOIN hr_attachment attachment ON attachment.id=signature.attachment_id
         AND attachment.company_id=signature.company_id AND attachment.employee_id=signature.employee_id
         AND attachment.biz_type='payslip_signature' AND attachment.biz_id=d.id AND attachment.status=1
       LEFT JOIN salary_sign_challenge challenge ON challenge.id=r.challenge_id
         AND challenge.company_id=r.company_id AND challenge.salary_detail_id=r.salary_detail_id
         AND challenge.employee_id=r.employee_id
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
      `SELECT r.receipt_no receiptNo,r.storage_mode storageMode,
              r.salary_detail_id receiptPayslipId,r.employee_id receiptEmployeeId,
              r.receipt_payload receiptPayload,r.receipt_payload_hmac receiptPayloadHmac,
              r.receipt_payload_key_version receiptPayloadKeyVersion,
              r.payslip_content_sha256 payslipContentSha256,
              r.signature_sha256 signatureSha256,r.evidence_chain_head evidenceChainHead,
              r.challenge_id receiptChallengeId,r.statement_version receiptStatementVersion,
              r.generated_at receiptGeneratedAt,r.created_by receiptCreatedBy,
              r.storage_path storagePath,r.receipt_sha256 receiptSha256,
              signature.signed_name signedName,signature.signed_at signedAt,
              signature.signature_sha256 authoritativeSignatureSha256,
              signature.challenge_id signatureChallengeId,
              signature.statement_version signatureStatementVersion,
              attachment.storage_path signatureStoragePath,attachment.file_sha256 attachmentSha256,
              challenge.user_id challengeUserId
       FROM salary_detail d
       JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
       JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
       JOIN salary_evidence_receipt r ON r.company_id=d.company_id
         AND r.salary_detail_id=d.id AND r.employee_id=d.employee_id AND r.status=1
       LEFT JOIN salary_signature signature ON signature.id=r.signature_id
         AND signature.company_id=r.company_id AND signature.salary_detail_id=r.salary_detail_id
         AND signature.employee_id=r.employee_id AND signature.status=1
       LEFT JOIN hr_attachment attachment ON attachment.id=signature.attachment_id
         AND attachment.company_id=signature.company_id AND attachment.employee_id=signature.employee_id
         AND attachment.biz_type='payslip_signature' AND attachment.biz_id=d.id AND attachment.status=1
       LEFT JOIN salary_sign_challenge challenge ON challenge.id=r.challenge_id
         AND challenge.company_id=r.company_id AND challenge.salary_detail_id=r.salary_detail_id
         AND challenge.employee_id=r.employee_id
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
