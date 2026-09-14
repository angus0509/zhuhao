const MINUTE = 60 * 1000;

function atDate(shiftDate, time, dayOffset = 0) {
  const [hours, minutes, seconds = '00'] = String(time).split(':');
  const value = new Date(`${shiftDate}T00:00:00+08:00`);
  value.setDate(value.getDate() + dayOffset);
  value.setHours(Number(hours), Number(minutes), Number(seconds), 0);
  return value;
}

function iso(value) { return value ? value.toISOString().replace('.000Z', '+00:00') : null; }

function calculateDailyAttendance({ schedule, punches = [] }) {
  if (!schedule || schedule.scheduleStatus === 'REST') {
    return { firstInAt: null, lastOutAt: null, workedMinutes: 0, approvedNormalMinutes: 0, overtimeCandidateMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, resultStatus: 'REST' };
  }
  const start = atDate(schedule.shiftDate, schedule.workStartTime);
  const overnight = schedule.workEndTime <= schedule.workStartTime;
  const end = atDate(schedule.shiftDate, schedule.workEndTime, overnight ? 1 : 0);
  const restStart = schedule.restStartTime ? atDate(schedule.shiftDate, schedule.restStartTime, schedule.restStartTime <= schedule.workStartTime ? 1 : 0) : null;
  const restEnd = schedule.restEndTime ? atDate(schedule.shiftDate, schedule.restEndTime, schedule.restEndTime <= schedule.workStartTime ? 1 : 0) : null;
  const valid = punches.map(item => ({ ...item, date: new Date(item.punchTime) })).filter(item => !Number.isNaN(item.date.getTime()));
  const ins = valid.filter(item => item.punchType === 'IN' && item.date >= new Date(start.getTime() - 4 * 60 * MINUTE) && item.date <= new Date(end.getTime() + 6 * 60 * MINUTE)).sort((a, b) => a.date - b.date);
  const outs = valid.filter(item => item.punchType === 'OUT' && item.date >= start && item.date <= new Date(end.getTime() + 6 * 60 * MINUTE)).sort((a, b) => a.date - b.date);
  const first = ins[0] && ins[0].date;
  const last = outs.length ? outs[outs.length - 1].date : null;
  const firstValue = ins[0] && ins[0].punchTime;
  const lastValue = outs.length ? outs[outs.length - 1].punchTime : null;
  if (!first && !last) return { firstInAt: null, lastOutAt: null, workedMinutes: 0, approvedNormalMinutes: 0, overtimeCandidateMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, resultStatus: 'ABSENT' };
  if (!first || !last || last <= first) return { firstInAt: firstValue || null, lastOutAt: lastValue, workedMinutes: 0, approvedNormalMinutes: 0, overtimeCandidateMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, resultStatus: 'MISSING_PUNCH' };
  const span = Math.max(0, Math.floor((last - first) / MINUTE));
  const restOverlap = restStart && restEnd ? Math.max(0, Math.floor((Math.min(last, restEnd) - Math.max(first, restStart)) / MINUTE)) : 0;
  const worked = Math.max(0, span - restOverlap);
  const late = Math.max(0, Math.floor((first - start) / MINUTE) - Number(schedule.lateGraceMinutes || 0));
  const early = Math.max(0, Math.floor((end - last) / MINUTE) - Number(schedule.earlyGraceMinutes || 0));
  const overtime = worked > Number(schedule.standardMinutes) && worked - Number(schedule.standardMinutes) >= Number(schedule.overtimeMinMinutes || 0) ? worked - Number(schedule.standardMinutes) : 0;
  return { firstInAt: firstValue, lastOutAt: lastValue, workedMinutes: worked, approvedNormalMinutes: Math.min(worked, Number(schedule.standardMinutes)), overtimeCandidateMinutes: overtime, lateMinutes: late, earlyLeaveMinutes: early, resultStatus: late ? 'LATE' : early ? 'EARLY_LEAVE' : 'NORMAL' };
}

module.exports = { calculateDailyAttendance };
