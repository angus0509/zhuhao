/*
 * 驻厂管理完整生命周期 UAT。
 * 仅允许在测试库执行，会创建员工、招聘人和测试项目等业务数据。
 * 必填环境变量：UAT_BASE_URL、UAT_USERNAME、UAT_PASSWORD。
 */
const baseUrl = String(process.env.UAT_BASE_URL || '').replace(/\/$/, '');
const username = process.env.UAT_USERNAME || '';
const password = process.env.UAT_PASSWORD || '';

if (!baseUrl || !username || !password) {
  console.error('缺少 UAT_BASE_URL、UAT_USERNAME 或 UAT_PASSWORD；禁止在未知环境执行 UAT。');
  process.exit(1);
}
if (!/test|uat|staging|127\.0\.0\.1|localhost/i.test(baseUrl) && process.env.UAT_ALLOW_REMOTE !== 'I_UNDERSTAND_THIS_CREATES_TEST_DATA') {
  console.error('目标地址不像测试环境。如确为隔离测试环境，请设置 UAT_ALLOW_REMOTE=I_UNDERSTAND_THIS_CREATES_TEST_DATA。');
  process.exit(1);
}

let token = '';
const today = new Date().toISOString().slice(0, 10);
const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
const runId = Date.now();

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(`${options.method || 'GET'} ${path} 失败：HTTP ${response.status} / ${payload.message || '未知错误'}`);
  }
  return payload.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(`UAT断言失败：${message}`);
}

async function ensureRecruiter() {
  const list = await api('/recruiters');
  if (list.length) return list[0];
  const created = await api('/recruiters', {
    method: 'POST',
    body: { recruiterNo: `UATZP${runId}`, recruiterName: `UAT招聘人${String(runId).slice(-6)}`, phone: '13900000001' }
  });
  return { id: created.recruiterId };
}

async function ensureTwoProjects(customerId) {
  let bootstrap = await api('/bootstrap');
  let projects = (bootstrap.projects || []).filter(item => Number(item.customerId) === Number(customerId));
  while (projects.length < 2) {
    await api('/projects', {
      method: 'POST',
      body: {
        customerId,
        projectCode: `UATXM${runId}${projects.length}`,
        projectName: `UAT驻厂项目${String(runId).slice(-6)}-${projects.length + 1}`,
        serviceType: 2,
        factoryName: 'UAT测试工厂',
        startDate: today,
        status: 2
      }
    });
    bootstrap = await api('/bootstrap');
    projects = (bootstrap.projects || []).filter(item => Number(item.customerId) === Number(customerId));
  }
  return projects.slice(0, 2);
}

async function main() {
  console.log('[1/9] 登录测试环境');
  const login = await api('/auth/login', { method: 'POST', body: { username, password } });
  token = login.token;
  assert(token, '登录未返回 Token');

  console.log('[2/9] 准备客户、项目、岗位和招聘来源');
  const bootstrap = await api('/bootstrap');
  const customer = bootstrap.customers?.[0];
  const position = bootstrap.positions?.[0];
  const department = bootstrap.departments?.[0];
  assert(customer && position && department, '测试库必须至少存在一个客户、岗位和部门');
  const recruiter = await ensureRecruiter();
  const [sourceProject, targetProject] = await ensureTwoProjects(customer.id);

  const suffix = String(runId).slice(-11).padStart(11, '0');
  const employeePayload = {
    name: `UAT员工${String(runId).slice(-6)}`,
    gender: 1,
    phone: `19${String(runId).slice(-9)}`,
    idCardNo: `320101${suffix}X`,
    customerId: customer.id,
    projectId: sourceProject.id,
    deptId: department.id,
    positionId: position.id,
    employmentType: 5,
    feeMode: 'UAT测试费用模式',
    workType: 1,
    hireDate: today,
    employeeStatus: 1,
    recruitmentSourceType: 1,
    recruiterId: recruiter.id,
    supplierId: null,
    remark: `驻厂生命周期UAT ${runId}`
  };

  console.log('[3/9] 员工预检查并录入待到岗员工');
  const precheck = await api('/employees/precheck', { method: 'POST', body: employeePayload });
  assert(precheck.allowOnboarding, '预检查应当通过');
  const created = await api('/employees', { method: 'POST', body: employeePayload });
  const employeeId = created.employeeId;
  assert(employeeId, '新增员工未返回 employeeId');

  console.log('[4/9] 确认到岗并锁定招聘来源');
  await api(`/employees/${employeeId}/onboard`, { method: 'POST', body: { hireDate: today, remark: 'UAT确认到岗' } });
  let detail = await api(`/employees/${employeeId}`);
  assert(detail.basicInfo.arrivalStatus === 'CONFIRMED', '到岗状态不是 CONFIRMED');
  assert(detail.basicInfo.sourceLocked === true, '招聘来源未锁定');

  console.log('[5/9] 完成合同签署和社保、雇主险投保');
  await api(`/employees/${employeeId}/contracts`, {
    method: 'POST',
    body: {
      contractNo: `UATHT${runId}`,
      contractType: 1,
      signStatus: 1,
      signDate: today,
      startDate: today,
      endDate: nextYear
    }
  });
  await api(`/employees/${employeeId}/social-security`, {
    method: 'PUT',
    body: {
      socialStatus: 1,
      socialCity: 'UAT测试城市',
      socialBase: 5000,
      fundStatus: 0,
      fundBase: 0,
      startMonth: today.slice(0, 7),
      employerInsuranceStatus: 1,
      employerInsurer: 'UAT测试保险公司',
      employerPolicyNo: `UATPOLICY${runId}`,
      employerStartDate: today,
      employerEndDate: nextYear,
      employerInsuredAmount: 1000000
    }
  });
  detail = await api(`/employees/${employeeId}`);
  assert(detail.basicInfo.lifecycleStatus === 'ACTIVE', '合同和保险完成后未进入 ACTIVE');

  console.log('[6/9] 发起跨项目转岗并由目标项目接收');
  const transfer = await api(`/employees/${employeeId}/job-transfer`, {
    method: 'POST',
    body: {
      newCustomerId: customer.id,
      newProjectId: targetProject.id,
      newPositionId: position.id,
      effectiveDate: today,
      remark: 'UAT跨项目转岗'
    }
  });
  assert(transfer.changeId && transfer.changeStatus === 'PENDING_ACCEPTANCE', '跨项目转岗未进入待接收');
  await api(`/employee-transfers/${transfer.changeId}/handle`, { method: 'PUT', body: { approved: 1 } });
  detail = await api(`/employees/${employeeId}`);
  assert(Number(detail.basicInfo.projectId) === Number(targetProject.id), '转岗后目标项目未生效');

  console.log('[7/9] 单页办理离职、现场交接和雇主险减保');
  const resignation = await api(`/employees/${employeeId}/resign`, {
    method: 'POST',
    body: {
      leaveDate: today,
      leaveType: 1,
      leaveReason: 'UAT流程验证',
      badgeReturned: 1,
      toolsReturned: 1,
      dormCleared: 1,
      attendanceConfirmed: 1,
      terminateEmployerInsurance: 1
    }
  });
  assert(resignation.resignationId && resignation.handoverDone && resignation.insuranceDone && resignation.completed, '离职未一次办结');

  console.log('[8/9] 核对雇主险已同步减保');
  detail = await api(`/employees/${employeeId}`);
  assert(Number(detail.socialSecurity?.employerInsuranceStatus) === 2, '离职未同步登记雇主险减保');

  console.log('[9/9] 核对正式离职、任职关闭和待办闭环');
  detail = await api(`/employees/${employeeId}`);
  assert(Number(detail.basicInfo.employeeStatus) === 3, '员工状态未变为已离职');
  assert(detail.basicInfo.lifecycleStatus === 'LEFT', '生命周期未变为 LEFT');
  assert(detail.resignation?.completedAt, '离职记录缺少闭环时间');
  const openTasks = await api('/work-tasks?taskStatus=0');
  assert(!openTasks.some(item => Number(item.employeeId) === Number(employeeId)), 'UAT员工仍存在未完成待办');

  console.log(JSON.stringify({
    result: 'PASS', employeeId, resignationId: resignation.resignationId,
    sourceProjectId: sourceProject.id, targetProjectId: targetProject.id
  }, null, 2));
}

main().catch(error => {
  console.error(`UAT失败：${error.message}`);
  process.exit(1);
});
