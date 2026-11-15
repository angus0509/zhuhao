const db = require('../src/db');
const operationsService = require('../src/services/operations.service');

function parseArgs(argv = []) {
  const result = { apply: false, companyId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      result.apply = true;
      continue;
    }
    if (arg === '--company-id') {
      const companyId = Number(argv[index + 1]);
      if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error('企业ID参数无效');
      result.companyId = companyId;
      index += 1;
      continue;
    }
    throw new Error(`不支持的参数：${arg}`);
  }
  return result;
}

function createPayslipEvidenceBackfill(dependencies = {}) {
  const database = dependencies.database || db;
  const createSnapshots = dependencies.createSnapshots || operationsService.createEvidenceSnapshotsForBatch;
  const output = dependencies.output || (line => console.log(line));

  async function listCandidates(companyId) {
    const companyFilter = companyId == null ? '' : 'AND d.company_id=:companyId';
    return database.query(
      `SELECT d.company_id companyId,d.batch_id batchId,COUNT(*) eligibleCount
       FROM salary_detail d
       JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
       WHERE b.batch_status=5 AND d.receipt_status=1 AND d.evidence_snapshot IS NULL
         ${companyFilter}
       GROUP BY d.company_id,d.batch_id
       ORDER BY d.company_id,d.batch_id`,
      companyId == null ? {} : { companyId }
    );
  }

  async function run({ apply = false, companyId = null } = {}) {
    const candidates = await listCandidates(companyId);
    const companySummaries = new Map();
    for (const row of candidates) {
      const key = Number(row.companyId);
      if (!companySummaries.has(key)) {
        companySummaries.set(key, { eligible: 0, applied: 0, skipped: 0, failed: 0 });
      }
      companySummaries.get(key).eligible += Number(row.eligibleCount || 0);
    }
    const summary = {
      mode: apply ? 'apply' : 'dry-run',
      eligible: candidates.reduce((total, row) => total + Number(row.eligibleCount || 0), 0),
      applied: 0,
      skipped: 0,
      failed: 0
    };

    if (apply) {
      const companies = new Map();
      for (const row of candidates) {
        const key = Number(row.companyId);
        if (!companies.has(key)) companies.set(key, []);
        companies.get(key).push(row);
      }
      for (const [targetCompanyId, batches] of companies) {
        const companyEligible = batches.reduce((total, row) => total + Number(row.eligibleCount || 0), 0);
        try {
          const applied = await database.transaction(async connection => {
            let count = 0;
            for (const batch of batches) {
              const result = await createSnapshots(connection, {
                companyId: targetCompanyId,
                batchId: Number(batch.batchId),
                onlyPending: true
              });
              count += Number(result.count || 0);
            }
            return count;
          });
          if (applied > companyEligible) throw new Error('处理数量超过候选数量');
          summary.applied += applied;
          summary.skipped += companyEligible - applied;
          companySummaries.get(targetCompanyId).applied += applied;
          companySummaries.get(targetCompanyId).skipped += companyEligible - applied;
        } catch (_error) {
          summary.failed += companyEligible;
          companySummaries.get(targetCompanyId).failed += companyEligible;
        }
      }
    }

    for (const [targetCompanyId, companySummary] of companySummaries) {
      output(`company_id=${targetCompanyId} eligible=${companySummary.eligible} applied=${companySummary.applied} skipped=${companySummary.skipped} failed=${companySummary.failed}`);
    }
    output(`mode=${summary.mode} eligible=${summary.eligible} applied=${summary.applied} skipped=${summary.skipped} failed=${summary.failed}`);
    return summary;
  }

  return { run };
}

function exitCodeForSummary(summary) {
  return Number(summary?.failed || 0) > 0 ? 1 : 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await createPayslipEvidenceBackfill().run(options);
  process.exitCode = exitCodeForSummary(summary);
}

if (require.main === module) {
  main().catch(() => {
    console.error('工资条证据快照处理失败');
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, createPayslipEvidenceBackfill, exitCodeForSummary };
