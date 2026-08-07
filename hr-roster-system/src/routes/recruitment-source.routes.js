const express = require('express');
const controller = require('../controllers/recruitment-source.controller');
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();
router.use(requireAuth);

router.get('/recruitment-channels', requirePermission('employee:view'), controller.listChannels);
router.get('/recruitment-channels/:id/employees', requirePermission('employee:view'), controller.listChannelEmployees);
router.post('/recruitment-channels', requirePermission('employee:create'), controller.createChannel);
router.put('/recruitment-channels/:id', requirePermission('employee:update'), controller.updateChannel);
router.get('/recruiters', requirePermission('employee:view'), controller.listRecruiters);
router.post('/recruiters', requirePermission('employee:create'), controller.createRecruiter);
router.put('/recruiters/:id', requirePermission('employee:update'), controller.updateRecruiter);
router.get('/recruitment-suppliers', requirePermission('employee:view'), controller.listSuppliers);
router.post('/recruitment-suppliers', requirePermission('employee:create'), controller.createSupplier);
router.put('/recruitment-suppliers/:id', requirePermission('employee:update'), controller.updateSupplier);

module.exports = router;
