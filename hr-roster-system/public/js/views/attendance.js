function attendanceMinutes(value) {
  const minutes = Number(value || 0);
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}

function attendanceDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()); }

async function loadAttendance() {
  const date = attendanceDate();
  const monthInput = $('#attendanceMonth');
  if (monthInput && !monthInput.value) monthInput.value = date.slice(0, 7);
  await loadAttendanceDaily(date);
  await loadAttendanceMonthly(monthInput?.value || date.slice(0, 7));
  $('#attendanceDailyRefresh')?.addEventListener('click', () => loadAttendanceDaily(date).catch(error => toast(error.message, 'error')), { once: true });
  monthInput?.addEventListener('change', event => loadAttendanceMonthly(event.target.value).catch(error => toast(error.message, 'error')), { once: true });
}

async function loadAttendanceDaily(date) {
  const data = await api(`/api/attendance/daily?date=${encodeURIComponent(date)}`);
  const rows = data.list || [];
  $('#attendanceDailySummary').textContent = `共 ${rows.length} 人`;
  $('#attendanceDailyBody').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.name || '-')}</td><td>${escapeHtml(row.firstInAt || '-')}</td><td>${escapeHtml(row.lastOutAt || '-')}</td><td>${attendanceMinutes(row.workedMinutes)}</td><td>${attendanceMinutes(row.approvedNormalMinutes)}</td><td>${attendanceMinutes(row.overtimeCandidateMinutes)}</td><td>${escapeHtml(row.resultStatus || '-')}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">暂无考勤结果</td></tr>';
}

async function loadAttendanceMonthly(month) {
  if (!month) return;
  const data = await api(`/api/attendance/monthly?month=${encodeURIComponent(month)}`);
  const rows = data.list || [];
  $('#attendanceMonthlyBody').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.name || '-')}</td><td>${attendanceMinutes(row.approvedNormalMinutes)}</td><td>${attendanceMinutes(row.approvedOvertimeMinutes)}</td><td>${row.lateMinutes || 0}</td><td>${row.earlyLeaveMinutes || 0}</td><td>${row.missingPunchDays || 0}</td><td>${row.absentDays || 0}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">暂无月度数据</td></tr>';
}
