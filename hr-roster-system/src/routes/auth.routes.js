const express = require('express');
const controller = require('../controllers/auth.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { loginLimiter, sensitiveLimiter } = require('../middlewares/rate-limit.middleware');

const router = express.Router();

router.post('/auth/login', loginLimiter, controller.login);
router.post('/auth/logout', controller.logout);
router.get('/auth/me', requireAuth, controller.me);
router.put('/auth/password', requireAuth, sensitiveLimiter, controller.changePassword);

module.exports = router;
