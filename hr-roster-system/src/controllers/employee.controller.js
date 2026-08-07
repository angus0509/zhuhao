const employeeService = require('../services/employee.service');
const { success, asyncHandler, createError } = require('../utils/response');
const attachmentService = require('../services/attachment.service');

exports.bootstrap = asyncHandler(async (req, res) => {
  const data = await employeeService.getBootstrap(req.companyId, req.user);
  success(res, {
    dictionaries: require('../utils/dictionaries').dictionaries,
    ...data
  });
});

exports.summary = asyncHandler(async (req, res) => {
  const data = await employeeService.getSummary(req.companyId, req.user);
  success(res, data);
});

exports.precheck = asyncHandler(async (req, res) => {
  const data = await employeeService.precheckEmployee(req.companyId, req.body);
  success(res, data, data.allowOnboarding ? '预检查通过' : '存在入职限制');
});

exports.list = asyncHandler(async (req, res) => {
  const data = await employeeService.listEmployees(req.companyId, req.query, req.user);
  success(res, data);
});

exports.listMine = asyncHandler(async (req, res) => {
  const data = await employeeService.listMyEmployees(req.companyId, req.user, req.query);
  success(res, data);
});

exports.detail = asyncHandler(async (req, res) => {
  const showSensitive = req.query.showSensitive === '1';
  if (showSensitive && !req.user.permissions.includes('employee:sensitive:view')) {
    throw createError('无敏感信息查看权限', 403);
  }
  const data = await employeeService.getEmployeeDetail(req.companyId, Number(req.params.id), {
    showSensitive,
    user: req.user
  });
  data.attachmentList = await attachmentService.listEmployeeAttachments(req.companyId, Number(req.params.id), req.user);
  if (showSensitive) {
    await employeeService.recordSensitiveAccess(
      req.companyId,
      Number(req.params.id),
      req.operatorId,
      req.query.reason || '编辑员工档案',
      req.ip
    );
  }
  success(res, data);
});

exports.create = asyncHandler(async (req, res) => {
  const data = await employeeService.createEmployee(req.companyId, req.body, req.operatorId, req.user);
  success(res, data, '新增成功');
});

exports.batchCreate = asyncHandler(async (req, res) => {
  const data = await employeeService.createEmployeesBatch(req.companyId, req.body.rows, req.operatorId, req.user);
  success(res, data, `批量录入完成：成功${data.successCount}人，失败${data.failureCount}人`);
});

exports.update = asyncHandler(async (req, res) => {
  const data = await employeeService.updateEmployee(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user);
  success(res, data, '保存成功');
});

exports.transferJob = asyncHandler(async (req, res) => {
  const data = await employeeService.transferJob(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user);
  success(res, data, '调岗成功');
});

exports.handleTransfer = asyncHandler(async (req, res) => {
  const approved = Number(req.body.approved) === 1 || req.body.approved === true;
  const data = await employeeService.handleTransfer(req.companyId, Number(req.params.changeId), approved, req.operatorId, req.user);
  success(res, data, approved ? '转岗已接收并生效' : '转岗已拒绝');
});

exports.onboard = asyncHandler(async (req, res) => {
  const data = await employeeService.onboardEmployee(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user);
  success(res, data, '入职确认成功');
});

exports.resign = asyncHandler(async (req, res) => {
  const data = await employeeService.resignEmployee(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user);
  success(res, data, '离职办理成功');
});

exports.updateResignationProgress = asyncHandler(async (req, res) => {
  const data = await employeeService.updateResignationProgress(
    req.companyId,
    Number(req.params.resignationId),
    req.body,
    req.operatorId,
    req.user
  );
  success(res, data, data.completed ? '离职流程已全部完成' : '离职进度已更新');
});

exports.createContract = asyncHandler(async (req, res) => {
  const data = await employeeService.createContract(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user);
  success(res, data, '合同已登记');
});

exports.updateSocialSecurity = asyncHandler(async (req, res) => {
  const data = await employeeService.updateSocialSecurity(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user);
  success(res, data, '雇主险增减已保存');
});

exports.createCertificate = asyncHandler(async (req, res) => {
  const data = await employeeService.createCertificate(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user);
  success(res, data, '证件已添加');
});

exports.exportCsv = asyncHandler(async (req, res) => {
  const result = await employeeService.exportEmployeesCsv(req.companyId, req.query, req.user, {
    operatorId: req.operatorId,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') || ''
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
  res.setHeader('X-Export-Record-Count', String(result.count));
  res.send(result.csv);
});

exports.exportExcel = asyncHandler(async (req, res) => {
  const result = await employeeService.exportEmployeesExcel(req.companyId, req.query, req.user, {
    operatorId: req.operatorId,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') || ''
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="employees.xlsx"');
  res.setHeader('X-Export-Record-Count', String(result.count));
  res.send(result.buffer);
});
