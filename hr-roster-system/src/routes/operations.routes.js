const express = require('express');
const controller = require('../controllers/operations.controller');
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware');
const { sensitiveLimiter, batchLimiter } = require('../middlewares/rate-limit.middleware');

const router = express.Router();
router.use(requireAuth);

router.get('/customers', requirePermission('customer:view'), controller.listCustomers);
router.post('/customers', requirePermission('customer:manage'), requirePermission('project:manage'), controller.createCustomer);
router.get('/customers/:id', requirePermission('customer:view'), requirePermission('project:view'), controller.getCustomerDetail);
router.put('/customers/:id', requirePermission('customer:manage'), requirePermission('project:manage'), controller.updateCustomerPortfolio);
router.get('/projects', requirePermission('project:view'), controller.listProjects);
router.post('/projects', requirePermission('project:manage'), controller.createProject);
router.get('/factory-staff', requirePermission('factory:view'), controller.listFactoryStaff);
router.post('/factory-staff', requirePermission('factory:manage'), controller.createFactoryStaff);
router.get('/blacklist', requirePermission('blacklist:view'), controller.listBlacklist);
router.post('/blacklist', requirePermission('blacklist:manage'), controller.createBlacklist);
router.post('/blacklist/batch', batchLimiter, requirePermission('blacklist:manage'), controller.batchCreateBlacklist);
router.get('/advances', requirePermission('advance:view'), controller.listAdvances);
router.post('/advances', sensitiveLimiter, requirePermission('advance:create'), controller.createAdvance);
router.put('/advances/:id/approve', sensitiveLimiter, requirePermission('advance:approve'), controller.approveAdvance);
router.put('/advances/:id/pay', sensitiveLimiter, requirePermission('advance:pay'), controller.payAdvance);
router.get('/payroll/overview', requirePermission('payroll:view'), controller.payrollOverview);
router.post('/payroll/batches', sensitiveLimiter, requirePermission('payroll:manage'), controller.createPayrollBatch);
router.put('/payroll/batches/:id/submit', requirePermission('payroll:manage'), controller.submitPayrollBatch);
router.put('/payroll/batches/:id/review', requirePermission('payroll:review'), controller.reviewPayrollBatch);
router.put('/payroll/batches/:id/publish', sensitiveLimiter, requirePermission('payroll:manage'), controller.publishPayrollBatch);
router.get('/operations/home', requirePermission('employee:view'), controller.operationsHome);
router.get('/notices', requirePermission('employee:view'), controller.listNotices);
router.get('/permissions/overview', requirePermission('system:role'), controller.permissionOverview);

module.exports = router;
