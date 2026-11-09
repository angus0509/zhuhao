const router = require('express').Router();
const controller = require('../controllers/mobile-manager.controller');
const {
  requireAuth,
  requireManagerAccount,
  requirePermission
} = require('../middlewares/auth.middleware');

router.use('/mobile/manager', requireAuth, requireManagerAccount);
router.get('/mobile/manager/overview', controller.overview);
router.get('/mobile/manager/payslip-status',
  requirePermission('payroll:view'), controller.payslipStatus);

module.exports = router;
