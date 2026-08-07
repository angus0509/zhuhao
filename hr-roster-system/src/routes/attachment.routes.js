const express = require('express');
const controller = require('../controllers/attachment.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { sensitiveLimiter } = require('../middlewares/rate-limit.middleware');
const { singleAttachment } = require('../middlewares/upload.middleware');

const router = express.Router();
router.use(requireAuth);

router.post('/attachments', sensitiveLimiter, singleAttachment, controller.upload);
router.get('/attachments', controller.list);
router.get('/attachments/:id/download', controller.download);

module.exports = router;
