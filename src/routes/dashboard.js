const express = require('express');
const router = express.Router();
const { 
  getUnifiedDashboard, 
  getEarningsBreakdown, 
  getEarningsChart, 
  getEarningsHistory,
  getStudentDashboard, 
  getAdminDashboard 
} = require('../controllers/dashboardController');
const { authenticate, requireCoAdminOrAdmin, requireStudent } = require('../middleware/auth');

router.get('/', authenticate, requireStudent, getUnifiedDashboard); // GET /api/dashboard
router.get('/earnings', authenticate, requireStudent, getEarningsBreakdown);
router.get('/earnings/chart', authenticate, requireStudent, getEarningsChart);
router.get('/earnings/history', authenticate, requireStudent, getEarningsHistory);
router.get('/student', authenticate, requireStudent, getStudentDashboard);
router.get('/admin', authenticate, requireCoAdminOrAdmin, getAdminDashboard);


module.exports = router;
