const PointsService = require('./pointsService');
const TreeService = require('./treeService');
const FraudService = require('./fraudService');
const pool = require('../config/db');

/**
 * Dashboard Service
 * Orchestrates multiple services to provide a unified data payload for the dashboard.
 */
class DashboardService {
  /**
   * Aggregates all student dashboard statistics.
   */
  static async getStudentStats(userId) {
    const [wallet, tree, weekly] = await Promise.all([
      PointsService.getWalletSummary(userId),
      TreeService.getBinaryStats(userId),
      PointsService.getWeeklySummary(userId)
    ]);

    // Milestone Logic: 2 (Starter), 4 (Builder), 6 (Achiever), 10 (Leader), 20 (Elite), 50 (Master)
    const milestones = [2, 4, 6, 10, 20, 50, 100];
    const currentCount = tree.directCount || 0;
    const nextMilestone = milestones.find(m => m > currentCount) || milestones[milestones.length - 1];

    return {
      ...wallet,
      ...weekly,
      leftCount: tree.leftCount,
      rightCount: tree.rightCount,
      directCount: tree.directCount,
      withdrawalUnlocked: tree.withdrawalUnlocked,
      leftRefs: tree.leftRefs,
      rightRefs: tree.rightRefs,
      isLockedByLeftRight: tree.isLockedByLeftRight,
      boost_level: tree.boost_level,
      nextMilestone,
      milestoneBadge: currentCount >= 50 ? 'Master' : currentCount >= 20 ? 'Elite' : currentCount >= 10 ? 'Leader' : currentCount >= 6 ? 'Achiever' : currentCount >= 4 ? 'Builder' : currentCount >= 2 ? 'Starter' : 'Novice'
    };
  }

  /**
   * Aggregates administrative analytics and scanner data.
   */
  static async getAdminStats(adminUser) {
    const { centre_id, role } = adminUser;
    const centreFilter = role !== 'super_admin' ? ` AND a.centre_id = '${centre_id}'` : '';
    const centreUserFilter = role !== 'super_admin' ? ` AND u.centre_id = '${centre_id}'` : '';

    const [admStats, payoutStats, userStats, growthStats, fraudMap] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*)::int AS total, 
          COUNT(CASE WHEN status='pending' THEN 1 END)::int AS pending, 
          COUNT(CASE WHEN status='approved' THEN 1 END)::int AS approved, 
          SUM(CASE WHEN status='approved' THEN snapshot_fee ELSE 0 END)::numeric AS total_revenue
        FROM admissions a WHERE 1=1 ${centreFilter}
      `),
      pool.query(`
        SELECT COALESCE(SUM(amount), 0)::numeric AS total_paid
        FROM withdrawal_requests
        WHERE status = 'paid' ${centreFilter}
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total_students 
        FROM users u 
        JOIN roles r ON r.id = u.role_id 
        WHERE r.name = 'student' ${centreUserFilter}
      `),
      pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'student' AND u.created_at >= date_trunc('month', now()) ${centreUserFilter}) as current_month,
          (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'student' AND u.created_at >= date_trunc('month', now()) - interval '1 month' AND u.created_at < date_trunc('month', now()) ${centreUserFilter}) as last_month
      `),
      FraudService.scanPendingAdmissions()
    ]);

    const revenue = parseFloat(admStats.rows[0].total_revenue || 0);
    const paid = parseFloat(payoutStats.rows[0].total_paid || 0);

    return {
      admissions: admStats.rows[0],
      payouts: {
        total_paid: paid,
        expense_ratio: revenue > 0 ? ((paid / revenue) * 100).toFixed(2) : 0
      },
      students: userStats.rows[0],
      growth: growthStats.rows[0],
      fraudAlerts: fraudMap
    };
  }

  /**
   * Fetches top earners for the admin leaderboard.
   */
  static async getTopUsers(limit = 10) {
    const result = await pool.query(`
      SELECT u.full_name, u.system_id, pw.total_rupees as total_earned
      FROM points_wallet pw
      JOIN users u ON u.id = pw.user_id
      ORDER BY pw.total_rupees DESC LIMIT $1
    `, [limit]);
    return result.rows;
  }

  /**
   * Fetches 12-month trend for Revenue vs Payout.
   */
  static async getTrendData() {
    const result = await pool.query(`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', now()) - interval '11 months',
          date_trunc('month', now()),
          interval '1 month'
        )::date AS month
      ),
      rev AS (
        SELECT date_trunc('month', created_at)::date as month, SUM(snapshot_fee) as revenue
        FROM admissions WHERE status = 'approved'
        GROUP BY 1
      ),
      pay AS (
        SELECT date_trunc('month', created_at)::date as month, SUM(amount) as payout
        FROM withdrawal_requests WHERE status = 'paid'
        GROUP BY 1
      )
      SELECT 
        m.month,
        COALESCE(r.revenue, 0)::numeric as revenue,
        COALESCE(p.payout, 0)::numeric as payout
      FROM months m
      LEFT JOIN rev r ON r.month = m.month
      LEFT JOIN pay p ON p.month = m.month
      ORDER BY m.month ASC
    `);
    return result.rows.map(r => ({
      ...r,
      month: new Date(r.month).toLocaleString('default', { month: 'short' })
    }));
  }
}



module.exports = DashboardService;
