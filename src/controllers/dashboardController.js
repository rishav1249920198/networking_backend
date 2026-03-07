const pool = require('../config/db');

// GET /api/dashboard/student
const getStudentDashboard = async (req, res) => {
  const userId = req.user.id;
  try {
    const [referrals, commissions, admissions] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*) AS total,
          COUNT(CASE WHEN a.status='pending' THEN 1 END) AS pending,
          COUNT(CASE WHEN a.status='approved' THEN 1 END) AS approved,
          COUNT(CASE WHEN a.status='rejected' THEN 1 END) AS rejected
         FROM users u
         LEFT JOIN admissions a ON a.student_id = u.id
         WHERE u.referred_by = $1`,
        [userId]
      ),
      pool.query(
        `WITH comm_sums AS (
           SELECT COALESCE(SUM(amount), 0) AS total_earnings
           FROM commissions WHERE referrer_id = $1
         ),
         req_sums AS (
           SELECT 
             COALESCE(SUM(CASE WHEN status IN ('pending', 'approved') THEN amount END), 0) AS processing_earnings,
             COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid_earnings
           FROM withdrawal_requests WHERE student_id = $1
         )
         SELECT
           c.total_earnings,
           r.processing_earnings,
           r.paid_earnings,
           (c.total_earnings - r.processing_earnings - r.paid_earnings) AS pending_earnings
         FROM comm_sums c CROSS JOIN req_sums r`,
        [userId]
      ),
      pool.query(
        `SELECT a.id, a.status, a.snapshot_fee, a.created_at, co.name AS course
         FROM admissions a JOIN courses co ON co.id = a.course_id
         WHERE a.student_id = $1 ORDER BY a.created_at DESC LIMIT 5`,
        [userId]
      ),
    ]);

    return res.json({
      success: true,
      data: {
        referrals: referrals.rows[0],
        earnings: commissions.rows[0],
        recentAdmissions: admissions.rows,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard.' });
  }
};

// GET /api/dashboard/admin
const getAdminDashboard = async (req, res) => {
  const { centre_id, role } = req.user;
  const centreFilter = role !== 'super_admin' ? `AND a.centre_id = '${centre_id}'` : '';

  try {
    const [admStats, commStats, userStats, recentAdm] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*) AS total,
          COUNT(CASE WHEN status='pending' THEN 1 END) AS pending,
          COUNT(CASE WHEN status='approved' THEN 1 END) AS approved,
          COUNT(CASE WHEN status='rejected' THEN 1 END) AS rejected
         FROM admissions a WHERE 1=1 ${centreFilter}`
      ),
      pool.query(
        `SELECT
          COALESCE(SUM(amount), 0) AS total_commissions,
          COUNT(*) AS total_count,
          COUNT(CASE WHEN status='pending' THEN 1 END) AS pending_count
         FROM commissions c WHERE 1=1 ${centreFilter.replace('a.', 'c.')}`
      ),
      pool.query(
        `SELECT COUNT(*) AS total_students
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'student' ${role !== 'super_admin' ? `AND u.centre_id = '${centre_id}'` : ''}`
      ),
      pool.query(
        `SELECT a.id, a.student_name, a.status, a.snapshot_fee, a.admission_mode,
                a.created_at, co.name AS course
         FROM admissions a JOIN courses co ON co.id = a.course_id
         WHERE 1=1 ${centreFilter}
         ORDER BY a.created_at DESC LIMIT 10`
      ),
    ]);

    // Monthly commission trend (last 6 months)
    const monthlyComm = await pool.query(
      `SELECT TO_CHAR(created_at, 'Mon') AS month,
              DATE_TRUNC('month', created_at) AS month_date,
              COALESCE(SUM(amount), 0) AS amount,
              COUNT(*) AS count
       FROM commissions
       WHERE created_at >= NOW() - INTERVAL '6 months'
       ${centreFilter.replace('a.', '').replace('centre_id', 'centre_id')}
       GROUP BY month, month_date ORDER BY month_date`
    );

    return res.json({
      success: true,
      data: {
        admissions: admStats.rows[0],
        commissions: commStats.rows[0],
        students: userStats.rows[0],
        recentAdmissions: recentAdm.rows,
        monthlyCommissions: monthlyComm.rows,
      },
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard.' });
  }
};

module.exports = { getStudentDashboard, getAdminDashboard };
