const express = require('express');
const controller = require('../controllers/payslip.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { sensitiveLimiter } = require('../middlewares/rate-limit.middleware');

const router = express.Router();
router.use(requireAuth);

router.get('/me/payslips', controller.listMine);
router.get('/me/payslips/:id', controller.detailMine);
router.post('/me/payslips/:id/receipt', sensitiveLimiter, controller.receiptMine);

module.exports = router;
