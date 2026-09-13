const express = require('express');
const controller = require('../controllers/sms.controller');
const { loginLimiter } = require('../middlewares/rate-limit.middleware');

const router = express.Router();

router.post('/auth/employee/sms-code', loginLimiter, controller.requestCode);
router.post('/auth/employee/sms-login', loginLimiter, controller.login);

module.exports = router;
