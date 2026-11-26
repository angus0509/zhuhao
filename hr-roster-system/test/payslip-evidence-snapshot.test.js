const assert = require('node:assert/strict');
const {
  canonicalStringify,
  buildPayslipEvidenceSnapshot,
  hashPayslipEvidenceSnapshot
} = require('../src/services/payslip-evidence-snapshot.service');

function baseRow(overrides = {}) {
  return {
    companyId: 1,
    salaryDetailId: 901,
    salaryMonth: '2026-10',
    employeeId: 88,
    employeeName: '张三',
    customerName: '某制造公司',
    projectName: '装配项目',
    itemSnapshot: [
      { label: '备注', value: '夜班', category: 'display', sortOrder: 2 },
      { label: '基本工资', value: 5000, category: 'income', sortOrder: 1 },
      { label: '扣款', value: '25.5', category: 'deduction', sortOrder: 3 }
    ],
    idCardNo: '320000199001011234',
    bankAccount: '6222000000000000',
    phone: '13800138000',
    token: 'must-not-enter-snapshot',
    ...overrides
  };
}

function main() {
  assert.equal(
    canonicalStringify({ b: 2, a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"b":2}',
    '对象键必须递归排序，保证不同插入顺序得到相同字节'
  );
  const protoPayload = JSON.parse('{"a":1,"__proto__":{"tampered":true}}');
  assert.notEqual(
    canonicalStringify(protoPayload),
    canonicalStringify({ a: 1 }),
    'canonical JSON必须把__proto__作为普通自有键纳入摘要'
  );
  assert.match(canonicalStringify(protoPayload), /"__proto__"/);

  const snapshot = buildPayslipEvidenceSnapshot(baseRow());
  assert.deepEqual(snapshot, {
    schemaVersion: '1.0',
    companyId: 1,
    salaryDetailId: 901,
    salaryMonth: '2026-10',
    employeeId: 88,
    employeeName: '张三',
    customerName: '某制造公司',
    projectName: '装配项目',
    items: [
      { name: '基本工资', value: '5000.00' },
      { name: '备注', value: '夜班' },
      { name: '扣款', value: '25.50' }
    ]
  });

  const serialized = canonicalStringify(snapshot);
  assert.doesNotMatch(serialized, /320000199001011234|6222000000000000|13800138000|must-not-enter-snapshot/);
  assert.match(hashPayslipEvidenceSnapshot(snapshot), /^[a-f0-9]{64}$/);
  assert.equal(
    hashPayslipEvidenceSnapshot(snapshot),
    hashPayslipEvidenceSnapshot(JSON.parse(JSON.stringify(snapshot))),
    '相同快照必须产生相同摘要'
  );

  const reordered = buildPayslipEvidenceSnapshot(baseRow({
    itemSnapshot: JSON.stringify([...baseRow().itemSnapshot].reverse())
  }));
  assert.equal(hashPayslipEvidenceSnapshot(reordered), hashPayslipEvidenceSnapshot(snapshot));

  assert.throws(
    () => buildPayslipEvidenceSnapshot(baseRow({ salaryMonth: '2026-13' })),
    /工资月份/
  );
  assert.throws(
    () => buildPayslipEvidenceSnapshot(baseRow({
      itemSnapshot: [{ label: '身份证号', value: '320000199001011234', category: 'display', sortOrder: 1 }]
    })),
    /敏感|身份字段/
  );
  assert.throws(
    () => buildPayslipEvidenceSnapshot(baseRow({
      itemSnapshot: [{ label: '实发工资', value: 'abc', category: 'summary', sortOrder: 1 }]
    })),
    /金额/
  );

  console.log('payslip-evidence-snapshot-tests-ok');
}

main();
