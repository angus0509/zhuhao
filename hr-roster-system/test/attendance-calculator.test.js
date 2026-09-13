const assert = require('node:assert/strict');
const { calculateDailyAttendance } = require('../src/services/attendance-calculator.service');

const schedule = {
  shiftDate: '2026-09-09',
  workStartTime: '09:00:00',
  workEndTime: '18:00:00',
  restStartTime: '12:00:00',
  restEndTime: '13:00:00',
  standardMinutes: 480,
  lateGraceMinutes: 5,
  earlyGraceMinutes: 5,
  overtimeMinMinutes: 30,
  scheduleStatus: 'WORK'
};

function punch(punchType, punchTime) { return { punchType, punchTime }; }

assert.deepEqual(
  calculateDailyAttendance({ schedule, punches: [punch('IN', '2026-09-09T08:55:00+08:00'), punch('OUT', '2026-09-09T18:30:00+08:00')] }),
  {
    firstInAt: '2026-09-09T08:55:00+08:00', lastOutAt: '2026-09-09T18:30:00+08:00',
    workedMinutes: 515, approvedNormalMinutes: 480, overtimeCandidateMinutes: 35,
    lateMinutes: 0, earlyLeaveMinutes: 0, resultStatus: 'NORMAL'
  }
);

const lateEarly = calculateDailyAttendance({ schedule, punches: [punch('IN', '2026-09-09T09:12:00+08:00'), punch('OUT', '2026-09-09T17:50:00+08:00')] });
assert.equal(lateEarly.lateMinutes, 7);
assert.equal(lateEarly.earlyLeaveMinutes, 5);
assert.equal(lateEarly.resultStatus, 'LATE');

assert.equal(calculateDailyAttendance({ schedule, punches: [punch('IN', '2026-09-09T09:00:00+08:00')] }).resultStatus, 'MISSING_PUNCH');
assert.equal(calculateDailyAttendance({ schedule, punches: [] }).resultStatus, 'ABSENT');
assert.equal(calculateDailyAttendance({ ...{}, schedule: { ...schedule, scheduleStatus: 'REST' }, punches: [] }).resultStatus, 'REST');

const overnight = calculateDailyAttendance({
  schedule: { ...schedule, shiftDate: '2026-09-09', workStartTime: '20:00:00', workEndTime: '08:00:00', restStartTime: '00:00:00', restEndTime: '01:00:00', standardMinutes: 660 },
  punches: [punch('IN', '2026-09-09T19:55:00+08:00'), punch('OUT', '2026-09-10T08:10:00+08:00')]
});
assert.equal(overnight.workedMinutes, 675);
assert.equal(overnight.firstInAt, '2026-09-09T19:55:00+08:00');

console.log('attendance-calculator.test.js: all assertions passed');
