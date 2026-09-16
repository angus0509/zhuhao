const assert = require('node:assert/strict');
const {
  parseMoneyToCents,
  formatCents,
  roundPayableMinutes,
  calculateDailyWage
} = require('../src/services/hourly-wage-calculator.service');

assert.equal(parseMoneyToCents('23.50'), 2350);
assert.equal(formatCents(2350), '23.50');
assert.equal(roundPayableMinutes(434), 420);
assert.equal(roundPayableMinutes(435), 450);
assert.equal(roundPayableMinutes(464), 450);
assert.equal(roundPayableMinutes(465), 480);

const normal = calculateDailyWage({
  approvedMinutes: 465,
  shiftType: 'NIGHT',
  hourlyRate: '23.00',
  allowances: [
    { allowanceName: '夜班补贴', shiftScope: 'NIGHT', calculationType: 'PER_SHIFT', unitAmount: '30.00' },
    { allowanceName: '高温补贴', shiftScope: 'ALL', calculationType: 'PER_HOUR', unitAmount: '1.50' }
  ],
  settlementMode: 'DAILY_ACCRUAL',
  dailyPaidAmount: '0.00',
  attendanceStatus: 'NORMAL'
});
assert.deepEqual(normal, {
  payableMinutes: 480,
  payableHours: '8.00',
  baseAmount: '184.00',
  allowanceAmount: '42.00',
  earnedAmount: '226.00',
  dailyPaidAmount: '0.00',
  payableAmount: '226.00',
  allowanceItems: [
    { allowanceName: '夜班补贴', amount: '30.00' },
    { allowanceName: '高温补贴', amount: '12.00' }
  ],
  calculationStatus: 'READY',
  blockedReason: null
});

const paid = calculateDailyWage({
  approvedMinutes: 465,
  shiftType: 'NIGHT',
  hourlyRate: '23.00',
  allowances: normal.allowanceItems.map(item => ({
    allowanceName: item.allowanceName,
    shiftScope: item.allowanceName === '夜班补贴' ? 'NIGHT' : 'ALL',
    calculationType: item.allowanceName === '夜班补贴' ? 'PER_SHIFT' : 'PER_HOUR',
    unitAmount: item.allowanceName === '夜班补贴' ? '30.00' : '1.50'
  })),
  settlementMode: 'DAILY_PAID',
  dailyPaidAmount: '226.00',
  attendanceStatus: 'NORMAL'
});
assert.equal(paid.payableAmount, '0.00');
assert.equal(paid.dailyPaidAmount, '226.00');

const absent = calculateDailyWage({
  approvedMinutes: 480,
  shiftType: 'DAY',
  hourlyRate: '20.00',
  allowances: [{ allowanceName: '餐补', shiftScope: 'ALL', calculationType: 'PER_SHIFT', unitAmount: '10.00' }],
  settlementMode: 'MONTHLY',
  dailyPaidAmount: '0.00',
  attendanceStatus: 'ABSENT'
});
assert.equal(absent.earnedAmount, '0.00');
assert.equal(absent.calculationStatus, 'ZERO');

for (const attendanceStatus of ['MISSING_PUNCH', 'PENDING_CORRECTION', 'PENDING_GEOFENCE']) {
  const blocked = calculateDailyWage({
    approvedMinutes: 480,
    shiftType: 'DAY',
    hourlyRate: '20.00',
    allowances: [],
    settlementMode: 'MONTHLY',
    dailyPaidAmount: '0.00',
    attendanceStatus
  });
  assert.equal(blocked.calculationStatus, 'BLOCKED');
  assert.ok(blocked.blockedReason);
}

for (const invalidInput of [
  { approvedMinutes: -1 },
  { shiftType: 'SWING' },
  { hourlyRate: '-1.00' },
  { settlementMode: 'WEEKLY' }
]) {
  assert.throws(() => calculateDailyWage({
    approvedMinutes: 480,
    shiftType: 'DAY',
    hourlyRate: '20.00',
    allowances: [],
    settlementMode: 'MONTHLY',
    dailyPaidAmount: '0.00',
    attendanceStatus: 'NORMAL',
    ...invalidInput
  }), error => error.businessCode === 'INVALID_WAGE_INPUT');
}

assert.throws(() => parseMoneyToCents('1.234'), error => error.businessCode === 'INVALID_WAGE_INPUT');

console.log('hourly-wage-calculator.test.js: passed');
