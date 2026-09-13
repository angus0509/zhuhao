const express = require('express');
const controller = require('../controllers/employee.controller');
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware');
const { sensitiveLimiter, batchLimiter } = require('../middlewares/rate-limit.middleware');

const router = express.Router();

// 已认证用户访问历史合同/雇主险写接口时统一返回停用提示，不再进入权限与业务写入逻辑。
const featureDisabled = (_req, res) => res.status(410).json({ code: 410, message: '功能已停用', data: null });

router.use(requireAuth);

router.get('/bootstrap', requirePermission('employee:view'), controller.bootstrap);
router.get('/summary', requirePermission('employee:view'), controller.summary);
router.get('/employees/onsite-overview', requirePermission('employee:view'), controller.onsiteOverview);
router.get('/employees', requirePermission('employee:view'), controller.list);
router.get('/employees/mine', requirePermission('employee:view'), controller.listMine);
router.post('/employees/precheck', sensitiveLimiter, requirePermission('employee:create'), controller.precheck);
router.post('/employees', sensitiveLimiter, requirePermission('employee:create'), controller.create);
router.post('/employees/batch', batchLimiter, requirePermission('employee:batch'), controller.batchCreate);
router.get('/employees/:id', requirePermission('employee:view'), controller.detail);
router.put('/employees/:id', requirePermission('employee:update'), controller.update);
router.post('/employees/:id/reactivate', sensitiveLimiter, requirePermission('employee:update'), controller.reactivate);
router.post('/employees/:id/bind-code', sensitiveLimiter, requirePermission('employee:update'), controller.createBindCode);
router.put('/employees/:id/interview-result', sensitiveLimiter, requirePermission('employee:update'), controller.handleInterviewResult);
router.put('/employees/:id/arrival-result', sensitiveLimiter, requirePermission('employee:update'), controller.handleArrivalResult);
router.post('/employees/:id/onboard', sensitiveLimiter, requirePermission('employee:update'), controller.onboard);
router.post('/employees/:id/onboarding-compliance/confirm', sensitiveLimiter, featureDisabled);
router.post('/employees/:id/job-transfer', requirePermission('employee:transfer'), controller.transferJob);
router.put('/employee-transfers/:changeId/handle', requirePermission('employee:transfer'), controller.handleTransfer);
router.post('/employees/:id/resign', sensitiveLimiter, requirePermission('employee:resign'), controller.resign);
router.put(
  '/resignations/:resignationId/progress',
  requirePermission('employee:resign'),
  controller.updateResignationProgress
);
router.post('/employees/:id/contracts', featureDisabled);
router.put('/employees/:id/social-security', sensitiveLimiter, featureDisabled);
router.post('/employees/:id/certificates', requirePermission('cert:manage'), controller.createCertificate);
router.get('/export/employees.csv', requirePermission('employee:export'), controller.exportCsv);
router.get('/export/employees.xlsx', sensitiveLimiter, requirePermission('employee:export'), controller.exportExcel);

module.exports = router;
