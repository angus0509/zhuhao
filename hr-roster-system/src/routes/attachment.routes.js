const express = require('express');
const controller = require('../controllers/attachment.controller');
const { requireAuth, requireManagerAccount } = require('../middlewares/auth.middleware');
const { sensitiveLimiter } = require('../middlewares/rate-limit.middleware');
const { singleAttachment } = require('../middlewares/upload.middleware');

const router = express.Router();
router.use(requireAuth);
// 仅附件业务需要管理账号守卫。若在根路径全局挂载，会拦截同一 API
// 路由器中排在其后的员工本人接口（例如 /me/payslips）。
router.use('/attachments', requireManagerAccount);

router.post('/attachments', sensitiveLimiter, singleAttachment, controller.upload);
router.get('/attachments', controller.list);
router.get('/attachments/:id/download', controller.download);

module.exports = router;
