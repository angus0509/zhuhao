const crypto = require('node:crypto');
const db = require('../src/db');
const env = require('../src/config/env');
const receiptService = require('../src/services/payslip-evidence-receipt.service');
const { canonicalStringify } = require('../src/services/payslip-evidence-snapshot.service');

const KEY_VERSION = 'v1';

function parsePayload(value) {
  const payload = typeof value === 'string' ? JSON.parse(value) : value;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('历史回执载荷无效');
  }
  return payload;
}

function buildDynamicPayload(row, migratedAt) {
  const original = parsePayload(row.receiptPayload);
  return {
    ...original,
    generatedAt: row.receiptGeneratedAt || original.generatedAt,
    signedAt: row.signatureSignedAt || original.signedAt,
    storageMigration: {
      schemaVersion: '1.0',
      from: 'FILE',
      storagePath: String(row.storagePath || ''),
      receiptSha256: String(row.receiptSha256 || '').toLowerCase(),
      originalGeneratedAt: original.generatedAt || null,
      originalSignedAt: original.signedAt || null,
      migratedAt: migratedAt.toISOString()
    }
  };
}

function payloadHmac(secret, payload) {
  if (Buffer.byteLength(String(secret || ''), 'utf8') < 32) {
    throw new Error('工资条证据密钥未配置或长度不足');
  }
  return crypto.createHmac('sha256', secret)
    .update(`payslip-receipt-payload:${KEY_VERSION}|${canonicalStringify(payload)}`, 'utf8')
    .digest('hex');
}

async function runMigration(options = {}) {
  const database = options.db || db;
  const service = options.receiptService || receiptService;
  const secret = options.secret ?? env.payslipEvidence.hmacSecret;
  const now = options.now || (() => new Date());
  const apply = options.apply === true;
  const rows = await database.query(
    `SELECT r.id,r.company_id companyId,r.salary_detail_id payslipId,
            receipt_payload receiptPayload,storage_path storagePath,
            receipt_sha256 receiptSha256,r.generated_at receiptGeneratedAt,
            signature.signed_at signatureSignedAt
     FROM salary_evidence_receipt r
     JOIN salary_signature signature ON signature.id=r.signature_id
       AND signature.company_id=r.company_id AND signature.status=1
     WHERE r.storage_mode='FILE' AND r.status=1
     ORDER BY r.id`
  );
  const result = { scanned: rows.length, converted: 0, deleted: 0 };

  for (const row of rows) {
    const adminUser = { id: 0, companyId: Number(row.companyId), dataScope: 1 };
    await service.resolvePayrollReceipt(row.companyId, row.payslipId, adminUser);
    const migratedAt = now();
    if (!(migratedAt instanceof Date) || Number.isNaN(migratedAt.getTime())) {
      throw new Error('迁移时间无效');
    }
    const originalPayload = typeof row.receiptPayload === 'string'
      ? row.receiptPayload
      : JSON.stringify(row.receiptPayload);
    const dynamicPayload = buildDynamicPayload(row, migratedAt);
    const dynamicPayloadJson = JSON.stringify(dynamicPayload);
    const hmac = payloadHmac(secret, dynamicPayload);
    if (!apply) continue;

    await database.transaction(async connection => {
      const [updateResult] = await connection.execute(
        `UPDATE salary_evidence_receipt
         SET receipt_payload=:receiptPayload,
             receipt_payload_hmac=:receiptPayloadHmac,
             receipt_payload_key_version=:receiptPayloadKeyVersion,
             storage_mode='DYNAMIC',storage_path=NULL,receipt_sha256=NULL
         WHERE id=:id AND company_id=:companyId AND salary_detail_id=:payslipId
           AND storage_mode='FILE' AND storage_path=:storagePath
           AND receipt_sha256=:receiptSha256 AND status=1`,
        {
          id: Number(row.id), companyId: Number(row.companyId), payslipId: Number(row.payslipId),
          receiptPayload: dynamicPayloadJson, receiptPayloadHmac: hmac,
          receiptPayloadKeyVersion: KEY_VERSION, storagePath: row.storagePath,
          receiptSha256: row.receiptSha256
        }
      );
      if (Number(updateResult?.affectedRows) !== 1) throw new Error('历史回执状态已变化，停止迁移');
    });

    try {
      await service.resolvePayrollReceipt(row.companyId, row.payslipId, adminUser);
    } catch (error) {
      await database.query(
        `UPDATE salary_evidence_receipt
         SET receipt_payload=:receiptPayload,receipt_payload_hmac=NULL,
             receipt_payload_key_version=NULL,storage_mode='FILE',
             storage_path=:storagePath,receipt_sha256=:receiptSha256
         WHERE id=:id AND company_id=:companyId AND storage_mode='DYNAMIC'
           AND receipt_payload_hmac=:receiptPayloadHmac`,
        {
          id: Number(row.id), companyId: Number(row.companyId), receiptPayload: originalPayload,
          storagePath: row.storagePath, receiptSha256: row.receiptSha256,
          receiptPayloadHmac: hmac
        }
      );
      throw error;
    }
    result.converted += 1;
    await service.removeReceiptFile(row.storagePath);
    result.deleted += 1;
  }
  return result;
}

function parseArgs(argv) {
  const unknown = argv.filter(item => item !== '--apply');
  if (unknown.length) throw new Error(`未知参数: ${unknown.join(', ')}`);
  return { apply: argv.includes('--apply') };
}

if (require.main === module) {
  runMigration(parseArgs(process.argv.slice(2)))
    .then(result => console.log(JSON.stringify(result)))
    .finally(() => db.pool.end())
    .catch(error => {
      console.error(error.message || error);
      process.exitCode = 1;
    });
}

module.exports = { runMigration, buildDynamicPayload, payloadHmac, parseArgs };
