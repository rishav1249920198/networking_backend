const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// GET /api/admin/stats
router.get('/stats', authenticate, requireRole('super_admin', 'admin', 'co-admin', 'centre_admin'), async (req, res) => {
  const { centre_id, role } = req.user;
  const centreFilter = role !== 'super_admin' ? ` AND centre_id = '${centre_id}'` : '';
  const admFilter = role !== 'super_admin' ? ` AND a.centre_id = '${centre_id}'` : '';
  const userFilter = role !== 'super_admin' ? ` AND u.centre_id = '${centre_id}'` : '';

  try {
    const [admStats, commStats, userStats] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*) AS total,
          COUNT(CASE WHEN status='pending' THEN 1 END) AS pending,
          COUNT(CASE WHEN status='approved' THEN 1 END) AS approved,
          COUNT(CASE WHEN status='rejected' THEN 1 END) AS rejected
         FROM admissions a WHERE 1=1 ${admFilter}`
      ),
      pool.query(
        `SELECT
          COALESCE(SUM(amount), 0) AS total_commissions
         FROM commissions WHERE 1=1 ${centreFilter}`
      ),
      pool.query(
        `SELECT COUNT(*) AS total_students
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'student' ${userFilter}`
      )
    ]);

    return res.json({
      success: true,
      total_students: parseInt(userStats.rows[0].total_students) || 0,
      total_admissions: parseInt(admStats.rows[0].total) || 0,
      pending_admissions: parseInt(admStats.rows[0].pending) || 0,
      approved_admissions: parseInt(admStats.rows[0].approved) || 0,
      total_commissions: parseFloat(commStats.rows[0].total_commissions) || 0
    });
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin stats.' });
  }
});

module.exports = router;
