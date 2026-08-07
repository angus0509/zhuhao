const express = require('express');
const controller = require('../controllers/portal.controller');
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();
router.use(requireAuth);

router.get('/clients', requirePermission('customer:view'), controller.clients);
router.post('/clients', requirePermission('customer:manage'), requirePermission('project:manage'), controller.createClient);
router.get('/client-service-requests', requirePermission('customer:view'), controller.clientServices);
router.post('/client-service-requests', requirePermission('customer:manage'), controller.createClientService);
router.put('/client-service-requests/:id/status', requirePermission('customer:manage'), controller.updateClientServiceStatus);
router.get('/talents', requirePermission('employee:view'), controller.talents);
router.post('/talents', requirePermission('employee:create'), controller.createTalent);
router.get('/employment-records', requirePermission('employee:view'), controller.employmentRecords);
router.get('/audit-logs', requirePermission('audit:view'), controller.auditLogs);
router.get('/analytics/dashboard', requirePermission('employee:view'), controller.dashboard);

module.exports = router;
