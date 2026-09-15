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
  if ($('#attendanceGeofenceBody')) await loadAttendanceGeofences();
  $('#attendanceDailyRefresh')?.addEventListener('click', () => loadAttendanceDaily(date).catch(error => toast(error.message, 'error')), { once: true });
  monthInput?.addEventListener('change', event => loadAttendanceMonthly(event.target.value).catch(error => toast(error.message, 'error')), { once: true });
  $('#attendanceGeofenceForm')?.addEventListener('submit', saveAttendanceGeofence, { once: true });
  $('#attendanceGeofenceBody')?.addEventListener('click', disableAttendanceGeofence, { once: true });
}

async function loadAttendanceGeofences() {
  const data = await api('/api/attendance/geofences');
  const rows = data.list || [];
  $('#attendanceGeofenceBody').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.projectName || String(row.projectId))}</td><td>${escapeHtml(row.fenceName)}</td><td>${row.latitude}, ${row.longitude}</td><td>${row.radiusMeters} 米</td><td>${row.maxAccuracyMeters} 米</td><td>${Number(row.status) === 1 ? '启用' : '停用'}</td><td>${Number(row.status) === 1 ? `<button class="text-button" type="button" data-disable-geofence="${row.id}">停用</button>` : '-'}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">暂无电子围栏</td></tr>';
}

async function saveAttendanceGeofence(event) {
  event.preventDefault();
  const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
  await api('/api/attendance/geofences', { method: 'POST', body: { ...values, projectId: Number(values.projectId), latitude: Number(values.latitude), longitude: Number(values.longitude), radiusMeters: Number(values.radiusMeters), maxAccuracyMeters: Number(values.maxAccuracyMeters) } });
  toast('电子围栏已保存'); form.reset(); await loadAttendanceGeofences();
}

async function disableAttendanceGeofence(event) {
  const button = event.target.closest('[data-disable-geofence]'); if (!button) return;
  await api(`/api/attendance/geofences/${button.dataset.disableGeofence}`, { method: 'PUT', body: { status: 0 } });
  toast('电子围栏已停用'); await loadAttendanceGeofences();
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
