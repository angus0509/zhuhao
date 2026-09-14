const express = require('express');
const controller = require('../controllers/attendance.controller');
const { requireAuth, requireEmployeeAccount, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();
router.get('/employee/attendance/month', requireAuth, requireEmployeeAccount, controller.employeeMonth);
router.get('/employee/attendance/today', requireAuth, requireEmployeeAccount, controller.employeeToday);
router.post('/employee/attendance/punch', requireAuth, requireEmployeeAccount, controller.punch);
router.post('/employee/attendance/corrections', requireAuth, requireEmployeeAccount, controller.createCorrection);
router.put('/attendance/corrections/:id/review', requireAuth, requirePermission('attendance:review'), controller.reviewCorrection);
router.get('/attendance/daily', requireAuth, requirePermission('attendance:view'), controller.daily);
router.get('/attendance/monthly', requireAuth, requirePermission('attendance:view'), controller.monthly);

module.exports = router;
