#!/usr/bin/env node

const db = require('../src/db');
const env = require('../src/config/env');
const { verifyEvidenceRows } = require('../src/services/payslip-evidence-log.service');

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function positiveInteger(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

async function run(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const query = options.query || db.query;
  const output = options.output || console.log;
  const companyId = positiveInteger(optionValue(argv, '--company-id'));
  const payslipId = positiveInteger(optionValue(argv, '--payslip-id'));
  if (!companyId || !payslipId) {
    output(JSON.stringify({ valid: false, checked: 0, chainHead: null, ids: [], errors: [{ code: 'INVALID_ARGUMENTS' }] }));
    return 1;
  }

  const rows = await query(
    `SELECT id,company_id companyId,salary_detail_id payslipId,employee_id employeeId,user_id userId,
            action_type actionType,result_status resultStatus,evidence_hash evidenceHash,
            previous_evidence_hash previousEvidenceHash,payslip_content_sha256 payslipContentSha256,
            signature_sha256 signatureSha256,challenge_id challengeId,statement_version statementVersion,
            evidence_key_version evidenceKeyVersion,created_at createdAt
     FROM salary_receipt_log
     WHERE company_id=:companyId AND salary_detail_id=:payslipId
     ORDER BY id ASC`,
    { companyId, payslipId }
  );
  const secretResolver = options.secretResolver || (version => (
    version === env.payslipEvidence.keyVersion
      ? env.payslipEvidence.hmacSecret
      : version == null ? env.auth.jwtSecret : ''
  ));
  const result = verifyEvidenceRows(rows, secretResolver);
  output(JSON.stringify({
    companyId,
    payslipId,
    valid: result.valid,
    checked: result.checked,
    chainHead: result.chainHead,
    ids: rows.map(row => Number(row.id)),
    errors: result.errors
  }));
  return result.valid ? 0 : 1;
}

if (require.main === module) {
  run().then(code => {
    process.exitCode = code;
  }).catch(() => {
    console.error(JSON.stringify({ valid: false, checked: 0, errors: [{ code: 'VERIFY_FAILED' }] }));
    process.exitCode = 1;
  });
}

module.exports = { run };
