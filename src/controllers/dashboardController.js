const pool = require('../config/db');

// GET /api/dashboard/student
const getStudentDashboard = async (req, res) => {
  const userId = req.user.id;
  try {
    const [referrals, commissions, admissions] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(DISTINCT u.id) AS total,
          COUNT(DISTINCT CASE WHEN a.status='pending' THEN u.id END) AS pending,
          COUNT(DISTINCT CASE WHEN a.status='approved' THEN u.id END) AS approved,
          COUNT(DISTINCT CASE WHEN a.status='rejected' THEN u.id END) AS rejected
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
  const centreFilter = role !== 'super_admin' ? ` AND a.centre_id = '${centre_id}'` : '';

  try {
    const [admStats, commStats, userStats, recentAdm] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN status='pending' THEN 1 END)::int AS pending,
          COUNT(CASE WHEN status='approved' THEN 1 END)::int AS approved,
          COUNT(CASE WHEN status='rejected' THEN 1 END)::int AS rejected
         FROM admissions a WHERE 1=1 ${centreFilter}`
      ),
      pool.query(
        `SELECT
          COALESCE(SUM(amount), 0)::numeric AS total_commissions,
          COUNT(*)::int AS total_count,
          COUNT(CASE WHEN status='pending' THEN 1 END)::int AS pending_count
         FROM commissions c WHERE 1=1 ${centreFilter.replace(/a\./g, 'c.')}`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total_students
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'student' ${role !== 'super_admin' ? `AND u.centre_id = '${centre_id}'` : ''}`
      ),
      pool.query(
        `SELECT a.id, a.student_name, a.status, a.snapshot_fee, a.admission_mode,
                a.created_at, co.name AS course_name
         FROM admissions a JOIN courses co ON co.id = a.course_id
         WHERE 1=1 ${centreFilter}
         ORDER BY a.created_at DESC LIMIT 10`
      ),
    ]);

    // Monthly Margin Trend (Revenue vs Commission - last 6 months)
    const monthlyData = await pool.query(
      `WITH dates AS (
         SELECT generate_series(
           DATE_TRUNC('month', NOW() - INTERVAL '5 months'),
           DATE_TRUNC('month', NOW()),
           '1 month'::interval
         ) AS month_date
       )
       SELECT 
         TO_CHAR(d.month_date, 'Mon') AS month,
         COALESCE((SELECT SUM(amount) FROM commissions c WHERE DATE_TRUNC('month', c.created_at) = d.month_date ${centreFilter.replace(/a\./g, 'c.')}), 0) AS commission_paid,
         COALESCE((SELECT SUM(snapshot_fee) FROM admissions a WHERE status = 'approved' AND DATE_TRUNC('month', a.created_at) = d.month_date ${centreFilter}), 0) AS revenue_collected
       FROM dates d
       ORDER BY d.month_date`
    );

    // Course Popularity (Counting all enrollment attempts for popularity)
    const popularCourses = await pool.query(
      `SELECT co.name AS name, COUNT(a.id)::int AS count
       FROM courses co
       JOIN admissions a ON a.course_id = co.id
       WHERE 1=1 ${centreFilter}
       GROUP BY co.id, co.name
       ORDER BY count DESC
       LIMIT 5`
    );

    // Center Performance (Super-Admin only)
    let centerPerformance = [];
    if (role === 'super_admin') {
      const cpRes = await pool.query(
        `SELECT ce.name AS name, COALESCE(SUM(a.snapshot_fee), 0) AS revenue
         FROM centres ce
         LEFT JOIN admissions a ON a.centre_id = ce.id AND a.status = 'approved'
         GROUP BY ce.id, ce.name
         ORDER BY revenue DESC`
      );
      centerPerformance = cpRes.rows;
    }

    // Conversion Rate & Efficiency
    const totalLeads = parseInt(admStats.rows[0].total) || 1;
    const approvedCount = parseInt(admStats.rows[0].approved) || 0;
    const conversionRate = ((approvedCount / totalLeads) * 100).toFixed(1);

    return res.json({
      success: true,
      data: {
        admissions: admStats.rows[0],
        commissions: commStats.rows[0],
        students: userStats.rows[0],
        recentAdmissions: recentAdm.rows,
        monthlyMetrics: monthlyData.rows,
        popularCourses: popularCourses.rows,
        centerPerformance,
        conversionRate
      },
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard.' });
  }
};

// GET /api/dashboard/stats
const getDashboardStats = async (req, res) => {
  const userId = req.user.id;

  try {
    const [referrals, leads, admissions, commissions] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT id) AS total_referrals FROM users WHERE referred_by = $1`, [userId]),
      pool.query(`SELECT COUNT(DISTINCT id) AS total_leads FROM admissions WHERE referred_by_user_id = $1 AND status = 'pending'`, [userId]),
      pool.query(`SELECT COUNT(DISTINCT id) AS total_admissions FROM admissions WHERE referred_by_user_id = $1 AND status = 'approved'`, [userId]),
      pool.query(`SELECT COALESCE(SUM(amount), 0) AS total_commission FROM commissions WHERE referrer_id = $1`, [userId])
    ]);

    return res.json({
      success: true,
      data: {
        total_referrals: parseInt(referrals.rows[0].total_referrals) || 0,
        total_leads: parseInt(leads.rows[0].total_leads) || 0,
        total_admissions: parseInt(admissions.rows[0].total_admissions) || 0,
        total_commission: parseFloat(commissions.rows[0].total_commission) || 0
      }
    });
  } catch (err) {
    console.error('Dashboard Stats Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats.' });
  }
};

module.exports = { getStudentDashboard, getAdminDashboard, getDashboardStats };
