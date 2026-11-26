const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const { createPayslipEvidenceReceiptService } = require('../src/services/payslip-evidence-receipt.service');

async function main() {
  const pdf = Buffer.from('%PDF-1.7\nauthenticated-receipt');
  const sha256 = crypto.createHash('sha256').update(pdf).digest('hex');
  const queries = [];
  const service = createPayslipEvidenceReceiptService({
    db: {
      async first(sql, params) {
        queries.push({ sql, params });
        return {
          receiptNo: 'PSR-20261112-ABCDEF123456',
          storageMode: 'FILE',
          storagePath: 'company-1/payslip-receipts/receipt.pdf',
          receiptSha256: sha256
        };
      }
    },
    fs: {
      async realpath(file) { return file; },
      async readFile() { return pdf; }
    },
    uploadRoot: '/safe/uploads'
  });

  const employeeReceipt = await service.resolveEmployeeReceipt(1, 901, {
    id: 501,
    companyId: 1,
    accountType: 'EMPLOYEE',
    employeeId: 88
  });
  assert.equal(employeeReceipt.file, '/safe/uploads/company-1/payslip-receipts/receipt.pdf');
  assert.equal(employeeReceipt.receiptSha256, sha256);
  assert.deepEqual(queries[0].params, { companyId: 1, payslipId: 901, employeeId: 88 });
  assert.match(queries[0].sql, /d\.employee_id=:employeeId/);
  assert.match(queries[0].sql, /r\.company_id=d\.company_id/);
  assert.match(queries[0].sql, /r\.storage_mode storageMode/);

  await assert.rejects(
    () => service.resolveEmployeeReceipt(1, 901, { id: 9, accountType: 'MANAGER' }),
    /员工本人/
  );

  queries.length = 0;
  const managerReceipt = await service.resolvePayrollReceipt(1, 901, {
    id: 9,
    companyId: 1,
    dataScope: 5,
    permissions: ['payroll:view']
  });
  assert.equal(managerReceipt.receiptNo, 'PSR-20261112-ABCDEF123456');
  assert.match(queries[0].sql, /sys_user_project/, '管理端下载必须执行项目数据范围');
  assert.equal(queries[0].params.companyId, 1);
  assert.equal(queries[0].params.payslipId, 901);
  assert.equal(queries[0].params.scopeUserId, 9);

  const denied = createPayslipEvidenceReceiptService({
    db: { async first() { return null; } },
    fs: {
      async realpath(file) { return file; },
      async readFile() { throw new Error('越权时不得读取文件'); }
    },
    uploadRoot: '/safe/uploads'
  });
  await assert.rejects(
    () => denied.resolvePayrollReceipt(2, 901, {
      id: 9, companyId: 2, dataScope: 5, permissions: ['payroll:view']
    }),
    /不存在|权限/
  );

  const tampered = createPayslipEvidenceReceiptService({
    db: {
      async first() {
        return {
          receiptNo: 'PSR-20261112-ABCDEF123456',
          storageMode: 'FILE',
          storagePath: 'company-1/payslip-receipts/receipt.pdf',
          receiptSha256: 'f'.repeat(64)
        };
      }
    },
    fs: {
      async realpath(file) { return file; },
      async readFile() { return pdf; }
    },
    uploadRoot: '/safe/uploads'
  });
  await assert.rejects(
    () => tampered.resolveEmployeeReceipt(1, 901, {
      id: 501, accountType: 'EMPLOYEE', employeeId: 88
    }),
    /完整性/
  );

  const traversal = createPayslipEvidenceReceiptService({
    db: {
      async first() {
        return {
          receiptNo: 'PSR-20261112-ABCDEF123456',
          storageMode: 'FILE',
          storagePath: '../secret.pdf',
          receiptSha256: sha256
        };
      }
    },
    fs: {
      async realpath(file) { return file; },
      async readFile() { return pdf; }
    },
    uploadRoot: '/safe/uploads'
  });
  await assert.rejects(
    () => traversal.resolveEmployeeReceipt(1, 901, {
      id: 501, accountType: 'EMPLOYEE', employeeId: 88
    }),
    /企业目录|存储路径不安全/
  );

  const wrongCompanyDirectory = createPayslipEvidenceReceiptService({
    db: {
      async first() {
        return {
          receiptNo: 'PSR-20261112-ABCDEF123456',
          storageMode: 'FILE',
          storagePath: 'company-2/payslip-receipts/receipt.pdf',
          receiptSha256: sha256
        };
      }
    },
    fs: {
      async realpath(file) { return file; },
      async readFile() { return pdf; }
    },
    uploadRoot: '/safe/uploads'
  });
  await assert.rejects(
    () => wrongCompanyDirectory.resolveEmployeeReceipt(1, 901, {
      id: 501, accountType: 'EMPLOYEE', employeeId: 88
    }),
    /企业目录|存储路径不安全/
  );

  const symlinkEscape = createPayslipEvidenceReceiptService({
    db: {
      async first() {
        return {
          receiptNo: 'PSR-20261112-ABCDEF123456',
          storageMode: 'FILE',
          storagePath: 'company-1/payslip-receipts/receipt.pdf',
          receiptSha256: sha256
        };
      }
    },
    fs: {
      async realpath(file) {
        if (file === '/safe/uploads') return '/safe/uploads';
        if (file === '/safe/uploads/company-1') return '/safe/uploads/company-1';
        return '/outside/receipt.pdf';
      },
      async readFile() { return pdf; }
    },
    uploadRoot: '/safe/uploads'
  });
  await assert.rejects(
    () => symlinkEscape.resolveEmployeeReceipt(1, 901, {
      id: 501, accountType: 'EMPLOYEE', employeeId: 88
    }),
    /符号链接|企业目录|存储路径不安全/
  );

  const employeeRoutes = fs.readFileSync('src/routes/payslip.routes.js', 'utf8');
  const managerRoutes = fs.readFileSync('src/routes/operations.routes.js', 'utf8');
  const employeeController = fs.readFileSync('src/controllers/payslip.controller.js', 'utf8');
  const managerController = fs.readFileSync('src/controllers/operations.controller.js', 'utf8');
  assert.match(employeeRoutes, /get\('\/me\/payslips\/:id\/evidence-receipt'/);
  assert.match(
    managerRoutes,
    /get\('\/payroll\/payslips\/:id\/evidence-receipt'[\s\S]*requirePermission\('payroll:view'\)/
  );
  for (const source of [employeeController, managerController]) {
    assert.match(source, /Content-Type', 'application\/pdf'/);
    assert.match(source, /Content-Disposition'/);
    assert.match(source, /Cache-Control', 'private, no-store'/);
    assert.match(source, /X-Receipt-SHA256/);
  }

  const defaultReceiptService = require('../src/services/payslip-evidence-receipt.service');
  const originalEmployeeResolver = defaultReceiptService.resolveEmployeeReceipt;
  const originalManagerResolver = defaultReceiptService.resolvePayrollReceipt;
  try {
    defaultReceiptService.resolveEmployeeReceipt = async () => ({
      buffer: pdf,
      receiptNo: 'PSR-20261112-ABCDEF123456',
      receiptSha256: sha256
    });
    defaultReceiptService.resolvePayrollReceipt = async () => ({
      buffer: pdf,
      receiptNo: 'PSR-20261112-ABCDEF123456',
      receiptSha256: sha256
    });
    const payslipController = require('../src/controllers/payslip.controller');
    const operationsController = require('../src/controllers/operations.controller');
    for (const handler of [
      payslipController.downloadEvidenceReceiptMine,
      operationsController.downloadPayrollEvidenceReceipt
    ]) {
      const response = {
        headers: {},
        body: null,
        setHeader(name, value) { this.headers[name] = value; },
        send(value) { this.body = value; return value; },
        sendFile() { throw new Error('已校验回执不得再次按路径打开'); }
      };
      let nextError = null;
      await handler(
        { companyId: 1, params: { id: '901' }, user: { id: 501, employeeId: 88 } },
        response,
        error => { nextError = error; }
      );
      assert.equal(nextError, null);
      assert.equal(response.body, pdf);
      assert.equal(response.headers['Content-Type'], 'application/pdf');
      assert.equal(response.headers['Cache-Control'], 'private, no-store');
      assert.equal(response.headers['X-Receipt-SHA256'], sha256);
      assert.equal(crypto.createHash('sha256').update(response.body).digest('hex'), sha256);
    }
  } finally {
    defaultReceiptService.resolveEmployeeReceipt = originalEmployeeResolver;
    defaultReceiptService.resolvePayrollReceipt = originalManagerResolver;
  }

  console.log('payroll-evidence-receipt-access-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
