const express = require('express');
const controller = require('../controllers/ocr.controller');
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(requireAuth);

router.post('/ocr/idcard', requirePermission('employee:create'), controller.idcard);

module.exports = router;
