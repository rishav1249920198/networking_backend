const pool = require('../config/db');
const { getReferralTree } = require('../services/referralValidator');


// GET /api/referrals/tree  (Student sees own tree)
const getReferralTreeForUser = async (req, res) => {
  const userId = req.query.userId || req.user.id;

  // Admin can view any user's tree
  if (req.user.role === 'student' && userId !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  try {
    const user = await pool.query(
      `SELECT id, full_name, system_id, referral_code FROM users WHERE id = $1`,
      [userId]
    );
    if (user.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });

    const tree = await getReferralTree(userId);
    return res.json({
      success: true,
      data: { root: user.rows[0], children: tree },
    });
  } catch (err) {
    console.error('Referral Tree Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch referral tree.' });
  }
};

// GET /api/referrals/stats  (Student)
const getReferralStats = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT
        COUNT(DISTINCT u.id) AS total_referrals,
        COUNT(DISTINCT CASE WHEN a.status = 'pending' THEN u.id END) AS pending,
        COUNT(DISTINCT CASE WHEN a.status = 'approved' THEN u.id END) AS approved,
        COUNT(DISTINCT CASE WHEN a.status = 'rejected' THEN u.id END) AS rejected
       FROM users u
       LEFT JOIN admissions a ON a.student_id = u.id
       WHERE u.referred_by = $1`,
      [userId]
    );

    // Monthly referral growth (last 7 months)
    const monthly = await pool.query(
      `SELECT TO_CHAR(created_at, 'Mon') AS month,
              DATE_TRUNC('month', created_at) AS month_date,
              COUNT(*) AS count
       FROM users
       WHERE referred_by = $1 AND created_at >= NOW() - INTERVAL '7 months'
       GROUP BY month, month_date
       ORDER BY month_date`,
      [userId]
    );

    // Recent referrals list
    const recent = await pool.query(
      `SELECT DISTINCT ON (u.id) 
              u.id, u.full_name, u.system_id, u.mobile, u.email, u.created_at,
              a.status AS admission_status, a.snapshot_fee
       FROM users u
       LEFT JOIN admissions a ON a.student_id = u.id
       WHERE u.referred_by = $1
       ORDER BY u.id, a.created_at DESC
       LIMIT 10`,
      [userId]
    );

    return res.json({
      success: true,
      data: { stats: result.rows[0], monthly: monthly.rows, recent: recent.rows },
    });
  } catch (err) {
    console.error('Referral Stats Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch referral stats.' });
  }
};

// GET /api/referrals/validate/:code  (Public - for admission form)
const validateReferralCode = async (req, res) => {
  const { code } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, full_name, system_id FROM users WHERE referral_code = $1 AND is_active = TRUE`,
      [code.toUpperCase()]
    );
    if (result.rows.length === 0) {
      return res.json({ success: false, valid: false, message: 'Invalid referral code.' });
    }
    return res.json({ success: true, valid: true, data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Validation failed.' });
  }
};


// GET /api/referrals/leaderboard  (Public)
const getLeaderboard = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         u.full_name, 
         u.system_id,
         COALESCE(pw.total_rupees, 0) AS total_earned,
         (SELECT COUNT(*) FROM users inv WHERE inv.referred_by = u.id) AS total_invited,
         (SELECT COUNT(*) FROM admissions adm WHERE adm.referred_by_user_id = u.id AND adm.status = 'approved') AS total_referrals
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN points_wallet pw ON pw.user_id = u.id
       WHERE r.name IN ('student', 'co-admin') AND u.is_active = TRUE
       -- Only include users who have at least invited 1 person OR earned something
       AND (
         COALESCE(pw.total_rupees, 0) > 0 
         OR 
         (SELECT COUNT(*) FROM users inv WHERE inv.referred_by = u.id) > 0
       )
       ORDER BY total_earned DESC, total_referrals DESC, total_invited DESC
       LIMIT 10`
    );

    // Masking names for privacy: "Rishav Kumar" -> "Rishav K."
    const leaderboard = result.rows.map((row, index) => {
      const nameParts = row.full_name.trim().split(/\s+/);
      const maskedName = nameParts.length > 1 
        ? `${nameParts[0]} ${nameParts[nameParts.length-1][0]}.` 
        : row.full_name;
      
      return {
        rank: index + 1,
        name: maskedName,
        total_earned: parseFloat(row.total_earned),
        total_referrals: parseInt(row.total_invited)
      };
    });

    return res.json({ success: true, data: leaderboard });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch leaderboard.' });
  }
};


module.exports = { 
  getReferralTreeForUser, 
  getReferralStats, 
  validateReferralCode,
  getLeaderboard
};

