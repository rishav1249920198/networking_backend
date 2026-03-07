const express = require('express');
const router = express.Router();
const { getStudentDashboard, getAdminDashboard } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.get('/student', authenticate, requireRole('student'), getStudentDashboard);
router.get('/admin', authenticate, requireRole('centre_admin', 'super_admin'), getAdminDashboard);

module.exports = router;
