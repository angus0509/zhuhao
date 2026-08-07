const express = require('express');
const controller = require('../controllers/risk.controller');
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(requireAuth);

router.get('/risk-alerts', requirePermission('risk:view'), controller.list);
router.post('/risk-alerts/scan', requirePermission('risk:scan'), controller.scan);
router.put('/risk-alerts/:id/handle', requirePermission('risk:handle'), controller.handle);
router.get('/risk-cases', requirePermission('risk:view'), controller.listCases);
router.post('/risk-cases', requirePermission('risk:handle'), controller.createCase);
router.put('/risk-cases/:id', requirePermission('risk:handle'), controller.updateCase);

module.exports = router;
