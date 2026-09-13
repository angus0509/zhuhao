(function exposeEmployeeBindCode(globalScope) {
  function canGenerateEmployeeBindCode(permissions, employeeStatus) {
    return Array.isArray(permissions)
      && permissions.includes('employee:update')
      && [2, 3].includes(Number(employeeStatus));
  }

  async function createEmployeeBindCode({ employeeId, employeeName, request }) {
    const id = Number(employeeId);
    if (!Number.isInteger(id) || id <= 0 || typeof request !== 'function') {
      throw new Error('员工信息无效，无法生成绑定码');
    }

    const data = await request(`/api/employees/${id}/bind-code`, { method: 'POST' });
    const bindCode = String(data?.bindCode || '').trim();
    if (!/^\d{6}$/.test(bindCode) || !data?.expireAt) {
      throw new Error('绑定码生成失败，请稍后重试');
    }

    return {
      employeeId: id,
      employeeName: String(employeeName || '当前员工'),
      bindCode,
      expireAt: String(data.expireAt)
    };
  }

  const api = { canGenerateEmployeeBindCode, createEmployeeBindCode };
  globalScope.EmployeeBindCode = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
