const express = require('express');
const controller = require('../controllers/work-task.controller');
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();
router.use(requireAuth);

router.get('/work-tasks', requirePermission('employee:view'), controller.list);
router.put('/work-tasks/:id/start', requirePermission('employee:update'), controller.start);
router.put('/work-tasks/:id/complete', requirePermission('employee:update'), controller.complete);

module.exports = router;
