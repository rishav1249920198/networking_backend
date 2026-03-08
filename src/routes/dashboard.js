const express = require('express');
const router = express.Router();
const { getStudentDashboard, getAdminDashboard } = require('../controllers/dashboardController');
const { authenticate, requireCoAdminOrAdmin, requireStudent } = require('../middleware/auth');

router.get('/student', authenticate, requireStudent, getStudentDashboard);
router.get('/admin', authenticate, requireCoAdminOrAdmin, getAdminDashboard);

module.exports = router;
