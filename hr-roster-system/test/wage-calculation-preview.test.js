const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/wage-calculation.service');

async function run() {
  const originalTransaction = db.transaction;
  const writes = [];
  try {
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        writes.push({ sql, params });
        if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12, projectName: '一厂项目' }]];
        if (/FROM wage_calculation_runs/.test(sql) && /FOR UPDATE/.test(sql)) {
          return [[{ id: 80, revisionNo: 1, status: 'PREVIEW' }]];
        }
        if (/FROM attendance_daily_results d/.test(sql)) return [[
          {
            attendanceResultId: 501, employeeId: 101, name: '甲', shiftDate: '2026-10-08',
            workedMinutes: 465, approvedNormalMinutes: 465, approvedOvertimeMinutes: 0,
            resultStatus: 'NORMAL', reviewStatus: 'NONE', projectRuleId: 25,
            projectShiftRuleId: 252, shiftType: 'NIGHT', hourlyRate: '23.00',
            settlementMode: 'DAILY_ACCRUAL', pendingExceptionCount: 0
          },
          {
            attendanceResultId: 502, employeeId: 102, name: '乙', shiftDate: '2026-10-08',
            workedMinutes: 0, approvedNormalMinutes: 0, approvedOvertimeMinutes: 0,
            resultStatus: 'MISSING_PUNCH', reviewStatus: 'NONE', projectRuleId: 25,
            projectShiftRuleId: 251, shiftType: 'DAY', hourlyRate: '20.00',
            settlementMode: 'MONTHLY', pendingExceptionCount: 0
          }
        ]];
        if (/FROM attendance_allowance_rules/.test(sql)) return [[
          { projectRuleId: 25, allowanceName: '夜班补贴', shiftScope: 'NIGHT', calculationType: 'PER_SHIFT', unitAmount: '30.00' },
          { projectRuleId: 25, allowanceName: '高温补贴', shiftScope: 'ALL', calculationType: 'PER_HOUR', unitAmount: '1.50' }
        ]];
        if (/FROM wage_daily_payments/.test(sql)) return [[]];
        if (/INSERT INTO wage_calculation_runs/.test(sql)) return [{ insertId: 81 }];
        return [{ affectedRows: 1 }];
      }
    });
    const result = await service.createPreview(3, { id: 9, companyId: 3, dataScope: 1 }, 9, {
      projectId: 12, salaryMonth: '2026-10'
    });
    assert.deepEqual(result, {
      runId: 81, projectId: 12, salaryMonth: '2026-10', revisionNo: 2,
      totalEarned: '226.00', totalDailyPaid: '0.00', totalPayable: '226.00', blockedCount: 1
    });
    assert.ok(writes.some(item => /UPDATE wage_calculation_runs SET status='CANCELLED'/.test(item.sql)));
    const attendanceQuery = writes.find(item => /FROM attendance_daily_results d/.test(item.sql));
    assert.match(attendanceQuery.sql, /d\.company_id=:companyId AND d\.project_id=:projectId/);
    assert.match(attendanceQuery.sql, /hr_employee_job wage_job/);
    assert.match(attendanceQuery.sql, /shift_rule\.company_id=d\.company_id/);
    const lineWrites = writes.filter(item => /INSERT INTO wage_calculation_daily_lines/.test(item.sql));
    assert.equal(lineWrites.length, 2);
    assert.equal(lineWrites[0].params.payableMinutes, 480);
    assert.equal(lineWrites[0].params.earnedAmount, '226.00');
    assert.equal(lineWrites[1].params.calculationStatus, 'BLOCKED');
    assert.equal(lineWrites[1].params.blockedReason, '缺卡未处理');
  } finally {
    db.transaction = originalTransaction;
  }
}

async function runBlockerCoverage() {
  const originalTransaction = db.transaction;
  const lineWrites = [];
  try {
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12, projectName: '一厂项目' }]];
        if (/FROM wage_calculation_runs/.test(sql) && /FOR UPDATE/.test(sql)) return [[]];
        if (/FROM attendance_daily_results d/.test(sql)) return [[
          {
            attendanceResultId: 601, employeeId: 201, shiftDate: '2026-10-09', resultStatus: 'NORMAL',
            approvedNormalMinutes: 480, approvedOvertimeMinutes: 0, projectRuleId: 25,
            projectShiftRuleId: 251, shiftType: 'DAY', hourlyRate: '20.00', settlementMode: null
          },
          {
            attendanceResultId: 602, employeeId: 202, shiftDate: '2026-10-09', resultStatus: 'NORMAL',
            approvedNormalMinutes: 480, approvedOvertimeMinutes: 0, projectRuleId: 25,
            projectShiftRuleId: null, shiftType: null, hourlyRate: null, settlementMode: 'MONTHLY'
          },
          {
            attendanceResultId: 603, employeeId: 203, shiftDate: '2026-10-09', resultStatus: 'NORMAL',
            approvedNormalMinutes: 480, approvedOvertimeMinutes: 0, projectRuleId: 25,
            projectShiftRuleId: 251, shiftType: 'DAY', hourlyRate: null, settlementMode: 'MONTHLY'
          },
          {
            attendanceResultId: 604, employeeId: 204, shiftDate: '2026-10-09', resultStatus: 'NORMAL',
            approvedNormalMinutes: 480, approvedOvertimeMinutes: 0, projectRuleId: 25,
            projectShiftRuleId: 251, shiftType: 'DAY', hourlyRate: '20.00', settlementMode: 'MONTHLY',
            pendingExceptionCount: 1
          }
        ]];
        if (/FROM attendance_allowance_rules/.test(sql) || /FROM wage_daily_payments/.test(sql)) return [[]];
        if (/INSERT INTO wage_calculation_runs/.test(sql)) return [{ insertId: 91 }];
        if (/INSERT INTO wage_calculation_daily_lines/.test(sql)) lineWrites.push(params);
        return [{ affectedRows: 1 }];
      }
    });
    const result = await service.createPreview(3, { id: 9, companyId: 3, dataScope: 1 }, 9, {
      projectId: 12, salaryMonth: '2026-10'
    });
    assert.equal(result.blockedCount, 4);
    assert.deepEqual(lineWrites.map(item => item.blockedReason), [
      '未设置员工计薪方式', '未设置员工班次', '班次未设置时薪', '考勤异常待处理'
    ]);
    assert.ok(lineWrites.every(item => item.calculationStatus === 'BLOCKED'));
  } finally {
    db.transaction = originalTransaction;
  }
}

Promise.resolve()
  .then(run)
  .then(runBlockerCoverage)
  .then(() => assert.rejects(
    service.createPreview(3, { id: 9, companyId: 3, dataScope: 1 }, 9, {
      projectId: 12, salaryMonth: '2026-13'
    }),
    error => error.businessCode === 'INVALID_WAGE_CALCULATION'
  ))
  .then(() => console.log('wage-calculation-preview.test.js: passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
