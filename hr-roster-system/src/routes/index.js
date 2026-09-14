const express = require('express');
const authRoutes = require('./auth.routes');
const employeeAuthRoutes = require('./employee-auth.routes');
const employeeRoutes = require('./employee.routes');
const riskRoutes = require('./risk.routes');
const operationsRoutes = require('./operations.routes');
const portalRoutes = require('./portal.routes');
const systemRoutes = require('./system.routes');
const ocrRoutes = require('./ocr.routes');
const attachmentRoutes = require('./attachment.routes');
const recruitmentSourceRoutes = require('./recruitment-source.routes');
const workTaskRoutes = require('./work-task.routes');
const payslipRoutes = require('./payslip.routes');
const smsRoutes = require('./sms.routes');
const wechatOfficialRoutes = require('./wechat-official.routes');
const attendanceRoutes = require('./attendance.routes');

const router = express.Router();

router.use(authRoutes);
router.use(employeeAuthRoutes);
router.use(smsRoutes);
router.use(wechatOfficialRoutes);
router.use(attendanceRoutes);
router.use(employeeRoutes);
router.use(riskRoutes);
router.use(operationsRoutes);
router.use(portalRoutes);
router.use(systemRoutes);
router.use(ocrRoutes);
router.use(attachmentRoutes);
router.use(recruitmentSourceRoutes);
router.use(workTaskRoutes);
router.use(payslipRoutes);

module.exports = router;
