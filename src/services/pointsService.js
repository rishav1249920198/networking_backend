const pool = require('../config/db');
const { toIC, toRupees } = require('../utils/conversionUtils');

/**
 * Points Service
 * Handles all logic for points wallet, transactions, and IST-based earnings.
 */
class PointsService {
  /**
   * Fetches the user's wallet summary and IST-based today's earnings in IC Points.
   */
  static async getWalletSummary(userId) {
    const [wallet, pending, lifetime, today] = await Promise.all([
      pool.query("SELECT total_points, total_rupees FROM points_wallet WHERE user_id = $1", [userId]),
      pool.query("SELECT COALESCE(SUM(amount), 0) as requested FROM withdrawal_requests WHERE student_id = $1 AND status = 'pending'", [userId]),
      pool.query("SELECT COALESCE(SUM(rupees), 0) as total_earned FROM points_transactions WHERE user_id = $1 AND rupees > 0", [userId]),
      pool.query(`
        SELECT COALESCE(SUM(rupees), 0) as today_earned 
        FROM points_transactions 
        WHERE user_id = $1 AND rupees > 0
        AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = CURRENT_DATE AT TIME ZONE 'Asia/Kolkata'
      `, [userId])
    ]);

    const w = wallet.rows[0] || { total_points: 0, total_rupees: 0 };
    const p = parseFloat(pending.rows[0].requested);
    const l = parseFloat(lifetime.rows[0].total_earned);
    const t = parseFloat(today.rows[0].today_earned);

    return {
      totalPoints: parseFloat(w.total_points),
      totalEarningsPoints: toIC(l),
      todayPoints: toIC(t),
      withdrawablePoints: toIC(parseFloat(w.total_rupees)),
      isLockedByLeftRight: false // This will be enriched by DashboardService if needed
    };
  }

  /**
   * Fetches earnings breakdown by category in IC Points.
   */
  static async getEarningsBreakdown(userId) {
    const result = await pool.query(`
      SELECT 
        type,
        COALESCE(SUM(rupees), 0) as total_rupees
      FROM points_transactions
      WHERE user_id = $1
      GROUP BY type
    `, [userId]);

    const breakdown = { direct: 0, overrideL1: 0, overrideL2: 0, bonus: 0 };
    result.rows.forEach(r => {
      const val = toIC(r.total_rupees);
      if (r.type === 'direct' || r.type === 'direct_earning') breakdown.direct += val;
      if (r.type === 'override_l1') breakdown.overrideL1 += val;
      if (r.type === 'override_l2') breakdown.overrideL2 += val;
      if (r.type === 'bonus_completion') breakdown.bonus += val;
    });

    return breakdown;
  }

  /**
   * Fetches daily growth for charts in IC Points.
   */
  static async getChartData(userId) {
    const result = await pool.query(`
      SELECT 
        (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date as date,
        COALESCE(SUM(rupees), 0) as total_rupees
      FROM points_transactions
      WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY date
      ORDER BY date ASC
    `, [userId]);

    return result.rows.map(r => ({
      date: typeof r.date === 'string' ? r.date : r.date.toISOString().split('T')[0],
      points: toIC(r.total_rupees)
    }));
  }

  /**
   * Fetches paginated earnings history for the ledger.
   */
  static async getEarningsHistory(userId, page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const result = await pool.query(`
      SELECT 
        pt.id, pt.type, pt.points, pt.rupees, pt.note, pt.created_at,
        a.student_name as ref_name
      FROM points_transactions pt
      LEFT JOIN admissions a ON a.id = pt.admission_id
      WHERE pt.user_id = $1
      ORDER BY pt.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, parseInt(limit), offset]);

    const countRes = await pool.query(
      "SELECT COUNT(*)::int FROM points_transactions WHERE user_id = $1",
      [userId]
    );

    return {
      data: result.rows.map(r => ({
        id: r.id,
        type: r.type,
        points: parseFloat(r.points) || toIC(r.rupees),
        note: r.note,
        created_at: r.created_at,
        ref_name: r.ref_name
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countRes.rows[0].count,
        totalPages: Math.ceil(countRes.rows[0].count / parseInt(limit))
      }
    };
  }

  /**
   * Fetches weekly summary (points-only)
   */
  static async getWeeklySummary(userId) {
    const query = `
      SELECT 
        SUM(rupees) filter (where created_at >= date_trunc('week', now())) as current_week,
        SUM(rupees) filter (where created_at >= date_trunc('week', now() - interval '1 week') and created_at < date_trunc('week', now())) as prev_week
      FROM points_transactions
      WHERE user_id = $1 AND rupees > 0
    `;
    const res = await pool.query(query, [userId]);
    const curr = parseFloat(res.rows[0].current_week || 0);
    const prev = parseFloat(res.rows[0].prev_week || 0);

    const currPoints = toIC(curr);
    const prevPoints = toIC(prev);
    
    let change = 0;
    if (prevPoints > 0) {
      change = ((currPoints - prevPoints) / prevPoints) * 100;
    } else if (currPoints > 0) {
      change = 100;
    }

    return {
      weeklyPoints: currPoints,
      weeklyChangePercent: change,
      prevWeeklyPoints: prevPoints
    };
  }
}

module.exports = PointsService;
