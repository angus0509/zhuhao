const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3100);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const buildInternalEmployeeNo = () => `YY${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const dictionaries = {
  employeeStatus: { 1: '待入职', 2: '在职', 3: '离职', 4: '黑名单' },
  employmentType: { 1: '全职', 2: '兼职', 3: '劳务', 4: '实习', 5: '外包', 6: '派遣' },
  workType: { 1: '计时', 2: '计件', 3: '混合' },
  gender: { 0: '未知', 1: '男', 2: '女' },
  socialStatus: { 0: '未参保', 1: '已参保', 2: '停保' },
  signStatus: { 0: '未签', 1: '已签', 2: '作废' },
  riskLevel: { 1: '低', 2: '中', 3: '高' },
  handleStatus: { 0: '未处理', 1: '处理中', 2: '已处理', 3: '忽略' },
  riskCaseStatus: { 0: '待整改', 1: '整改中', 2: '待复核', 3: '已关闭' },
  certType: { 1: '身份证', 2: '健康证', 3: '上岗证', 4: '特种作业证', 5: '学历证' }
};

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) return;

  const seed = {
    nextIds: {
      company: 2,
      department: 5,
      position: 6,
      employee: 5,
      job: 5,
      contract: 4,
      social: 4,
      certificate: 4,
      resignation: 1,
      risk: 1,
      log: 1
    },
    company: {
      id: 1,
      companyName: '示例制造企业',
      contactName: '企业管理员',
      contactPhone: '13800000000',
      status: 1
    },
    departments: [
      { id: 1, companyId: 1, parentId: 0, deptName: '总经办', deptCode: 'CEO', status: 1 },
      { id: 2, companyId: 1, parentId: 0, deptName: '人力资源部', deptCode: 'HR', status: 1 },
      { id: 3, companyId: 1, parentId: 0, deptName: '生产一部', deptCode: 'MFG-1', status: 1 },
      { id: 4, companyId: 1, parentId: 0, deptName: '品质管理部', deptCode: 'QA', status: 1 }
    ],
    positions: [
      { id: 1, companyId: 1, positionName: 'HR专员', positionCode: 'HR-S', riskLevel: 1, isSpecialWork: 0, status: 1 },
      { id: 2, companyId: 1, positionName: '普工', positionCode: 'OP', riskLevel: 1, isSpecialWork: 0, status: 1 },
      { id: 3, companyId: 1, positionName: '焊接工', positionCode: 'WELD', riskLevel: 3, isSpecialWork: 1, status: 1 },
      { id: 4, companyId: 1, positionName: '质检员', positionCode: 'QC', riskLevel: 2, isSpecialWork: 0, status: 1 },
      { id: 5, companyId: 1, positionName: '生产班长', positionCode: 'LEAD', riskLevel: 2, isSpecialWork: 0, status: 1 }
    ],
    employees: [
      {
        id: 1,
        companyId: 1,
        employeeNo: 'YG202607001',
        name: '张三',
        gender: 1,
        idCardNo: '330100199001010000',
        phone: '13800000000',
        education: '高中/中专',
        bankName: '中国工商银行',
        bankCardNo: '6222000000000000000',
        emergencyContact: '李四',
        emergencyPhone: '13900000000',
        employeeStatus: 2,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      },
      {
        id: 2,
        companyId: 1,
        employeeNo: 'YG202607002',
        name: '王芳',
        gender: 2,
        idCardNo: '330100199202020000',
        phone: '13700000000',
        education: '大专',
        bankName: '中国建设银行',
        bankCardNo: '6217000000000000000',
        emergencyContact: '王强',
        emergencyPhone: '13600000000',
        employeeStatus: 2,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      },
      {
        id: 3,
        companyId: 1,
        employeeNo: 'YG202607003',
        name: '陈强',
        gender: 1,
        idCardNo: '330100198803030000',
        phone: '13500000000',
        education: '初中及以下',
        bankName: '中国农业银行',
        bankCardNo: '6228480000000000000',
        emergencyContact: '陈丽',
        emergencyPhone: '13400000000',
        employeeStatus: 2,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      },
      {
        id: 4,
        companyId: 1,
        employeeNo: 'YG202607004',
        name: '刘敏',
        gender: 2,
        idCardNo: '330100199505050000',
        phone: '13300000000',
        education: '本科',
        bankName: '',
        bankCardNo: '',
        emergencyContact: '',
        emergencyPhone: '',
        employeeStatus: 1,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      }
    ],
    jobs: [
      { id: 1, companyId: 1, employeeId: 1, deptId: 3, positionId: 2, employmentType: 1, workType: 1, hireDate: '2026-06-01', regularDate: '', directLeaderId: 0, jobStatus: 1, remark: '' },
      { id: 2, companyId: 1, employeeId: 2, deptId: 4, positionId: 4, employmentType: 1, workType: 1, hireDate: '2026-04-15', regularDate: '2026-07-15', directLeaderId: 0, jobStatus: 1, remark: '' },
      { id: 3, companyId: 1, employeeId: 3, deptId: 3, positionId: 3, employmentType: 1, workType: 3, hireDate: '2026-05-20', regularDate: '', directLeaderId: 0, jobStatus: 1, remark: '' },
      { id: 4, companyId: 1, employeeId: 4, deptId: 2, positionId: 1, employmentType: 4, workType: 1, hireDate: '2026-07-10', regularDate: '', directLeaderId: 0, jobStatus: 1, remark: '' }
    ],
    contracts: [
      { id: 1, companyId: 1, employeeId: 1, contractNo: 'HT202607001', contractType: 1, signStatus: 1, signDate: '2026-06-01', startDate: '2026-06-01', endDate: '2027-05-31', renewalCount: 0 },
      { id: 2, companyId: 1, employeeId: 2, contractNo: 'HT202607002', contractType: 1, signStatus: 1, signDate: '2026-04-15', startDate: '2026-04-15', endDate: '2026-07-25', renewalCount: 0 },
      { id: 3, companyId: 1, employeeId: 3, contractNo: 'HT202607003', contractType: 1, signStatus: 0, signDate: '', startDate: '2026-05-20', endDate: '2027-05-19', renewalCount: 0 }
    ],
    socials: [
      { id: 1, companyId: 1, employeeId: 1, socialStatus: 1, socialCity: '杭州', socialBase: 5200, fundStatus: 1, fundBase: 5200, startMonth: '2026-06', stopMonth: '' },
      { id: 2, companyId: 1, employeeId: 2, socialStatus: 1, socialCity: '杭州', socialBase: 6200, fundStatus: 1, fundBase: 6200, startMonth: '2026-04', stopMonth: '' },
      { id: 3, companyId: 1, employeeId: 3, socialStatus: 0, socialCity: '', socialBase: 0, fundStatus: 0, fundBase: 0, startMonth: '', stopMonth: '' }
    ],
    certificates: [
      { id: 1, companyId: 1, employeeId: 1, certType: 1, certNo: '330100199001010000', issueDate: '2010-01-01', expireDate: '2030-01-01', verifyStatus: 1 },
      { id: 2, companyId: 1, employeeId: 2, certType: 2, certNo: 'JK20260415', issueDate: '2026-04-15', expireDate: '2026-07-22', verifyStatus: 1 },
      { id: 3, companyId: 1, employeeId: 3, certType: 1, certNo: '330100198803030000', issueDate: '2010-01-01', expireDate: '2030-01-01', verifyStatus: 1 }
    ],
    resignations: [],
    risks: [],
    logs: []
  };

  fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
}

function readDb() {
  ensureData();
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.riskCases = Array.isArray(db.riskCases) ? db.riskCases : [];
  db.logs = Array.isArray(db.logs) ? db.logs : [];
  db.clients = Array.isArray(db.clients) ? db.clients : [
    { id: 1, clientName: '华东精密制造有限公司', contactName: '周经理', contactPhone: '13810001001', settlementCycle: '月结30天', status: 1 },
    { id: 2, clientName: '联创智能装备有限公司', contactName: '吴主管', contactPhone: '13810001002', settlementCycle: '月结45天', status: 1 }
  ];
  db.projects = Array.isArray(db.projects) ? db.projects : [
    { id: 1, clientId: 1, projectCode: 'XM-2026-001', projectName: '华东精密一厂驻场项目', worksiteName: '滨江一厂', serviceType: '岗位外包', managerName: '林少芬', activeCount: 3, status: 1 },
    { id: 2, clientId: 2, projectCode: 'XM-2026-002', projectName: '联创装备招聘交付项目', worksiteName: '临平厂区', serviceType: 'RPO招聘', managerName: '李海', activeCount: 1, status: 1 }
  ];
  db.talents = Array.isArray(db.talents) ? db.talents : [
    { id: 1, name: '赵凯', phone: '13610002001', source: '员工转介绍', intentionJob: '普工', tags: ['可夜班', '已面试'], followStatus: '待入职', ownerName: '林少芬', lastFollowAt: now() },
    { id: 2, name: '孙丽', phone: '13610002002', source: '招聘平台', intentionJob: '质检员', tags: ['有经验'], followStatus: '跟进中', ownerName: '李海', lastFollowAt: now() }
  ];
  db.advances = Array.isArray(db.advances) ? db.advances : [
    { id: 1, advanceNo: 'YZ202607300001', employeeId: 1, projectId: 1, applyAmount: 500, approvedAmount: 500, paidAmount: 500, repaidAmount: 0, purpose: '生活周转', status: 'PAID', appliedAt: now(), paidAt: now() },
    { id: 2, advanceNo: 'YZ202607300002', employeeId: 2, projectId: 1, applyAmount: 800, approvedAmount: 0, paidAmount: 0, repaidAmount: 0, purpose: '家庭急用', status: 'PENDING_APPROVAL', appliedAt: now(), paidAt: '' }
  ];
  db.payrollBatches = Array.isArray(db.payrollBatches) ? db.payrollBatches : [
    { id: 1, batchNo: 'GZ202606001', salaryMonth: '2026-06', projectId: 1, employeeCount: 3, grossTotal: 18420, advanceDeduction: 500, netTotal: 17920, signedCount: 2, status: 'PUBLISHED' },
    { id: 2, batchNo: 'GZ202607001', salaryMonth: '2026-07', projectId: 1, employeeCount: 3, grossTotal: 19260, advanceDeduction: 0, netTotal: 19260, signedCount: 0, status: 'PENDING_REVIEW' }
  ];
  db.employeeFeedbacks = Array.isArray(db.employeeFeedbacks) ? db.employeeFeedbacks : [
    { id: 1, employeeId: 2, feedbackType: '考勤异议', content: '7月12日加班工时尚未确认', status: '待处理', createdAt: now() }
  ];
  db.factoryStaff = Array.isArray(db.factoryStaff) ? db.factoryStaff : [
    { id: 1, employeeId: 1, projectId: 1, worksiteName: '滨江一厂', factoryArea: '装配车间', shiftName: '白班', dormitory: 'A栋306', residentStatus: '在厂', entryDate: '2026-06-01', managerName: '林少芬' },
    { id: 2, employeeId: 2, projectId: 1, worksiteName: '滨江一厂', factoryArea: '品质车间', shiftName: '长白班', dormitory: '厂外住宿', residentStatus: '在厂', entryDate: '2026-04-15', managerName: '林少芬' },
    { id: 3, employeeId: 3, projectId: 1, worksiteName: '滨江一厂', factoryArea: '焊接车间', shiftName: '夜班', dormitory: 'B栋208', residentStatus: '在厂', entryDate: '2026-05-20', managerName: '林少芬' }
  ];
  db.blacklist = Array.isArray(db.blacklist) ? db.blacklist : [
    { id: 1, name: '测试风险人员', idCardNo: '330100198001010019', reason: '历史项目中存在严重旷工并拒绝办理离职交接', riskLevel: '高', source: '华东精密一厂驻场项目', phone: '13910003001', remark: '再次录用需公司负责人审批', status: 1, createdBy: '企业管理员', createdAt: now() }
  ];
  db.permissionRoles = Array.isArray(db.permissionRoles) ? db.permissionRoles : [
    { id: 1, roleName: '企业管理员', roleCode: 'company_admin', dataScope: '全公司', userCount: 1, permissions: ['全部功能'] },
    { id: 2, roleName: 'HR主管', roleCode: 'hr_manager', dataScope: '全公司', userCount: 1, permissions: ['员工管理', '合同保险', '人才库', '风险管理'] },
    { id: 3, roleName: '驻场主管', roleCode: 'site_manager', dataScope: '指定项目', userCount: 2, permissions: ['驻厂人员', '员工录入', '预支初审', '员工反馈'] },
    { id: 4, roleName: '薪资财务', roleCode: 'payroll_finance', dataScope: '授权项目', userCount: 1, permissions: ['预支管理', '工资发放', '数据导出'] }
  ];
  db.permissionUsers = Array.isArray(db.permissionUsers) ? db.permissionUsers : [
    { id: 1, realName: '企业管理员', username: 'admin', mobile: '13800000000', roleId: 1, orgName: '总部', projectNames: ['全部项目'], status: 1 },
    { id: 2, realName: '林少芬', username: 'linshaofen', mobile: '13810004001', roleId: 3, orgName: '驻场管理部', projectNames: ['华东精密一厂驻场项目'], status: 1 },
    { id: 3, realName: '李海', username: 'lihai', mobile: '13810004002', roleId: 3, orgName: '招聘交付部', projectNames: ['联创装备招聘交付项目'], status: 1 },
    { id: 4, realName: '王会计', username: 'finance', mobile: '13810004003', roleId: 4, orgName: '财务部', projectNames: ['全部项目'], status: 1 }
  ];
  db.nextIds = db.nextIds || {};
  db.nextIds.client = db.nextIds.client || Math.max(0, ...db.clients.map(item => item.id)) + 1;
  db.nextIds.project = db.nextIds.project || Math.max(0, ...db.projects.map(item => item.id)) + 1;
  db.nextIds.talent = db.nextIds.talent || Math.max(0, ...db.talents.map(item => item.id)) + 1;
  db.nextIds.advance = db.nextIds.advance || Math.max(0, ...db.advances.map(item => item.id)) + 1;
  db.nextIds.payrollBatch = db.nextIds.payrollBatch || Math.max(0, ...db.payrollBatches.map(item => item.id)) + 1;
  db.nextIds.feedback = db.nextIds.feedback || Math.max(0, ...db.employeeFeedbacks.map(item => item.id)) + 1;
  db.nextIds.factoryStaff = db.nextIds.factoryStaff || Math.max(0, ...db.factoryStaff.map(item => item.id)) + 1;
  db.nextIds.blacklist = db.nextIds.blacklist || Math.max(0, ...db.blacklist.map(item => item.id)) + 1;
  db.nextIds.permissionUser = db.nextIds.permissionUser || Math.max(0, ...db.permissionUsers.map(item => item.id)) + 1;
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function nextId(db, name) {
  const id = db.nextIds[name] || 1;
  db.nextIds[name] = id + 1;
  return id;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: crypto.scryptSync(String(password), salt, 64).toString('hex')
  };
}

function verifyPassword(password, credential) {
  if (!credential?.salt || !credential?.hash) return password === 'Admin@123456';
  const actual = crypto.scryptSync(String(password), credential.salt, 64);
  const expected = Buffer.from(credential.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function isAuthorized(req) {
  return req.headers.authorization === 'Bearer prototype-token';
}

function addLog(db, moduleName, actionType, bizId = 0, detail = '') {
  db.logs.push({
    id: nextId(db, 'log'),
    moduleName,
    actionType,
    bizId,
    detail,
    operatorName: '企业管理员',
    createdAt: now()
  });
}

function maskPhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

function maskIdCard(idCardNo) {
  if (!idCardNo) return '';
  return String(idCardNo).replace(/^(.{6}).+(.{4})$/, '$1********$2');
}

function maskBankCard(cardNo) {
  if (!cardNo) return '';
  const value = String(cardNo);
  return value.length > 8 ? `${value.slice(0, 4)} **** **** ${value.slice(-4)}` : value;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function ok(res, data = null, message = 'success') {
  sendJson(res, 200, { code: 0, message, data });
}

function fail(res, statusCode, message) {
  sendJson(res, statusCode, { code: statusCode, message, data: null });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('JSON格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function enrichEmployee(db, employee, options = {}) {
  const job = db.jobs.find(item => item.employeeId === employee.id && item.jobStatus === 1);
  const dept = job ? db.departments.find(item => item.id === job.deptId) : null;
  const position = job ? db.positions.find(item => item.id === job.positionId) : null;
  const social = db.socials.find(item => item.employeeId === employee.id);
  const contracts = db.contracts.filter(item => item.employeeId === employee.id);
  const signedContract = contracts.find(item => item.signStatus === 1);
  const riskCount = db.risks.filter(item => item.employeeId === employee.id && [0, 1].includes(item.handleStatus)).length;

  return {
    id: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    gender: employee.gender,
    genderName: dictionaries.gender[employee.gender] || '未知',
    idCardNo: options.showSensitive ? employee.idCardNo : maskIdCard(employee.idCardNo),
    phone: options.showSensitive ? employee.phone : maskPhone(employee.phone),
    education: employee.education || '',
    bankName: employee.bankName || '',
    bankCardNo: options.showSensitive ? employee.bankCardNo : maskBankCard(employee.bankCardNo),
    emergencyContact: employee.emergencyContact || '',
    emergencyPhone: options.showSensitive ? employee.emergencyPhone : maskPhone(employee.emergencyPhone),
    employeeStatus: employee.employeeStatus,
    employeeStatusName: dictionaries.employeeStatus[employee.employeeStatus] || '未知',
    customerId: employee.customerId || '',
    customerName: db.clients?.find(item => item.id === Number(employee.customerId))?.clientName || '',
    deptId: job?.deptId || '',
    deptName: dept?.deptName || '',
    positionId: job?.positionId || '',
    positionName: position?.positionName || '',
    employmentType: job?.employmentType || '',
    employmentTypeName: dictionaries.employmentType[job?.employmentType] || '',
    workType: job?.workType || '',
    workTypeName: dictionaries.workType[job?.workType] || '',
    hireDate: job?.hireDate || '',
    socialStatus: social?.socialStatus ?? 0,
    socialStatusName: dictionaries.socialStatus[social?.socialStatus ?? 0],
    contractStatusName: signedContract ? getContractStatusName(signedContract) : '未签',
    riskCount,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt
  };
}

function getContractStatusName(contract) {
  if (!contract || contract.signStatus !== 1) return '未签';
  if (!contract.endDate) return '已签';
  const current = today();
  if (contract.endDate < current) return '已过期';
  if (contract.endDate <= addDays(current, 30)) return '即将到期';
  return '已签';
}

function getEmployeeDetail(db, employeeId, options = {}) {
  const employee = db.employees.find(item => item.id === employeeId && !item.deletedAt);
  if (!employee) return null;
  const currentJob = db.jobs.find(item => item.employeeId === employeeId && item.jobStatus === 1);
  const jobHistory = db.jobs
    .filter(item => item.employeeId === employeeId)
    .map(job => {
      const dept = db.departments.find(item => item.id === job.deptId);
      const position = db.positions.find(item => item.id === job.positionId);
      return {
        ...job,
        deptName: dept?.deptName || '',
        positionName: position?.positionName || '',
        employmentTypeName: dictionaries.employmentType[job.employmentType],
        workTypeName: dictionaries.workType[job.workType],
        jobStatusName: job.jobStatus === 1 ? '当前' : '历史'
      };
    })
    .sort((a, b) => b.id - a.id);

  const social = db.socials.find(item => item.employeeId === employeeId);
  const certificates = db.certificates.filter(item => item.employeeId === employeeId);
  const contracts = db.contracts.filter(item => item.employeeId === employeeId);
  const risks = db.risks.filter(item => item.employeeId === employeeId).sort((a, b) => b.id - a.id);

  return {
    basicInfo: enrichEmployee(db, employee, options),
    jobInfo: currentJob ? jobHistory.find(item => item.id === currentJob.id) : null,
    jobHistory,
    contractList: contracts.map(item => ({
      ...item,
      signStatusName: dictionaries.signStatus[item.signStatus],
      contractStatusName: getContractStatusName(item)
    })),
    socialSecurity: social
      ? {
          ...social,
          socialStatusName: dictionaries.socialStatus[social.socialStatus],
          fundStatusName: dictionaries.socialStatus[social.fundStatus]
        }
      : null,
    certificateList: certificates.map(item => ({
      ...item,
      certTypeName: dictionaries.certType[item.certType],
      verifyStatusName: item.verifyStatus === 1 ? '已核验' : item.verifyStatus === 2 ? '异常' : '未核验'
    })),
    riskAlertList: risks.map(formatRisk)
  };
}

function formatRisk(risk) {
  return {
    ...risk,
    riskLevelName: dictionaries.riskLevel[risk.riskLevel],
    handleStatusName: dictionaries.handleStatus[risk.handleStatus]
  };
}

function validateEmployeeInput(db, body, id = 0) {
  const required = [
    ['name', '姓名不能为空'],
    ['phone', '手机号不能为空'],
    ['idCardNo', '身份证号不能为空'],
    ['deptId', '部门不能为空'],
    ['positionId', '岗位不能为空'],
    ['employmentType', '用工类型不能为空'],
    ['workType', '工资类型不能为空'],
    ['hireDate', '入职日期不能为空']
  ];

  for (const [field, message] of required) {
    if (!body[field]) return message;
  }
  if (!/^1[3-9]\d{9}$/.test(body.phone)) return '手机号格式不正确';
  if (!/^\d{17}[\dXx]$/.test(body.idCardNo)) return '身份证号格式不正确';
  const blacklistHit = db.blacklist?.find(item => item.status === 1 && item.idCardNo.toUpperCase() === String(body.idCardNo).toUpperCase());
  if (blacklistHit) return `该人员命中全公司黑名单：${blacklistHit.reason}`;

  const dept = db.departments.find(item => item.id === Number(body.deptId) && item.status === 1);
  if (!dept) return '部门不存在或已停用';

  const position = db.positions.find(item => item.id === Number(body.positionId) && item.status === 1);
  if (!position) return '岗位不存在或已停用';

  return '';
}

function createRiskIfNotExists(db, risk) {
  if (db.risks.some(item => item.riskKey === risk.riskKey && item.handleStatus !== 3)) return false;
  db.risks.push({
    id: nextId(db, 'risk'),
    companyId: 1,
    handleStatus: 0,
    createdAt: now(),
    updatedAt: now(),
    ...risk
  });
  return true;
}

function scanRisks(db) {
  let created = 0;
  const current = today();
  const after30Days = addDays(current, 30);
  const activeEmployees = db.employees.filter(item => item.employeeStatus === 2 && !item.deletedAt);

  for (const employee of activeEmployees) {
    const signedContracts = db.contracts.filter(item => item.employeeId === employee.id && item.signStatus === 1);
    if (!signedContracts.length) {
      created += Number(
        createRiskIfNotExists(db, {
          employeeId: employee.id,
          riskType: 1,
          riskLevel: 3,
          riskTitle: '在职员工未签合同',
          riskDesc: `${employee.name}当前无有效已签劳动合同`,
          riskKey: `contract_missing:${employee.id}`
        })
      );
    }

    for (const contract of signedContracts) {
      if (contract.endDate && contract.endDate <= after30Days) {
        const expired = contract.endDate < current;
        created += Number(
          createRiskIfNotExists(db, {
            employeeId: employee.id,
            riskType: 2,
            riskLevel: expired ? 3 : 2,
            riskTitle: expired ? '劳动合同已过期' : '劳动合同即将到期',
            riskDesc: `${employee.name}合同${contract.contractNo}结束日期为${contract.endDate}`,
            riskKey: `contract_expire:${contract.id}`
          })
        );
      }
    }

    const job = db.jobs.find(item => item.employeeId === employee.id && item.jobStatus === 1);
    const social = db.socials.find(item => item.employeeId === employee.id && item.socialStatus === 1);
    if (job?.employmentType === 1 && !social) {
      created += Number(
        createRiskIfNotExists(db, {
          employeeId: employee.id,
          riskType: 3,
          riskLevel: 3,
          riskTitle: '全职员工社保异常',
          riskDesc: `${employee.name}为全职在职员工，但当前无有效参保记录`,
          riskKey: `social_missing:${employee.id}`
        })
      );
    }

    const position = job ? db.positions.find(item => item.id === job.positionId) : null;
    if (position?.isSpecialWork) {
      const validCert = db.certificates.some(
        item =>
          item.employeeId === employee.id &&
          item.certType === 4 &&
          item.verifyStatus === 1 &&
          (!item.expireDate || item.expireDate >= current)
      );
      if (!validCert) {
        created += Number(
          createRiskIfNotExists(db, {
            employeeId: employee.id,
            riskType: 5,
            riskLevel: 3,
            riskTitle: '特殊工种证件缺失',
            riskDesc: `${employee.name}当前岗位为${position.positionName}，但无有效特种作业证`,
            riskKey: `special_work_cert_missing:${employee.id}`
          })
        );
      }
    }
  }

  for (const cert of db.certificates) {
    const employee = db.employees.find(item => item.id === cert.employeeId && item.employeeStatus === 2);
    if (!employee || !cert.expireDate || cert.expireDate > after30Days) continue;
    const expired = cert.expireDate < current;
    created += Number(
      createRiskIfNotExists(db, {
        employeeId: cert.employeeId,
        riskType: 4,
        riskLevel: expired ? 3 : 2,
        riskTitle: expired ? '员工证件已过期' : '员工证件即将过期',
        riskDesc: `${employee.name}${dictionaries.certType[cert.certType]}到期日期为${cert.expireDate}`,
        riskKey: `cert_expire:${cert.id}`
      })
    );
  }

  return created;
}

function listEmployees(db, searchParams) {
  const page = Number(searchParams.get('page') || 1);
  const pageSize = Number(searchParams.get('pageSize') || 20);
  const keyword = normalizeText(searchParams.get('keyword'));
  const employeeStatus = searchParams.get('employeeStatus');
  const deptId = searchParams.get('deptId');
  const employmentType = searchParams.get('employmentType');

  let rows = db.employees
    .filter(item => !item.deletedAt)
    .map(item => enrichEmployee(db, item))
    .filter(item => {
      if (keyword) {
        const text = normalizeText(`${item.employeeNo} ${item.name} ${item.phone} ${item.idCardNo}`);
        if (!text.includes(keyword)) return false;
      }
      if (employeeStatus && item.employeeStatus !== Number(employeeStatus)) return false;
      if (deptId && item.deptId !== Number(deptId)) return false;
      if (employmentType && item.employmentType !== Number(employmentType)) return false;
      return true;
    })
    .sort((a, b) => b.id - a.id);

  const total = rows.length;
  rows = rows.slice((page - 1) * pageSize, page * pageSize);
  return { page, pageSize, total, list: rows };
}

function getSummary(db) {
  const activeEmployees = db.employees.filter(item => item.employeeStatus === 2 && !item.deletedAt);
  const unresolvedRisks = db.risks.filter(item => [0, 1].includes(item.handleStatus));
  const highRisks = unresolvedRisks.filter(item => item.riskLevel === 3);
  const unsigned = activeEmployees.filter(emp => !db.contracts.some(item => item.employeeId === emp.id && item.signStatus === 1));
  const socialMissing = activeEmployees.filter(emp => {
    const job = db.jobs.find(item => item.employeeId === emp.id && item.jobStatus === 1);
    return job?.employmentType === 1 && !db.socials.some(item => item.employeeId === emp.id && item.socialStatus === 1);
  });

  return {
    employeeTotal: db.employees.filter(item => !item.deletedAt).length,
    activeTotal: activeEmployees.length,
    unresolvedRiskTotal: unresolvedRisks.length,
    highRiskTotal: highRisks.length,
    unsignedTotal: unsigned.length,
    socialMissingTotal: socialMissing.length,
    riskCaseOpenTotal: db.riskCases.filter(item => item.status !== 3).length,
    riskCaseOverdueTotal: db.riskCases.filter(item => item.status !== 3 && item.deadline && item.deadline < today()).length,
    clientTotal: db.clients.length,
    projectTotal: db.projects.filter(item => item.status === 1).length,
    talentTotal: db.talents.length,
    advanceOutstanding: db.advances.reduce((total, item) => total + Math.max(0, Number(item.paidAmount || 0) - Number(item.repaidAmount || 0)), 0),
    advancePendingTotal: db.advances.filter(item => item.status === 'PENDING_APPROVAL').length
  };
}

function formatRiskCase(db, item) {
  const alert = db.risks.find(risk => risk.id === item.sourceAlertId);
  const employee = db.employees.find(emp => emp.id === item.employeeId);
  return {
    ...item,
    employeeName: employee?.name || '',
    employeeNo: employee?.employeeNo || '',
    riskTitle: alert?.riskTitle || item.riskTitle || '',
    riskDesc: alert?.riskDesc || item.riskDesc || '',
    riskLevel: alert?.riskLevel || item.riskLevel || 2,
    riskLevelName: dictionaries.riskLevel[alert?.riskLevel || item.riskLevel || 2],
    statusName: dictionaries.riskCaseStatus[item.status] || '待整改',
    overdue: item.status !== 3 && Boolean(item.deadline) && item.deadline < today()
  };
}

function getDashboardAnalytics(db) {
  const employees = db.employees.filter(item => !item.deletedAt);
  const activeEmployees = employees.filter(item => item.employeeStatus === 2);
  const activeJobs = db.jobs.filter(item => item.jobStatus === 1);
  const monthKeys = [];
  const cursor = new Date(`${today().slice(0, 7)}-01T00:00:00`);
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(cursor);
    date.setMonth(date.getMonth() - offset);
    monthKeys.push(date.toISOString().slice(0, 7));
  }

  const departmentDistribution = db.departments
    .filter(item => item.status === 1)
    .map(dept => ({
      name: dept.deptName,
      value: activeJobs.filter(job => job.deptId === dept.id && activeEmployees.some(emp => emp.id === job.employeeId)).length
    }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value);

  const employmentDistribution = Object.entries(dictionaries.employmentType)
    .map(([key, name]) => ({
      name,
      value: activeJobs.filter(job => job.employmentType === Number(key) && activeEmployees.some(emp => emp.id === job.employeeId)).length
    }))
    .filter(item => item.value > 0);

  const signedCount = activeEmployees.filter(emp => db.contracts.some(contract => contract.employeeId === emp.id && contract.signStatus === 1 && (!contract.endDate || contract.endDate >= today()))).length;
  const fullTimeEmployees = activeEmployees.filter(emp => activeJobs.some(job => job.employeeId === emp.id && job.employmentType === 1));
  const insuredCount = fullTimeEmployees.filter(emp => db.socials.some(social => social.employeeId === emp.id && social.socialStatus === 1)).length;
  const specialWorkers = activeEmployees.filter(emp => {
    const job = activeJobs.find(item => item.employeeId === emp.id);
    return db.positions.find(position => position.id === job?.positionId)?.isSpecialWork === 1;
  });
  const certifiedSpecialWorkers = specialWorkers.filter(emp => db.certificates.some(cert => cert.employeeId === emp.id && cert.certType === 4 && cert.verifyStatus === 1 && (!cert.expireDate || cert.expireDate >= today()))).length;

  const riskByType = [
    { name: '劳动合同', types: [1, 2] },
    { name: '社保合规', types: [3] },
    { name: '证件资质', types: [4, 5] },
    { name: '离职交接', types: [6] }
  ].map(group => ({
    name: group.name,
    unresolved: db.risks.filter(risk => group.types.includes(risk.riskType) && [0, 1].includes(risk.handleStatus)).length,
    closed: db.risks.filter(risk => group.types.includes(risk.riskType) && risk.handleStatus === 2).length
  }));

  const trend = monthKeys.map(month => ({
    month,
    hires: activeJobs.filter(job => job.hireDate?.startsWith(month)).length,
    resignations: db.resignations.filter(item => item.leaveDate?.startsWith(month)).length
  }));

  const highOpenRisks = db.risks.filter(item => item.riskLevel === 3 && [0, 1].includes(item.handleStatus)).length;
  const closedCases = db.riskCases.filter(item => item.status === 3).length;
  const totalCases = db.riskCases.length;

  return {
    generatedAt: now(),
    kpis: {
      employeeTotal: employees.length,
      activeTotal: activeEmployees.length,
      pendingOnboardTotal: employees.filter(item => item.employeeStatus === 1).length,
      resignationTotal: employees.filter(item => item.employeeStatus === 3).length,
      highOpenRisks,
      riskClosureRate: totalCases ? Math.round((closedCases / totalCases) * 100) : 0
    },
    compliance: {
      contractRate: activeEmployees.length ? Math.round((signedCount / activeEmployees.length) * 100) : 100,
      socialRate: fullTimeEmployees.length ? Math.round((insuredCount / fullTimeEmployees.length) * 100) : 100,
      specialCertRate: specialWorkers.length ? Math.round((certifiedSpecialWorkers / specialWorkers.length) * 100) : 100
    },
    departmentDistribution,
    employmentDistribution,
    riskByType,
    trend
  };
}

async function handleApi(req, res, url) {
  const db = readDb();
  const segments = url.pathname.split('/').filter(Boolean);
  const resource = segments[1];
  const id = Number(segments[2]);
  const action = segments[3];

  try {
    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      return ok(res, {
        dictionaries,
        departments: db.departments,
        positions: db.positions,
        company: db.company
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await parseBody(req);
      if (body.username !== 'admin' || !verifyPassword(body.password, db.auth?.admin)) {
        return fail(res, 401, '账号或密码错误');
      }
      return ok(
        res,
        {
          token: 'prototype-token',
          user: {
            id: 1,
            companyId: 1,
            username: 'admin',
            realName: '企业管理员',
            roles: [{ id: 1, roleName: '企业管理员', roleCode: 'company_admin', dataScope: 1 }],
            permissions: [
              'employee:view',
              'employee:create',
              'employee:update',
              'employee:transfer',
              'employee:resign',
              'employee:export',
              'risk:view',
              'risk:scan',
              'risk:handle'
            ],
            dataScope: 1
          }
        },
        '登录成功'
      );
    }

    if (!isAuthorized(req)) {
      return fail(res, 401, '登录已失效，请重新登录');
    }

    if (req.method === 'PUT' && url.pathname === '/api/auth/password') {
      const body = await parseBody(req);
      if (!verifyPassword(body.currentPassword, db.auth?.admin)) return fail(res, 400, '当前密码错误');
      if (!body.newPassword || String(body.newPassword).length < 8) return fail(res, 400, '新密码至少8位');
      if (!/[A-Za-z]/.test(body.newPassword) || !/\d/.test(body.newPassword)) {
        return fail(res, 400, '新密码必须同时包含字母和数字');
      }
      if (body.newPassword !== body.confirmPassword) return fail(res, 400, '两次输入的新密码不一致');
      if (body.currentPassword === body.newPassword) return fail(res, 400, '新密码不能与当前密码相同');

      db.auth = db.auth || {};
      db.auth.admin = hashPassword(body.newPassword);
      addLog(db, '账号安全', 'change_password', 1, '管理员修改登录密码');
      writeDb(db);
      return ok(res, null, '密码修改成功');
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      return ok(res, {
        id: 1,
        companyId: 1,
        username: 'admin',
        realName: '企业管理员',
        roles: [{ id: 1, roleName: '企业管理员', roleCode: 'company_admin', dataScope: 1 }],
        dataScope: 1
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/summary') {
      return ok(res, getSummary(db));
    }

    if (req.method === 'GET' && url.pathname === '/api/operations/home') {
      const active = db.employees.filter(item => item.employeeStatus === 2 && !item.deletedAt);
      const leftEmployees = db.employees.filter(item => item.employeeStatus === 3 && !item.deletedAt);
      const pendingContracts = active.filter(employee => !db.contracts.some(contract => contract.employeeId === employee.id && contract.signStatus === 1)).length;
      const pendingInsurance = active.filter(employee => !db.socials.some(social => social.employeeId === employee.id && social.socialStatus === 1)).length;
      const unsignedPayslips = db.payrollBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch.employeeCount) - Number(batch.signedCount)), 0);
      return ok(res, {
        workforce: { total: db.employees.filter(item => !item.deletedAt).length, active: active.length, left: leftEmployees.length, talents: db.talents.length },
        finance: {
          advancePaid: db.advances.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0),
          advanceOutstanding: db.advances.reduce((sum, item) => sum + Math.max(0, Number(item.paidAmount || 0) - Number(item.repaidAmount || 0)), 0),
          payrollNet: db.payrollBatches.reduce((sum, item) => sum + Number(item.netTotal || 0), 0)
        },
        todos: [
          { id: 'advance', title: '预支待审批', count: db.advances.filter(item => item.status === 'PENDING_APPROVAL').length, view: 'advances', tone: 'amber' },
          { id: 'contract', title: '员工合同待处理', count: pendingContracts, view: 'risk', tone: 'red' },
          { id: 'insurance', title: '保险待增员', count: pendingInsurance, view: 'insurance', tone: 'red' },
          { id: 'payslip', title: '工资条待签收', count: unsignedPayslips, view: 'payroll', tone: 'blue' },
          { id: 'feedback', title: '员工反馈待处理', count: db.employeeFeedbacks.filter(item => item.status === '待处理').length, view: 'roster', tone: 'blue' }
        ],
        notices: [
          { title: '工资条发布必须执行复核', time: '今天', category: '薪资合规' },
          { title: '离职员工请及时完成保险减员', time: '昨天', category: '风险提醒' },
          { title: '7月客户结算资料请在月底前归档', time: '2天前', category: '项目通知' }
        ]
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/payroll/overview') {
      const statusName = { DRAFT: '草稿', PENDING_REVIEW: '待审核', APPROVED: '待发布', PUBLISHED: '已发布', CLOSED: '已关闭' };
      const batches = [...db.payrollBatches].sort((a, b) => b.id - a.id).map(item => ({
        ...item,
        projectName: db.projects.find(project => project.id === item.projectId)?.projectName || '',
        unsignedCount: Math.max(0, Number(item.employeeCount) - Number(item.signedCount)),
        statusName: statusName[item.status] || item.status
      }));
      return ok(res, {
        grossTotal: batches.reduce((sum, item) => sum + Number(item.grossTotal || 0), 0),
        netTotal: batches.reduce((sum, item) => sum + Number(item.netTotal || 0), 0),
        unsignedTotal: batches.reduce((sum, item) => sum + item.unsignedCount, 0),
        batches
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/employment-records') {
      const rows = db.jobs.map(job => {
        const employee = db.employees.find(item => item.id === job.employeeId);
        const department = db.departments.find(item => item.id === job.deptId);
        const position = db.positions.find(item => item.id === job.positionId);
        return {
          id: job.id,
          employeeName: employee?.name || '',
          employeeNo: employee?.employeeNo || '',
          departmentName: department?.deptName || '',
          positionName: position?.positionName || '',
          hireDate: job.hireDate,
          statusName: job.jobStatus === 1 ? '当前用工' : '历史记录'
        };
      }).sort((a, b) => b.id - a.id);
      return ok(res, rows);
    }

    if (req.method === 'GET' && url.pathname === '/api/factory-staff') {
      const projectId = Number(url.searchParams.get('projectId') || 0);
      const residentStatus = url.searchParams.get('residentStatus') || '';
      const rows = db.factoryStaff
        .filter(item => !projectId || item.projectId === projectId)
        .filter(item => !residentStatus || item.residentStatus === residentStatus)
        .map(item => {
          const employee = db.employees.find(employeeItem => employeeItem.id === item.employeeId);
          const job = db.jobs.find(jobItem => jobItem.employeeId === item.employeeId && jobItem.jobStatus === 1);
          return {
            ...item,
            employeeNo: employee?.employeeNo || '',
            employeeName: employee?.name || '',
            phone: maskPhone(employee?.phone || ''),
            positionName: db.positions.find(position => position.id === job?.positionId)?.positionName || '',
            projectName: db.projects.find(project => project.id === item.projectId)?.projectName || ''
          };
        })
        .sort((a, b) => b.id - a.id);
      return ok(res, rows);
    }

    if (req.method === 'POST' && url.pathname === '/api/factory-staff') {
      const body = await parseBody(req);
      if (!body.employeeId || !body.projectId || !body.worksiteName || !body.factoryArea || !body.shiftName) {
        return fail(res, 400, '请完整填写员工、项目、厂区、车间和班次');
      }
      const employeeId = Number(body.employeeId);
      if (db.factoryStaff.some(item => item.employeeId === employeeId && item.residentStatus === '在厂')) {
        return fail(res, 400, '该员工已有有效驻厂记录');
      }
      const factoryStaffId = nextId(db, 'factoryStaff');
      db.factoryStaff.push({
        id: factoryStaffId,
        employeeId,
        projectId: Number(body.projectId),
        worksiteName: body.worksiteName,
        factoryArea: body.factoryArea,
        shiftName: body.shiftName,
        dormitory: body.dormitory || '未安排',
        residentStatus: body.residentStatus || '在厂',
        entryDate: body.entryDate || today(),
        managerName: body.managerName || '企业管理员'
      });
      addLog(db, '驻厂人员管理', 'create', factoryStaffId, `员工ID ${employeeId}办理驻厂`);
      writeDb(db);
      return ok(res, { factoryStaffId }, '驻厂人员已登记');
    }

    if (req.method === 'GET' && url.pathname === '/api/blacklist') {
      const keyword = normalizeText(url.searchParams.get('keyword'));
      const rows = db.blacklist
        .filter(item => !keyword || normalizeText(`${item.name} ${item.idCardNo} ${item.reason} ${item.source}`).includes(keyword))
        .sort((a, b) => b.id - a.id)
        .map(item => ({ ...item, phone: maskPhone(item.phone), idCardMasked: maskIdCard(item.idCardNo), idCardNo: undefined }));
      return ok(res, rows);
    }

    if (req.method === 'POST' && url.pathname === '/api/blacklist') {
      const body = await parseBody(req);
      if (!body.name || !body.idCardNo || !body.reason) return fail(res, 400, '姓名、身份证号码和黑名单原因不能为空');
      if (!/^\d{17}[\dXx]$/.test(body.idCardNo)) return fail(res, 400, '身份证号码格式不正确');
      if (db.blacklist.some(item => item.status === 1 && item.idCardNo.toUpperCase() === String(body.idCardNo).toUpperCase())) {
        return fail(res, 400, '该身份证号码已存在有效黑名单记录');
      }
      const blacklistId = nextId(db, 'blacklist');
      db.blacklist.push({
        id: blacklistId,
        name: body.name,
        idCardNo: String(body.idCardNo).toUpperCase(),
        reason: body.reason,
        riskLevel: body.riskLevel || '高',
        source: body.source || '公司录入',
        phone: body.phone || '',
        remark: body.remark || '',
        status: 1,
        createdBy: '企业管理员',
        createdAt: now()
      });
      addLog(db, '全公司黑名单', 'create', blacklistId, `录入黑名单：${body.name}，原因：${body.reason}`);
      writeDb(db);
      return ok(res, { blacklistId }, '黑名单已录入并全公司共享');
    }

    if (req.method === 'GET' && url.pathname === '/api/permissions/overview') {
      return ok(res, {
        roles: db.permissionRoles,
        users: db.permissionUsers.map(user => ({
          ...user,
          mobile: maskPhone(user.mobile),
          roleName: db.permissionRoles.find(role => role.id === user.roleId)?.roleName || '',
          dataScope: db.permissionRoles.find(role => role.id === user.roleId)?.dataScope || ''
        }))
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/permissions/users') {
      const body = await parseBody(req);
      if (!body.realName || !body.username || !body.mobile || !body.roleId) return fail(res, 400, '姓名、账号、手机号和角色不能为空');
      if (db.permissionUsers.some(item => item.username === body.username)) return fail(res, 400, '登录账号已存在');
      const userId = nextId(db, 'permissionUser');
      db.permissionUsers.push({
        id: userId,
        realName: body.realName,
        username: body.username,
        mobile: body.mobile,
        roleId: Number(body.roleId),
        orgName: body.orgName || '总部',
        projectNames: body.projectNames ? [body.projectNames] : ['全部项目'],
        status: 1
      });
      const role = db.permissionRoles.find(item => item.id === Number(body.roleId));
      if (role) role.userCount = db.permissionUsers.filter(item => item.roleId === role.id).length;
      addLog(db, '权限管理', 'create_user', userId, `新增账号：${body.username}`);
      writeDb(db);
      return ok(res, { userId }, '账号已创建');
    }

    if (req.method === 'GET' && url.pathname === '/api/clients') {
      return ok(res, db.clients.map(client => ({
        ...client,
        projectCount: db.projects.filter(project => project.clientId === client.id).length,
        activeCount: db.projects.filter(project => project.clientId === client.id).reduce((sum, project) => sum + Number(project.activeCount || 0), 0)
      })));
    }

    if (req.method === 'POST' && url.pathname === '/api/clients') {
      const body = await parseBody(req);
      if (!body.clientName || !body.contactName || !body.contactPhone) return fail(res, 400, '请完整填写客户名称、联系人和联系电话');
      if (db.clients.some(item => item.clientName === body.clientName)) return fail(res, 400, '该客户单位已存在，请勿重复录入');
      const clientId = nextId(db, 'client');
      db.clients.push({
        id: clientId,
        clientName: body.clientName,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        settlementCycle: body.settlementCycle || '月结30天',
        status: 1
      });
      const projectId = nextId(db, 'project');
      db.projects.push({
        id: projectId,
        clientId,
        projectCode: `XM-${today().replaceAll('-', '')}-${String(projectId).padStart(3, '0')}`,
        projectName: body.projectName || `${body.clientName}用工项目`,
        worksiteName: body.worksiteName || body.clientName,
        serviceType: body.serviceType || '岗位外包',
        managerName: '企业管理员',
        activeCount: 0,
        status: 2
      });
      addLog(db, '客户管理', 'create', clientId, `新增客户及首个项目：${body.clientName}`);
      writeDb(db);
      return ok(res, { clientId, projectId, effective: true }, '客户及首个项目已创建并立即生效');
    }

    if (req.method === 'GET' && resource === 'customers' && id) {
      const client = db.clients.find(item => item.id === id);
      if (!client) return fail(res, 404, '客户单位不存在');
      return ok(res, {
        customer: {
          id: client.id,
          customerName: client.clientName,
          contactName: client.contactName || '',
          contactPhone: client.contactPhone || '',
          settlementCycle: client.settlementCycle || '月结30天',
          address: client.address || '',
          status: client.status || 1
        },
        projects: db.projects.filter(item => item.clientId === id).map(item => ({
          ...item,
          serviceType: ({ 劳务派遣: 1, 岗位外包: 2, 灵活用工: 3, RPO招聘: 4 })[item.serviceType] || item.serviceType || 2
        }))
      });
    }

    if (req.method === 'PUT' && resource === 'customers' && id) {
      const body = await parseBody(req);
      const client = db.clients.find(item => item.id === id);
      if (!client) return fail(res, 404, '客户单位不存在');
      if (!body.customerName) return fail(res, 400, '客户名称不能为空');
      if (db.clients.some(item => item.id !== id && item.clientName === body.customerName)) return fail(res, 400, '该客户名称已被其他客户使用');
      Object.assign(client, {
        clientName: body.customerName,
        contactName: body.contactName || '',
        contactPhone: body.contactPhone || '',
        settlementCycle: body.settlementCycle || '月结30天',
        address: body.address || '',
        status: 1
      });
      let createdProjectCount = 0;
      let updatedProjectCount = 0;
      const serviceTypeNames = { 1: '劳务派遣', 2: '岗位外包', 3: '灵活用工', 4: 'RPO招聘' };
      for (const projectBody of Array.isArray(body.projects) ? body.projects : []) {
        if (!projectBody.projectName) return fail(res, 400, '项目名称不能为空');
        const project = projectBody.id ? db.projects.find(item => item.id === Number(projectBody.id) && item.clientId === id) : null;
        if (projectBody.id && !project) return fail(res, 403, '项目不存在或无权修改');
        if (project) {
          Object.assign(project, {
            projectName: projectBody.projectName,
            worksiteName: projectBody.worksiteName || body.customerName,
            serviceType: serviceTypeNames[Number(projectBody.serviceType)] || '岗位外包',
            status: Number(projectBody.status || 2)
          });
          updatedProjectCount += 1;
        } else {
          const projectId = nextId(db, 'project');
          db.projects.push({
            id: projectId,
            clientId: id,
            projectCode: `XM-${today().replaceAll('-', '')}-${String(projectId).padStart(3, '0')}`,
            projectName: projectBody.projectName,
            worksiteName: projectBody.worksiteName || body.customerName,
            serviceType: serviceTypeNames[Number(projectBody.serviceType)] || '岗位外包',
            managerName: '企业管理员',
            activeCount: 0,
            status: Number(projectBody.status || 2)
          });
          createdProjectCount += 1;
        }
      }
      addLog(db, '客户项目管理', 'update', id, `更新客户项目：${body.customerName}`);
      writeDb(db);
      return ok(res, { customerId: id, createdProjectCount, updatedProjectCount }, '客户项目情况已更新');
    }

    if (req.method === 'GET' && url.pathname === '/api/projects') {
      return ok(res, db.projects.map(project => ({
        ...project,
        customerId: project.clientId,
        clientName: db.clients.find(client => client.id === project.clientId)?.clientName || ''
      })));
    }

    if (req.method === 'POST' && url.pathname === '/api/projects') {
      const body = await parseBody(req);
      if (!body.clientId || !body.projectName || !body.worksiteName || !body.managerName) return fail(res, 400, '请完整填写客户、项目、用工地点和负责人');
      const projectId = nextId(db, 'project');
      db.projects.push({
        id: projectId,
        clientId: Number(body.clientId),
        projectCode: body.projectCode || `XM-${today().replaceAll('-', '')}-${String(projectId).padStart(3, '0')}`,
        projectName: body.projectName,
        worksiteName: body.worksiteName,
        serviceType: body.serviceType || '岗位外包',
        managerName: body.managerName,
        activeCount: 0,
        status: 1
      });
      addLog(db, '项目管理', 'create', projectId, `新增项目：${body.projectName}`);
      writeDb(db);
      return ok(res, { projectId }, '项目已创建');
    }

    if (req.method === 'GET' && url.pathname === '/api/talents') {
      return ok(res, [...db.talents].sort((a, b) => b.id - a.id));
    }

    if (req.method === 'POST' && url.pathname === '/api/talents') {
      const body = await parseBody(req);
      if (!body.name || !body.phone || !body.intentionJob) return fail(res, 400, '请填写姓名、手机号和意向岗位');
      if (db.talents.some(item => item.phone === body.phone)) return fail(res, 400, '该手机号已存在人才库中');
      const talentId = nextId(db, 'talent');
      db.talents.push({
        id: talentId,
        name: body.name,
        phone: body.phone,
        source: body.source || '线下招聘',
        intentionJob: body.intentionJob,
        tags: String(body.tags || '').split(/[,，]/).map(item => item.trim()).filter(Boolean),
        followStatus: body.followStatus || '待联系',
        ownerName: body.ownerName || '企业管理员',
        lastFollowAt: now()
      });
      addLog(db, '人才库', 'create', talentId, `新增人才：${body.name}`);
      writeDb(db);
      return ok(res, { talentId }, '人才已录入');
    }

    if (req.method === 'GET' && url.pathname === '/api/advances') {
      const statusName = { PENDING_APPROVAL: '待审批', APPROVED: '待放款', REJECTED: '已驳回', PAID: '还款中', SETTLED: '已结清' };
      return ok(res, [...db.advances].sort((a, b) => b.id - a.id).map(item => ({
        ...item,
        employeeName: db.employees.find(employee => employee.id === item.employeeId)?.name || '',
        employeeNo: db.employees.find(employee => employee.id === item.employeeId)?.employeeNo || '',
        customerName: db.clients.find(client => client.id === Number(item.customerId || db.projects.find(project => project.id === item.projectId)?.clientId))?.clientName || '',
        projectName: db.projects.find(project => project.id === item.projectId)?.projectName || '',
        outstandingAmount: Math.max(0, Number(item.paidAmount || 0) - Number(item.repaidAmount || 0)),
        statusName: statusName[item.status] || item.status
      })));
    }

    if (req.method === 'POST' && url.pathname === '/api/advances') {
      const body = await parseBody(req);
      const employee = db.employees.find(item => item.id === Number(body.employeeId) && item.employeeStatus === 2);
      if (!employee) return fail(res, 400, '仅在职员工可以申请预支');
      const customerId = Number(body.customerId || employee.customerId || 0);
      if (!customerId || customerId !== Number(employee.customerId || 0)) return fail(res, 400, '客户单位必须与员工当前所属客户一致');
      const projectId = Number(body.projectId || 0);
      const project = projectId ? db.projects.find(item => item.id === projectId && item.status === 1) : null;
      if (projectId && (!project || Number(project.clientId) !== customerId)) return fail(res, 400, '所属项目不存在或不属于所选客户');
      const amount = Number(body.applyAmount || 0);
      if (amount <= 0 || amount > 2000) return fail(res, 400, '单笔预支金额必须大于0且不超过2000元');
      const outstanding = db.advances.filter(item => item.employeeId === employee.id).reduce((sum, item) => sum + Math.max(0, Number(item.paidAmount || 0) - Number(item.repaidAmount || 0)), 0);
      if (outstanding + amount > 3000) return fail(res, 400, '员工未结预支与本次申请合计不能超过3000元');
      const advanceId = nextId(db, 'advance');
      db.advances.push({
        id: advanceId,
        advanceNo: `YZ${today().replaceAll('-', '')}${String(advanceId).padStart(4, '0')}`,
        employeeId: employee.id,
        customerId,
        projectId: projectId || null,
        applyAmount: amount,
        approvedAmount: 0,
        paidAmount: 0,
        repaidAmount: 0,
        purpose: body.purpose || '生活周转',
        status: 'PENDING_APPROVAL',
        appliedAt: now(),
        paidAt: ''
      });
      addLog(db, '预支管理', 'apply', advanceId, `${employee.name}申请预支${amount}元`);
      writeDb(db);
      return ok(res, { advanceId }, '预支申请已提交');
    }

    if (req.method === 'PUT' && resource === 'advances' && id && action === 'approve') {
      const body = await parseBody(req);
      const advance = db.advances.find(item => item.id === id);
      if (!advance) return fail(res, 404, '预支申请不存在');
      if (advance.status !== 'PENDING_APPROVAL') return fail(res, 400, '当前状态不可审批');
      const approved = body.approved !== false;
      advance.status = approved ? 'APPROVED' : 'REJECTED';
      advance.approvedAmount = approved ? Number(body.approvedAmount || advance.applyAmount) : 0;
      advance.approvalRemark = body.remark || '';
      addLog(db, '预支管理', approved ? 'approve' : 'reject', id, advance.approvalRemark || '预支审批');
      writeDb(db);
      return ok(res, { advanceId: id }, approved ? '审批通过' : '已驳回');
    }

    if (req.method === 'PUT' && resource === 'advances' && id && action === 'pay') {
      const advance = db.advances.find(item => item.id === id);
      if (!advance) return fail(res, 404, '预支申请不存在');
      if (advance.status !== 'APPROVED') return fail(res, 400, '仅审批通过的申请可以放款');
      advance.status = 'PAID';
      advance.paidAmount = Number(advance.approvedAmount || advance.applyAmount);
      advance.paidAt = now();
      addLog(db, '预支管理', 'pay', id, `已放款${advance.paidAmount}元`);
      writeDb(db);
      return ok(res, { advanceId: id }, '放款已登记');
    }

    if (req.method === 'GET' && url.pathname === '/api/insurance/overview') {
      const activeEmployees = db.employees.filter(item => item.employeeStatus === 2 && !item.deletedAt);
      const rows = activeEmployees.map(employee => {
        const social = db.socials.find(item => item.employeeId === employee.id);
        const job = db.jobs.find(item => item.employeeId === employee.id && item.jobStatus === 1);
        const insured = social?.socialStatus === 1;
        return {
          employeeId: employee.id,
          employeeNo: employee.employeeNo,
          employeeName: employee.name,
          deptName: db.departments.find(item => item.id === job?.deptId)?.deptName || '',
          insuranceStatus: insured ? '已参保' : '待增员',
          effectiveMonth: social?.startMonth || '',
          socialCity: social?.socialCity || '',
          alertLevel: insured ? '正常' : '高风险'
        };
      });
      return ok(res, {
        total: rows.length,
        insured: rows.filter(item => item.insuranceStatus === '已参保').length,
        pending: rows.filter(item => item.insuranceStatus === '待增员').length,
        rows
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/analytics/dashboard') {
      return ok(res, getDashboardAnalytics(db));
    }

    if (req.method === 'GET' && url.pathname === '/api/audit-logs') {
      const rows = [...db.logs]
        .sort((a, b) => b.id - a.id)
        .slice(0, 200)
        .map(item => ({
          ...item,
          operatorName: item.operatorName || '企业管理员',
          detail: item.detail || ''
        }));
      return ok(res, rows);
    }

    if (req.method === 'GET' && url.pathname === '/api/risk-cases') {
      const status = url.searchParams.get('status');
      const rows = db.riskCases
        .filter(item => status === null || status === '' || item.status === Number(status))
        .map(item => formatRiskCase(db, item))
        .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.id - a.id);
      return ok(res, rows);
    }

    if (req.method === 'POST' && url.pathname === '/api/risk-cases') {
      const body = await parseBody(req);
      const alert = db.risks.find(item => item.id === Number(body.sourceAlertId));
      if (!alert) return fail(res, 404, '来源风险预警不存在');
      if (db.riskCases.some(item => item.sourceAlertId === alert.id && item.status !== 3)) {
        return fail(res, 400, '该风险已存在未关闭的整改任务');
      }
      if (!body.ownerName || !body.deadline || !body.correctiveMeasure) {
        return fail(res, 400, '请完整填写责任人、整改期限和整改措施');
      }

      const caseId = nextId(db, 'riskCase');
      db.riskCases.push({
        id: caseId,
        companyId: 1,
        sourceAlertId: alert.id,
        employeeId: alert.employeeId,
        ownerName: body.ownerName,
        ownerDept: body.ownerDept || '',
        deadline: body.deadline,
        correctiveMeasure: body.correctiveMeasure,
        evidenceNote: '',
        reviewNote: '',
        status: 0,
        createdAt: now(),
        updatedAt: now(),
        closedAt: ''
      });
      alert.handleStatus = 1;
      alert.updatedAt = now();
      addLog(db, '用工风险管理', 'create_case', caseId, `创建整改任务：${alert.riskTitle}`);
      writeDb(db);
      return ok(res, { caseId }, '整改任务已创建');
    }

    if (req.method === 'PUT' && resource === 'risk-cases' && id) {
      const body = await parseBody(req);
      const riskCase = db.riskCases.find(item => item.id === id);
      if (!riskCase) return fail(res, 404, '整改任务不存在');
      const nextStatus = Number(body.status);
      if (![0, 1, 2, 3].includes(nextStatus)) return fail(res, 400, '整改状态不正确');
      if (nextStatus >= 2 && !body.evidenceNote) return fail(res, 400, '提交复核前必须填写整改证据说明');
      if (nextStatus === 3 && !body.reviewNote) return fail(res, 400, '关闭风险前必须填写复核结论');

      Object.assign(riskCase, {
        ownerName: body.ownerName || riskCase.ownerName,
        ownerDept: body.ownerDept ?? riskCase.ownerDept,
        deadline: body.deadline || riskCase.deadline,
        correctiveMeasure: body.correctiveMeasure || riskCase.correctiveMeasure,
        evidenceNote: body.evidenceNote ?? riskCase.evidenceNote,
        reviewNote: body.reviewNote ?? riskCase.reviewNote,
        status: nextStatus,
        updatedAt: now(),
        closedAt: nextStatus === 3 ? now() : ''
      });
      const alert = db.risks.find(item => item.id === riskCase.sourceAlertId);
      if (alert) {
        alert.handleStatus = nextStatus === 3 ? 2 : 1;
        alert.handleRemark = nextStatus === 3 ? riskCase.reviewNote : riskCase.correctiveMeasure;
        alert.handleTime = nextStatus === 3 ? now() : '';
        alert.updatedAt = now();
      }
      addLog(db, '用工风险管理', nextStatus === 3 ? 'close_case' : 'update_case', id, riskCase.reviewNote || riskCase.evidenceNote || riskCase.correctiveMeasure);
      writeDb(db);
      return ok(res, { caseId: id }, nextStatus === 3 ? '风险已复核关闭' : '整改任务已更新');
    }

    if (req.method === 'GET' && resource === 'employees' && !id) {
      return ok(res, listEmployees(db, url.searchParams));
    }

    if (req.method === 'GET' && resource === 'employees' && id && !action) {
      const detail = getEmployeeDetail(db, id, {
        showSensitive: url.searchParams.get('showSensitive') === '1'
      });
      if (!detail) return fail(res, 404, '员工不存在');
      return ok(res, detail);
    }

    if (req.method === 'POST' && resource === 'employees' && !id) {
      const body = await parseBody(req);
      const error = validateEmployeeInput(db, body);
      if (error) return fail(res, 400, error);

      const employeeId = nextId(db, 'employee');
      db.employees.push({
        id: employeeId,
        companyId: 1,
        employeeNo: buildInternalEmployeeNo(),
        customerId: Number(body.customerId || 0),
        name: body.name,
        gender: Number(body.gender || 0),
        idCardNo: body.idCardNo,
        phone: body.phone,
        education: body.education || '',
        bankName: body.bankName || '',
        bankCardNo: body.bankCardNo || '',
        emergencyContact: body.emergencyContact || '',
        emergencyPhone: body.emergencyPhone || '',
        employeeStatus: Number(body.employeeStatus || 2),
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      });
      db.jobs.push({
        id: nextId(db, 'job'),
        companyId: 1,
        employeeId,
        deptId: Number(body.deptId),
        positionId: Number(body.positionId),
        employmentType: Number(body.employmentType),
        workType: Number(body.workType),
        hireDate: body.hireDate,
        regularDate: body.regularDate || '',
        directLeaderId: Number(body.directLeaderId || 0),
        jobStatus: 1,
        remark: body.remark || ''
      });
      addLog(db, '员工花名册', 'create', employeeId, `新增员工：${body.name}`);
      scanRisks(db);
      writeDb(db);
      return ok(res, { employeeId }, '新增成功');
    }

    if (req.method === 'PUT' && resource === 'employees' && id && !action) {
      const body = await parseBody(req);
      const employee = db.employees.find(item => item.id === id && !item.deletedAt);
      if (!employee) return fail(res, 404, '员工不存在');
      const error = validateEmployeeInput(db, body, id);
      if (error) return fail(res, 400, error);

      Object.assign(employee, {
        name: body.name,
        customerId: Number(body.customerId || employee.customerId || 0),
        gender: Number(body.gender || 0),
        idCardNo: body.idCardNo,
        phone: body.phone,
        education: body.education || '',
        bankName: body.bankName || '',
        bankCardNo: body.bankCardNo || '',
        emergencyContact: body.emergencyContact || '',
        emergencyPhone: body.emergencyPhone || '',
        updatedAt: now()
      });
      const job = db.jobs.find(item => item.employeeId === id && item.jobStatus === 1);
      if (job) {
        Object.assign(job, {
          deptId: Number(body.deptId),
          positionId: Number(body.positionId),
          employmentType: Number(body.employmentType),
          workType: Number(body.workType),
          hireDate: body.hireDate
        });
      }
      addLog(db, '员工花名册', 'update', id, `编辑员工：${body.name}`);
      scanRisks(db);
      writeDb(db);
      return ok(res, { employeeId: id }, '保存成功');
    }

    if (req.method === 'POST' && resource === 'employees' && id && action === 'job-transfer') {
      const body = await parseBody(req);
      const employee = db.employees.find(item => item.id === id && !item.deletedAt);
      if (!employee) return fail(res, 404, '员工不存在');
      if (employee.employeeStatus === 3) return fail(res, 400, '离职员工不能调岗');
      if (!body.newDeptId || !body.newPositionId || !body.effectiveDate) return fail(res, 400, '请完整填写调岗信息');
      const currentJob = db.jobs.find(item => item.employeeId === id && item.jobStatus === 1);
      if (!currentJob) return fail(res, 400, '当前任职记录不存在');

      currentJob.jobStatus = 2;
      db.jobs.push({
        ...currentJob,
        id: nextId(db, 'job'),
        deptId: Number(body.newDeptId),
        positionId: Number(body.newPositionId),
        directLeaderId: Number(body.directLeaderId || 0),
        hireDate: body.effectiveDate,
        jobStatus: 1,
        remark: body.remark || ''
      });
      employee.updatedAt = now();
      addLog(db, '员工调岗', 'transfer', id, body.remark || '员工调岗');
      scanRisks(db);
      writeDb(db);
      return ok(res, { employeeId: id }, '调岗成功');
    }

    if (req.method === 'POST' && resource === 'employees' && id && action === 'resign') {
      const body = await parseBody(req);
      const employee = db.employees.find(item => item.id === id && !item.deletedAt);
      if (!employee) return fail(res, 404, '员工不存在');
      if (employee.employeeStatus === 3) return fail(res, 400, '员工已离职，不能重复办理');
      if (!body.leaveDate || !body.leaveType || !body.leaveReason) return fail(res, 400, '请完整填写离职信息');
      const currentJob = db.jobs.find(item => item.employeeId === id && item.jobStatus === 1);
      if (currentJob && body.leaveDate < currentJob.hireDate) return fail(res, 400, '离职日期不能早于入职日期');

      const resignationId = nextId(db, 'resignation');
      db.resignations.push({
        id: resignationId,
        companyId: 1,
        employeeId: id,
        applyDate: body.applyDate || '',
        leaveDate: body.leaveDate,
        leaveType: Number(body.leaveType),
        leaveReason: body.leaveReason,
        handoverStatus: Number(body.handoverStatus || 0),
        settlementStatus: Number(body.settlementStatus || 0),
        riskRemark: body.riskRemark || '',
        createdAt: now()
      });
      employee.employeeStatus = 3;
      employee.updatedAt = now();
      if (currentJob) currentJob.jobStatus = 2;
      createRiskIfNotExists(db, {
        employeeId: id,
        riskType: 6,
        riskLevel: 2,
        riskTitle: '离职社保停保提醒',
        riskDesc: `${employee.name}已办理离职，请确认当月社保停保和工资结算`,
        riskKey: `resign_followup:${resignationId}`
      });
      addLog(db, '员工离职', 'resign', resignationId, body.leaveReason);
      writeDb(db);
      return ok(res, { employeeId: id, resignationId }, '离职办理成功');
    }

    if (req.method === 'POST' && resource === 'employees' && id && action === 'contracts') {
      const body = await parseBody(req);
      const employee = db.employees.find(item => item.id === id && !item.deletedAt);
      if (!employee) return fail(res, 404, '员工不存在');
      if (!body.contractNo || !body.contractType || !body.startDate) return fail(res, 400, '请完整填写合同信息');
      if (body.endDate && body.endDate < body.startDate) return fail(res, 400, '合同结束日期不能早于开始日期');

      const contractId = nextId(db, 'contract');
      db.contracts.push({
        id: contractId,
        companyId: 1,
        employeeId: id,
        contractNo: body.contractNo,
        contractType: Number(body.contractType),
        signStatus: Number(body.signStatus || 0),
        signDate: body.signDate || '',
        startDate: body.startDate,
        endDate: body.endDate || '',
        renewalCount: Number(body.renewalCount || 0)
      });
      addLog(db, '合同管理', 'create', contractId, `登记合同：${body.contractNo}`);
      scanRisks(db);
      writeDb(db);
      return ok(res, { employeeId: id, contractId }, '合同已登记');
    }

    if (req.method === 'PUT' && resource === 'employees' && id && action === 'social-security') {
      const body = await parseBody(req);
      const employee = db.employees.find(item => item.id === id && !item.deletedAt);
      if (!employee) return fail(res, 404, '员工不存在');

      let social = db.socials.find(item => item.employeeId === id);
      if (!social) {
        social = { id: nextId(db, 'social'), companyId: 1, employeeId: id };
        db.socials.push(social);
      }
      Object.assign(social, {
        socialStatus: Number(body.socialStatus || 0),
        socialCity: body.socialCity || '',
        socialBase: Number(body.socialBase || 0),
        fundStatus: Number(body.fundStatus || 0),
        fundBase: Number(body.fundBase || 0),
        startMonth: body.startMonth || '',
        stopMonth: body.stopMonth || '',
        supplierName: body.supplierName || '',
        remark: body.remark || ''
      });
      addLog(db, '社保公积金', 'upsert', social.id, `维护员工ID：${id}`);
      scanRisks(db);
      writeDb(db);
      return ok(res, { employeeId: id, socialId: social.id }, '社保信息已保存');
    }

    if (req.method === 'POST' && resource === 'employees' && id && action === 'certificates') {
      const body = await parseBody(req);
      const employee = db.employees.find(item => item.id === id && !item.deletedAt);
      if (!employee) return fail(res, 404, '员工不存在');
      if (!body.certType) return fail(res, 400, '证件类型不能为空');
      if (body.expireDate && body.issueDate && body.expireDate < body.issueDate) return fail(res, 400, '证件到期日期不能早于发证日期');

      const certificateId = nextId(db, 'certificate');
      db.certificates.push({
        id: certificateId,
        companyId: 1,
        employeeId: id,
        certType: Number(body.certType),
        certNo: body.certNo || '',
        issueDate: body.issueDate || '',
        expireDate: body.expireDate || '',
        verifyStatus: Number(body.verifyStatus || 0)
      });
      addLog(db, '证件资料', 'create', certificateId, `维护员工ID：${id}`);
      scanRisks(db);
      writeDb(db);
      return ok(res, { employeeId: id, certificateId }, '证件已添加');
    }

    if (req.method === 'GET' && resource === 'risk-alerts') {
      const rows = db.risks
        .map(item => {
          const employee = db.employees.find(emp => emp.id === item.employeeId);
          const riskCase = db.riskCases.find(caseItem => caseItem.sourceAlertId === item.id && caseItem.status !== 3);
          return { ...formatRisk(item), employeeName: employee?.name || '', employeeNo: employee?.employeeNo || '', riskCaseId: riskCase?.id || 0 };
        })
        .sort((a, b) => b.id - a.id);
      return ok(res, rows);
    }

    if (req.method === 'POST' && resource === 'risk-alerts' && segments[2] === 'scan') {
      const created = scanRisks(db);
      writeDb(db);
      return ok(res, { created }, `风险扫描完成，新增${created}条`);
    }

    if (req.method === 'PUT' && resource === 'risk-alerts' && id && action === 'handle') {
      const body = await parseBody(req);
      const risk = db.risks.find(item => item.id === id);
      if (!risk) return fail(res, 404, '风险不存在');
      risk.handleStatus = Number(body.handleStatus);
      risk.handleRemark = body.handleRemark || '';
      risk.handleTime = now();
      risk.updatedAt = now();
      addLog(db, '风险预警', 'handle', id, risk.handleRemark);
      writeDb(db);
      return ok(res, { riskId: id }, '风险已更新');
    }

    if (req.method === 'GET' && url.pathname === '/api/export/employees.csv') {
      const rows = listEmployees(db, url.searchParams).list;
      const header = ['工号', '姓名', '手机号', '部门', '岗位', '用工类型', '工资类型', '入职日期', '合同状态', '社保状态', '风险数', '员工状态'];
      const lines = [header.join(',')].concat(
        rows.map(row =>
          [
            row.employeeNo,
            row.name,
            row.phone,
            row.deptName,
            row.positionName,
            row.employmentTypeName,
            row.workTypeName,
            row.hireDate,
            row.contractStatusName,
            row.socialStatusName,
            row.riskCount,
            row.employeeStatusName
          ]
            .map(value => `"${String(value ?? '').replace(/"/g, '""')}"`)
            .join(',')
        )
      );
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="employees.csv"'
      });
      return res.end(`\uFEFF${lines.join('\n')}`);
    }

    return fail(res, 404, '接口不存在');
  } catch (error) {
    return fail(res, 500, error.message || '服务器错误');
  }
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return fail(res, 403, '禁止访问');

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackError, fallbackContent) => {
        if (fallbackError) return fail(res, 404, '页面不存在');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fallbackContent);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

ensureData();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`优益数字化管理系统已启动：http://localhost:${PORT}`);
});
