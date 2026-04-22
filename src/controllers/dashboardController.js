const DashboardService = require('../services/dashboardService');
const PointsService = require('../services/pointsService');
const pool = require('../config/db');

// New Unified Dashboard Endpoint (Fix #2)
const getUnifiedDashboard = async (req, res) => {
  try {
    const stats = await DashboardService.getStudentStats(req.user.id);
    return res.json({ success: true, ...stats });
  } catch (err) {
    console.error('Unified Dashboard Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats.' });
  }
};

// GET /api/earnings (Fix #3)
const getEarningsBreakdown = async (req, res) => {
  try {
    const breakdown = await PointsService.getEarningsBreakdown(req.user.id);
    return res.json({ success: true, ...breakdown });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch earnings breakdown.' });
  }
};

// GET /api/earnings/chart (Fix #7)
const getEarningsChart = async (req, res) => {
  try {
    const chartData = await PointsService.getChartData(req.user.id);
    return res.json({ success: true, data: chartData });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch chart data.' });
  }
};

// GET /api/dashboard/earnings/history (Fix #9)
const getEarningsHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const history = await PointsService.getEarningsHistory(req.user.id, parseInt(page), parseInt(limit));
    return res.json({ success: true, ...history });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch earnings history.' });
  }
};

// Maintain compatibility for now or refactor StudentDashboard to use these
const getStudentDashboard = async (req, res) => {
  const userId = req.user.id;
  try {
    const [stats, breakdown, chart, admissions] = await Promise.all([
      DashboardService.getStudentStats(userId),
      PointsService.getEarningsBreakdown(userId),
      PointsService.getChartData(userId),
      pool.query(`
        SELECT a.id, a.status, a.snapshot_fee, a.created_at, co.name AS course
        FROM admissions a JOIN courses co ON co.id = a.course_id
        WHERE a.student_id = $1 ORDER BY a.created_at DESC LIMIT 10
      `, [userId])
    ]);

    return res.json({
      success: true,
      data: {
        stats,
        breakdown,
        chart,
        recentAdmissions: admissions.rows
      }
    });
  } catch (err) {
    console.error('getStudentDashboard error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard.' });
  }
};

// Admin dashboard (Unchanged for now as focus is student alignment)
const getAdminDashboard = async (req, res) => {
  try {
    const [adminData, recentAdm, topEarners, trendData] = await Promise.all([
      DashboardService.getAdminStats(req.user),
      pool.query(`
        SELECT a.id, a.student_name, a.status, a.snapshot_fee, a.admission_mode, a.created_at, co.name AS course_name 
        FROM admissions a 
        JOIN courses co ON co.id = a.course_id 
        WHERE 1=1 ${req.user.role !== 'super_admin' ? ` AND a.centre_id = '${req.user.centre_id}'` : ''} 
        ORDER BY a.created_at DESC LIMIT 10
      `),
      DashboardService.getTopUsers(5),
      DashboardService.getTrendData()
    ]);

    return res.json({
      success: true,
      data: {
        ...adminData,
        recentAdmissions: recentAdm.rows,
        topEarners,
        trendData
      }
    });

  } catch (err) {
    console.error('getAdminDashboard error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin dashboard.' });
  }
};

module.exports = { 
  getUnifiedDashboard, 
  getEarningsBreakdown, 
  getEarningsChart, 
  getEarningsHistory,
  getStudentDashboard, 
  getAdminDashboard 
};
