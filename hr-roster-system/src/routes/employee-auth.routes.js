const express = require('express');
const controller = require('../controllers/employee-auth.controller');
const { requireAuth, requireEmployeeAccount } = require('../middlewares/auth.middleware');
const { loginLimiter } = require('../middlewares/rate-limit.middleware');

const router = express.Router();

router.post('/auth/employee/wechat-login', loginLimiter, controller.startWechatLogin);
router.post('/auth/employee/bind-phone', loginLimiter, controller.bindByPhone);
router.post('/auth/employee/bind-code', loginLimiter, controller.bindByCode);
router.get('/me/profile', requireAuth, requireEmployeeAccount, controller.profile);

module.exports = router;
