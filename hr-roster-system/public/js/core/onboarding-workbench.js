(function exposeOnboardingWorkbench(globalScope) {
  const presentations = {
    interview: {
      mode: 'interview',
      requiredFields: ['name'],
      primaryAction: '保存面试人员',
      flowTitle: '保存后进入面试名单',
      flowDescription: '到岗意向明确后，再补齐客户、岗位和身份证等资料。',
      showPlacement: false
    },
    direct: {
      mode: 'direct',
      requiredFields: ['name', 'idCardNo', 'customerId', 'positionId'],
      primaryAction: '保存并进入待到岗',
      flowTitle: '保存后进入待到岗',
      flowDescription: '驻厂专员确认到岗后，员工才会进入在职花名册。',
      showPlacement: true
    }
  };

  function getEmployeeEntryPresentation(employeeStatus) {
    return Number(employeeStatus) === 6 ? presentations.interview : presentations.direct;
  }

  function calculateEmployeeEntryCompletion(values = {}, presentation = presentations.interview) {
    const requiredFields = presentation.requiredFields || [];
    if (!requiredFields.length) return 100;
    const completed = requiredFields.filter(field => String(values[field] ?? '').trim()).length;
    return Math.round(completed / requiredFields.length * 100);
  }

  const api = { getEmployeeEntryPresentation, calculateEmployeeEntryCompletion };
  Object.assign(globalScope, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
