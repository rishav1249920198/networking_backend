const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const DashboardService = require('../services/dashboardService');
const AdminController = require('../controllers/adminController');
const monitorAuth = require('../middleware/monitorAuth');

// GET /api/admin/stats
router.get('/stats', authenticate, requireRole('super_admin', 'centre_admin', 'co-admin'), async (req, res) => {
  try {
    const data = await DashboardService.getAdminStats(req.user);
    return res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin stats.' });
  }
});


// GET /api/admin/reports
router.get('/reports', authenticate, requireRole('super_admin', 'centre_admin'), async (req, res) => {
  try {
    const [topEarners, dailyPoints] = await Promise.all([
      pool.query(`
        SELECT u.full_name, u.system_id, pw.total_rupees as total_earned
        FROM points_wallet pw
        JOIN users u ON u.id = pw.user_id
        ORDER BY pw.total_rupees DESC LIMIT 10
      `),
      pool.query(`
        SELECT DATE_TRUNC('day', created_at) as day, SUM(points) as points
        FROM points_transactions
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY day ORDER BY day ASC
      `)
    ]);

    return res.json({
      success: true,
      top_earners: topEarners.rows,
      daily_points: dailyPoints.rows
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch reports.' });
  }
});

// GET /api/admin/metrics/expense (Dual Auth: Session OR API Key)
router.get('/metrics/expense', monitorAuth, AdminController.getExpenseMetrics);

// GET /api/admin/fraud/alerts (Dual Auth: Session OR API Key)
router.get('/fraud/alerts', monitorAuth, AdminController.getFraudAlerts);

// GET /api/admin/summary (Dual Auth: Session OR API Key)
router.get('/summary', monitorAuth, AdminController.getDailySummary);

// GET /api/admin/insights/forecast
router.get('/insights/forecast', authenticate, requireRole('super_admin', 'centre_admin', 'co-admin'), AdminController.getForecastInsights);

// GET /api/admin/export/users
router.get('/export/users', authenticate, requireRole('super_admin', 'centre_admin'), AdminController.exportUsersCSV);

// POST /api/admin/tree/retry/:userId
router.post('/tree/retry/:userId', authenticate, requireRole('super_admin', 'centre_admin'), async (req, res) => {
  const { userId } = req.params;
  const TreeEngine = require('../services/treeEngine');
  
  try {
    const userRes = await pool.query('SELECT referred_by FROM users WHERE id = $1', [userId]);
    if (userRes.rowCount === 0) return res.status(404).json({ success: false, message: 'User not found' });
    
    const result = await TreeEngine.placeUser(userId, userRes.rows[0].referred_by);
    if (result.success) {
      return res.json({ success: true, message: 'Placement retried successfully.' });
    } else {
      return res.status(400).json({ success: false, message: result.error });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Retry failed.' });
  }
});

/**
 * GET /api/admin/tree/pending
... (standard routes preserved)
 */
router.get('/tree/pending', authenticate, requireRole('super_admin', 'centre_admin'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, full_name, email, mobile, system_id, placement_attempts, created_at 
      FROM users 
      WHERE placement_status = 'pending'
      ORDER BY created_at DESC
    `);
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch pending placements.' });
  }
});

router.get('/tree/failed', authenticate, requireRole('super_admin', 'centre_admin'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, full_name, email, mobile, system_id, placement_attempts, created_at 
      FROM users 
      WHERE placement_status = 'failed'
      ORDER BY created_at DESC
    `);
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch failed placements.' });
  }
});

module.exports = router;
