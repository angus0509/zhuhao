const express = require('express');
const controller = require('../controllers/attendance.controller');
const { requireAuth, requireEmployeeAccount, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();
router.get('/employee/attendance/month', requireAuth, requireEmployeeAccount, controller.employeeMonth);
router.get('/attendance/daily', requireAuth, requirePermission('attendance:view'), controller.daily);
router.get('/attendance/monthly', requireAuth, requirePermission('attendance:view'), controller.monthly);

module.exports = router;
