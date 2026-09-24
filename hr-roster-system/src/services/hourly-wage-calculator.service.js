const { createError } = require('../utils/response');

const VALID_SHIFTS = new Set(['DAY', 'NIGHT']);
const VALID_SETTLEMENT_MODES = new Set(['MONTHLY', 'DAILY_ACCRUAL', 'DAILY_PAID']);
const BLOCKED_ATTENDANCE = new Map([
  ['MISSING_PUNCH', '缺卡未处理'],
  ['PENDING_CORRECTION', '补卡申请待处理'],
  ['PENDING_GEOFENCE', '围栏异常待处理']
]);

function invalidInput(message = '工资计算参数无效') {
  throw createError(message, 400, 'INVALID_WAGE_INPUT');
}

function parseMoneyToCents(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,8})(?:\.(\d{1,2}))?$/);
  if (!match) invalidInput('金额格式无效');
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}

function formatCents(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalidInput('金额分值无效');
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

function roundPayableMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 0) invalidInput('核准工时无效');
  return Math.floor((minutes + 15) / 30) * 30;
}

function emptyResult(status, reason = null) {
  return {
    payableMinutes: 0,
    payableHours: '0.00',
    baseAmount: '0.00',
    allowanceAmount: '0.00',
    earnedAmount: '0.00',
    dailyPaidAmount: '0.00',
    payableAmount: '0.00',
    allowanceItems: [],
    calculationStatus: status,
    blockedReason: reason
  };
}

function validateAllowance(item) {
  const allowanceName = String(item?.allowanceName || '').trim();
  const shiftScope = String(item?.shiftScope || '');
  const calculationType = String(item?.calculationType || '');
  if (!allowanceName || !['DAY', 'NIGHT', 'ALL'].includes(shiftScope)
    || !['PER_SHIFT', 'PER_HOUR'].includes(calculationType)) {
    invalidInput('补贴规则无效');
  }
  return { allowanceName, shiftScope, calculationType, unitAmountCents: parseMoneyToCents(item.unitAmount) };
}

function calculateDailyWage(input = {}) {
  const approvedMinutes = Number(input.approvedMinutes);
  const shiftType = String(input.shiftType || '');
  const settlementMode = String(input.settlementMode || '');
  const attendanceStatus = String(input.attendanceStatus || '');
  if (!Number.isInteger(approvedMinutes) || approvedMinutes < 0
    || !VALID_SHIFTS.has(shiftType) || !VALID_SETTLEMENT_MODES.has(settlementMode)) {
    invalidInput();
  }
  const hourlyRateCents = parseMoneyToCents(input.hourlyRate);
  const dailyPaidCents = parseMoneyToCents(input.dailyPaidAmount ?? '0.00');
  const allowances = Array.isArray(input.allowances) ? input.allowances.map(validateAllowance) : invalidInput('补贴列表无效');
  if (attendanceStatus === 'ABSENT') return emptyResult('ZERO');
  if (BLOCKED_ATTENDANCE.has(attendanceStatus)) return emptyResult('BLOCKED', BLOCKED_ATTENDANCE.get(attendanceStatus));
  if (!['NORMAL', 'LATE', 'EARLY_LEAVE'].includes(attendanceStatus)) invalidInput('考勤状态无效');

  const payableMinutes = roundPayableMinutes(approvedMinutes);
  const baseCents = Math.round(hourlyRateCents * payableMinutes / 60);
  const allowanceItems = allowances
    .filter(item => item.shiftScope === 'ALL' || item.shiftScope === shiftType)
    .filter(() => payableMinutes > 0)
    .map(item => ({
      allowanceName: item.allowanceName,
      amountCents: item.calculationType === 'PER_SHIFT'
        ? item.unitAmountCents
        : Math.round(item.unitAmountCents * payableMinutes / 60)
    }));
  const allowanceCents = allowanceItems.reduce((total, item) => total + item.amountCents, 0);
  const earnedCents = baseCents + allowanceCents;
  if (settlementMode !== 'DAILY_PAID' && dailyPaidCents !== 0) invalidInput('非日结员工不能填写已日结金额');
  if (settlementMode === 'DAILY_PAID' && dailyPaidCents !== 0 && dailyPaidCents !== earnedCents) {
    return { ...emptyResult('BLOCKED', '已日结金额与当前应得工资不一致'), dailyPaidAmount: formatCents(dailyPaidCents) };
  }
  const payableCents = settlementMode === 'DAILY_PAID' ? earnedCents - dailyPaidCents : earnedCents;
  return {
    payableMinutes,
    payableHours: (payableMinutes / 60).toFixed(2),
    baseAmount: formatCents(baseCents),
    allowanceAmount: formatCents(allowanceCents),
    earnedAmount: formatCents(earnedCents),
    dailyPaidAmount: formatCents(dailyPaidCents),
    payableAmount: formatCents(payableCents),
    allowanceItems: allowanceItems.map(item => ({ allowanceName: item.allowanceName, amount: formatCents(item.amountCents) })),
    calculationStatus: payableMinutes === 0 ? 'ZERO' : 'READY',
    blockedReason: null
  };
}

module.exports = { parseMoneyToCents, formatCents, roundPayableMinutes, calculateDailyWage };
