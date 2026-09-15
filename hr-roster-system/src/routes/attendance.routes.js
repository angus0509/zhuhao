const express = require('express');
const controller = require('../controllers/attendance.controller');
const { requireAuth, requireEmployeeAccount, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();
router.get('/employee/attendance/month', requireAuth, requireEmployeeAccount, controller.employeeMonth);
router.get('/employee/attendance/today', requireAuth, requireEmployeeAccount, controller.employeeToday);
router.post('/employee/attendance/punch', requireAuth, requireEmployeeAccount, controller.punch);
router.post('/employee/attendance/corrections', requireAuth, requireEmployeeAccount, controller.createCorrection);
router.get('/attendance/corrections', requireAuth, requirePermission('attendance:review'), controller.listCorrections);
router.put('/attendance/corrections/:id/review', requireAuth, requirePermission('attendance:review'), controller.reviewCorrection);
router.post('/attendance/shift-rules', requireAuth, requirePermission('attendance:manage'), controller.createShiftRule);
router.put('/attendance/schedules', requireAuth, requirePermission('attendance:manage'), controller.upsertSchedule);
router.get('/payroll/attendance-summary', requireAuth, requirePermission('payroll:view'), controller.payrollSummary);
router.get('/attendance/geofences', requireAuth, requirePermission('attendance:view'), controller.listGeofences);
router.post('/attendance/geofences', requireAuth, requirePermission('attendance:manage'), controller.createGeofence);
router.put('/attendance/geofences/:id', requireAuth, requirePermission('attendance:manage'), controller.updateGeofence);
router.get('/attendance/daily', requireAuth, requirePermission('attendance:view'), controller.daily);
router.get('/attendance/monthly', requireAuth, requirePermission('attendance:view'), controller.monthly);

module.exports = router;
