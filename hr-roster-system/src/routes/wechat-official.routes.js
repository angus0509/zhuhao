const express = require('express');
const controller = require('../controllers/wechat-official.controller');
const { requireAuth, requireEmployeeAccount, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();
router.get('/wechat/official/bind-url', requireAuth, requireEmployeeAccount, controller.bindUrl);
router.get('/wechat/official/callback', controller.callback);
router.get('/wechat/official/bind-status', requireAuth, requireEmployeeAccount, controller.status);
router.post('/wechat/official/unbind', requireAuth, requireEmployeeAccount, controller.unbind);
router.get('/wechat/official/notifications', requireAuth, requirePermission('payroll:manage'), controller.listNotifications);
module.exports = router;
