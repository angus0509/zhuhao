(function exposeRiskWorkbench(globalScope) {
  function buildRiskWorkbench(rows = [], filters = {}) {
    const status = filters.status || 'open';
    const keyword = String(filters.keyword || '').trim().toLowerCase();
    const projectId = Number(filters.projectId || 0);
    const openRows = rows.filter(row => [0, 1].includes(Number(row.handleStatus)));
    const handledRows = rows.filter(row => [2, 3].includes(Number(row.handleStatus)));
    const filtered = rows.filter(row => {
      if (status === 'open' && ![0, 1].includes(Number(row.handleStatus))) return false;
      if (status === 'handled' && ![2, 3].includes(Number(row.handleStatus))) return false;
      if (projectId && Number(row.projectId) !== projectId) return false;
      if (!keyword) return true;
      return [row.employeeName, row.customerName, row.projectName, row.riskTitle, row.riskDesc]
        .some(value => String(value || '').toLowerCase().includes(keyword));
    });
    return {
      filtered,
      summary: {
        total: rows.length,
        open: openRows.length,
        high: openRows.filter(row => Number(row.riskLevel) === 3).length,
        handled: handledRows.length
      }
    };
  }

  const api = { buildRiskWorkbench };
  Object.assign(globalScope, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
