const express = require('express');
const controller = require('../controllers/payslip.controller');
const { requireAuth, requireEmployeeAccount } = require('../middlewares/auth.middleware');
const { sensitiveLimiter } = require('../middlewares/rate-limit.middleware');
const { singlePayslipSignature } = require('../middlewares/upload.middleware');

const router = express.Router();
router.use('/me/payslips', requireAuth, requireEmployeeAccount);

router.get('/me/payslips', controller.listMine);
router.get('/me/payslips/:id', controller.detailMine);
router.get('/me/payslips/:id/signature', controller.previewSignatureMine);
router.post('/me/payslips/:id/signature', sensitiveLimiter, singlePayslipSignature, controller.uploadSignatureMine);
router.post('/me/payslips/:id/receipt', sensitiveLimiter, controller.receiptMine);
router.post('/me/payslips/:id/dispute', sensitiveLimiter, controller.disputeMine);

module.exports = router;
