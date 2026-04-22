const pool = require('../config/db');

/**
 * Admin Intelligence Controllers
 * Provides sustainable growth metrics and predictive insights.
 */

// GET /api/admin/metrics/expense
const getExpenseMetrics = async (req, res) => {
  try {
    // 1. Total Payout (Sum of 'paid' withdrawals in Rupees)
    const payoutRes = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_requests WHERE status = 'paid'
    `);
    const totalPayout = parseFloat(payoutRes.rows[0].total);

    // 2. Total Revenue (Sum of approved admissions' snapshot_fee)
    const revenueRes = await pool.query(`
      SELECT COALESCE(SUM(snapshot_fee), 0) as total FROM admissions WHERE status = 'approved'
    `);
    const totalRevenue = parseFloat(revenueRes.rows[0].total) || 1; // Prevent div by zero

    // 3. Last 24h Metrics
    const payout24h = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_requests 
      WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '24 hours'
    `);
    const revenue24h = await pool.query(`
      SELECT COALESCE(SUM(snapshot_fee), 0) as total FROM admissions 
      WHERE status = 'approved' AND created_at >= NOW() - INTERVAL '24 hours'
    `);

    const ratio = (totalPayout / totalRevenue) * 100;
    const ratio24h = (parseFloat(payout24h.rows[0].total) / (parseFloat(revenue24h.rows[0].total) || 1)) * 100;

    let status_color = 'GREEN';
    if (ratio > 6) status_color = 'RED';
    else if (ratio > 4) status_color = 'YELLOW';

    return res.json({
      success: true,
      data: {
        total_payout: totalPayout,
        total_revenue: totalRevenue,
        expense_ratio: ratio,
        last_24h_ratio: ratio24h,
        status_color,
        thresholds: { safe: 4, warning: 6 }
      }
    });
  } catch (err) {
    console.error('Expense metrics error:', err);
    return res.status(500).json({ success: false, message: 'Failed to compute metrics.' });
  }
};

// GET /api/admin/insights/forecast
const getForecastInsights = async (req, res) => {
  try {
    // Simple 7-day moving average forecast
    const dailyStats = await pool.query(`
      SELECT 
        DATE_TRUNC('day', created_at) as day,
        COALESCE(SUM(snapshot_fee), 0) as revenue
      FROM admissions 
      WHERE status = 'approved' AND created_at >= NOW() - INTERVAL '14 days'
      GROUP BY day ORDER BY day ASC
    `);

    const dailyPayouts = await pool.query(`
      SELECT 
        DATE_TRUNC('day', paid_at) as day,
        COALESCE(SUM(amount), 0) as payout
      FROM withdrawal_requests 
      WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '14 days'
      GROUP BY day ORDER BY day ASC
    `);

    // Basic calculation for next 7 days
    const avgRevenue = dailyStats.rows.reduce((acc, r) => acc + parseFloat(r.revenue), 0) / (dailyStats.rows.length || 1);
    const avgPayout = dailyPayouts.rows.reduce((acc, r) => acc + parseFloat(r.payout), 0) / (dailyPayouts.rows.length || 1);

    const activeUsers = await pool.query(`
      SELECT COUNT(DISTINCT student_id) FROM admissions WHERE created_at >= NOW() - INTERVAL '7 days'
    `);

    return res.json({
      success: true,
      data: {
        next_7d_estimated_payout: avgPayout * 7,
        next_7d_estimated_revenue: avgRevenue * 7,
        active_users_7d: parseInt(activeUsers.rows[0].count),
        confidence: dailyStats.rows.length > 7 ? 'HIGH' : 'LOW'
      }
    });
  } catch (err) {
    console.error('Forecast error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate insights.' });
  }
};

// GET /api/admin/fraud/alerts
const getFraudAlerts = async (req, res) => {
  try {
    const alerts = await pool.query(`
      SELECT 
        id, student_name, student_mobile, student_email, fraud_flags, created_at
      FROM admissions
      WHERE fraud_flags::text != '[]' AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    return res.json({
      success: true,
      count: alerts.rowCount,
      data: alerts.rows
    });
  } catch (err) {
    console.error('Fraud alerts error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch fraud alerts.' });
  }
};

// GET /api/admin/summary
const getDailySummary = async (req, res) => {
  try {
    const last24h = await pool.query(`
      SELECT 
        COUNT(*) as total_admissions,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
        COALESCE(SUM(snapshot_fee) FILTER (WHERE status = 'approved'), 0) as total_revenue,
        (SELECT COALESCE(SUM(amount), 0) FROM withdrawal_requests WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '24 hours') as total_payout
      FROM admissions
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);

    const stats = last24h.rows[0];
    const approvalRate = stats.total_admissions > 0 
      ? (stats.approved_count / stats.total_admissions) * 100 
      : 100;

    return res.json({
      success: true,
      data: {
        total_admissions: parseInt(stats.total_admissions),
        approved_count: parseInt(stats.approved_count),
        total_revenue: parseFloat(stats.total_revenue),
        total_payout: parseFloat(stats.total_payout),
        approval_rate: approvalRate
      }
    });
  } catch (err) {
    console.error('Daily summary error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch daily summary.' });
  }
};

// GET /api/admin/export/users
const exportUsersCSV = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.system_id, u.full_name, u.email, u.mobile, r.name as role, 
        c.name as centre, u.is_active, u.created_at,
        pw.total_rupees as balance
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN centres c ON c.id = u.centre_id
      LEFT JOIN points_wallet pw ON pw.user_id = u.id
      ORDER BY u.created_at DESC
    `);

    let csv = 'System ID,Full Name,Email,Mobile,Role,Centre,Status,Joined At,Balance\n';
    result.rows.forEach(row => {
      csv += `${row.system_id},"${row.full_name}",${row.email},${row.mobile},${row.role},"${row.centre || ''}",${row.is_active ? 'Active' : 'Inactive'},${row.created_at.toISOString()},${row.balance || 0}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users_export.csv');
    return res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    return res.status(500).json({ success: false, message: 'Export failed' });
  }
};

module.exports = {
  getExpenseMetrics,
  getForecastInsights,
  getFraudAlerts,
  getDailySummary,
  exportUsersCSV
};
