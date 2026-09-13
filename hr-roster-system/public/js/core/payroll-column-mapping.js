(function initPayrollColumnMapping(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PayrollColumnMapping = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function payrollColumnMappingFactory() {
  const IDENTITY_TARGETS = new Set(['employeeName', 'employeeNo', 'idCardNo', 'phone']);
  const INCOME_TARGETS = new Set([
    'baseSalary', 'positionSalary', 'performanceSalary', 'allowanceAmount',
    'pieceAmount', 'overtime15Amount', 'overtime20Amount', 'overtime30Amount'
  ]);
  const DEDUCTION_TARGETS = new Set(['socialDeduction', 'taxDeduction', 'advanceDeduction', 'otherDeduction']);

  function cloneMapping(mapping) {
    return (mapping || []).map(item => ({
      columnIndex: Number(item.columnIndex),
      sourceHeader: String(item.sourceHeader || ''),
      target: String(item.target || 'ignore'),
      category: String(item.category || ''),
      includeInPayslip: item.includeInPayslip === true
    }));
  }

  function normalizeKey(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/[（(]\s*(?:元|人民币|rmb)\s*[)）]/gi, '')
      .replace(/[\s　·•,，。:：;；_\-—/\\()（）【】\[\]<>《》.]/g, '');
  }

  function applyTemplateMapping(template, currentHeaders, suggestedMapping) {
    const byHeader = new Map();
    (template && template.mapping || []).forEach(item => {
      byHeader.set(normalizeKey(item.sourceHeader), item);
    });
    return (currentHeaders || []).map((header, index) => {
      const sourceHeader = String(header == null ? '' : header).trim();
      const hit = byHeader.get(normalizeKey(header));
      if (hit) {
        return {
          columnIndex: index,
          sourceHeader,
          target: String(hit.target || 'ignore'),
          category: String(hit.category || ''),
          includeInPayslip: hit.includeInPayslip === true
        };
      }
      const fallback = (suggestedMapping || [])[index];
      if (fallback) return cloneMapping([fallback])[0];
      return { columnIndex: index, sourceHeader, target: 'ignore', category: '', includeInPayslip: false };
    });
  }

  function selectReusableMapping({ headers, headerSignature, profile, suggestedMapping }) {
    const columnCount = Array.isArray(headers) ? headers.length : 0;
    const reusable = profile
      && profile.headerSignature === headerSignature
      && Array.isArray(profile.sourceHeaders)
      && profile.sourceHeaders.length === columnCount
      && Array.isArray(profile.mapping)
      && profile.mapping.length === columnCount;
    return cloneMapping(reusable ? profile.mapping : suggestedMapping);
  }

  function mappingRequiresReview(mapping) {
    if (!Array.isArray(mapping) || !mapping.length) return true;
    const identityCount = mapping.filter(item => IDENTITY_TARGETS.has(item.target)).length;
    const netCount = mapping.filter(item => item.target === 'netAmount').length;
    const criticalTargets = ['employeeName', 'employeeNo', 'idCardNo', 'phone', 'grossAmount', 'netAmount'];
    const ambiguous = criticalTargets.some(target => mapping.filter(item => item.target === target).length > 1);
    return identityCount === 0 || netCount !== 1 || ambiguous;
  }

  function applyMappingChoice(item, choice) {
    const current = { columnIndex: Number(item.columnIndex), sourceHeader: String(item.sourceHeader || '') };
    if (String(choice).startsWith('custom:')) {
      return { ...current, target: 'custom', category: String(choice).split(':')[1], includeInPayslip: true };
    }
    const target = String(choice || 'ignore');
    if (IDENTITY_TARGETS.has(target) || target === 'ignore') {
      return { ...current, target, category: '', includeInPayslip: false };
    }
    if (INCOME_TARGETS.has(target)) return { ...current, target, category: 'income', includeInPayslip: true };
    if (DEDUCTION_TARGETS.has(target)) return { ...current, target, category: 'deduction', includeInPayslip: true };
    if (target === 'grossAmount' || target === 'netAmount') {
      return { ...current, target, category: 'summary', includeInPayslip: true };
    }
    return { ...current, target: 'ignore', category: '', includeInPayslip: false };
  }

  function choiceForMapping(item) {
    if (item?.target === 'custom') return `custom:${item.category || 'display'}`;
    return String(item?.target || 'ignore');
  }

  function shouldKeepPanelOpen(isOpen, requiresReview) {
    return Boolean(isOpen || requiresReview);
  }

  return { selectReusableMapping, mappingRequiresReview, applyMappingChoice, choiceForMapping, shouldKeepPanelOpen, applyTemplateMapping };
}));
