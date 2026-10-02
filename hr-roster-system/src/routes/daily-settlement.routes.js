const express = require('express');
const controller = require('../controllers/daily-settlement.controller');
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware');
const { sensitiveLimiter, batchLimiter } = require('../middlewares/rate-limit.middleware');

const router = express.Router();
router.get('/wage-daily-settlements/projects', requireAuth, requirePermission('payroll:view'), controller.projects);
router.post('/wage-daily-settlements/preview', sensitiveLimiter, requireAuth, requirePermission('payroll:manage'), controller.createPreview);
router.get('/wage-daily-settlements', requireAuth, requirePermission('payroll:view'), controller.list);
router.post('/wage-daily-settlements/batch-confirm', batchLimiter, requireAuth, requirePermission('payroll:manage'), controller.confirmBatch);
router.post('/wage-daily-settlements/:id/revoke', sensitiveLimiter, requireAuth, requirePermission('payroll:manage'), controller.revoke);
router.get('/wage-daily-settlements/:id/events', requireAuth, requirePermission('payroll:view'), controller.events);

module.exports = router;
