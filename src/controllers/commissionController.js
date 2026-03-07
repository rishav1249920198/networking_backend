const pool = require('../config/db');

// GET /api/commissions  (Student sees own; Admin sees centre; SuperAdmin sees all)
const listCommissions = async (req, res) => {
  const user = req.user;
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    let where = 'WHERE 1=1';
    const params = [];

    if (user.role === 'student') {
      params.push(user.id);
      where += ` AND c.referrer_id = $${params.length}`;
    } else if (user.role !== 'super_admin') {
      params.push(user.centre_id);
      where += ` AND c.centre_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      where += ` AND c.status = $${params.length}`;
    }

    params.push(parseInt(limit));
    params.push(offset);

    const result = await pool.query(
      `SELECT c.id, c.amount, c.snapshot_fee, c.snapshot_percent, c.level,
              c.status, c.withdrawal_requested, c.created_at, c.paid_at,
              u.full_name AS referrer_name, u.system_id AS referrer_system_id,
              a.student_name, co.name AS course_name, ce.name AS centre_name
       FROM commissions c
       JOIN users u ON u.id = c.referrer_id
       JOIN admissions a ON a.id = c.admission_id
       JOIN courses co ON co.id = a.course_id
       JOIN centres ce ON ce.id = c.centre_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM commissions c ${where}`,
      params.slice(0, -2)
    );

    return res.json({
      success: true,
      data: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.rows[0].count) },
    });
  } catch (err) {
    console.error('List commissions error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch commissions.' });
  }
};

// GET /api/commissions/summary  (Student earnings summary)
const getEarningsSummary = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `WITH comm_sums AS (
         SELECT COUNT(*) AS total_commissions, COALESCE(SUM(amount), 0) AS total_earnings
         FROM commissions WHERE referrer_id = $1
       ),
       req_sums AS (
         SELECT 
           COALESCE(SUM(CASE WHEN status IN ('pending', 'approved') THEN amount END), 0) AS processing_earnings,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid_earnings
         FROM withdrawal_requests WHERE student_id = $1
       )
       SELECT
         c.total_commissions,
         c.total_earnings,
         r.processing_earnings,
         r.paid_earnings,
         (c.total_earnings - r.processing_earnings - r.paid_earnings) AS pending_earnings
       FROM comm_sums c CROSS JOIN req_sums r`,
      [userId]
    );

    // Monthly earnings for chart (last 7 months)
    const monthly = await pool.query(
      `SELECT TO_CHAR(created_at, 'Mon YYYY') AS month,
              DATE_TRUNC('month', created_at) AS month_date,
              COALESCE(SUM(amount), 0) AS amount
       FROM commissions
       WHERE referrer_id = $1 AND created_at >= NOW() - INTERVAL '7 months'
       GROUP BY month, month_date
       ORDER BY month_date`,
      [userId]
    );

    return res.json({
      success: true,
      data: { summary: result.rows[0], monthly: monthly.rows },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch earnings.' });
  }
};

// POST /api/commissions/withdraw  (Student)
const requestWithdrawal = async (req, res) => {
  const { amount, upi_id, bank_account, bank_ifsc, bank_name } = req.body;
  const student_id = req.user.id;
  const centre_id = req.user.centre_id;

  try {
    // Check available (pending) balance via Ledger
    const balance = await pool.query(
      `WITH comm_sums AS (
         SELECT COALESCE(SUM(amount), 0) AS total FROM commissions WHERE referrer_id = $1
       ),
       req_sums AS (
         SELECT COALESCE(SUM(amount), 0) AS requested FROM withdrawal_requests WHERE student_id = $1 AND status != 'rejected'
       )
       SELECT (c.total - r.requested) AS available
       FROM comm_sums c CROSS JOIN req_sums r`,
      [student_id]
    );

    if (parseFloat(balance.rows[0].available) < parseFloat(amount)) {
      return res.status(400).json({ success: false, message: 'Insufficient available balance.' });
    }

    const result = await pool.query(
      `INSERT INTO withdrawal_requests (student_id, centre_id, amount, upi_id, bank_account, bank_ifsc, bank_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status, created_at`,
      [student_id, centre_id, amount, upi_id, bank_account, bank_ifsc, bank_name]
    );

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted.',
      data: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to submit withdrawal.' });
  }
};

// GET /api/commissions/withdrawals (Admin/SuperAdmin)
const listWithdrawals = async (req, res) => {
  const { centre_id, role } = req.user;
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    let where = 'WHERE 1=1';
    const params = [];

    if (role !== 'super_admin') {
      params.push(centre_id);
      where += ` AND w.centre_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      where += ` AND w.status = $${params.length}`;
    }

    params.push(parseInt(limit), offset);

    const result = await pool.query(
      `SELECT w.*, u.full_name AS student_name, u.system_id AS student_system_id, u.mobile, ce.name AS centre_name
       FROM withdrawal_requests w
       JOIN users u ON u.id = w.student_id
       JOIN centres ce ON ce.id = w.centre_id
       ${where}
       ORDER BY w.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countResult = await pool.query(`SELECT COUNT(*) FROM withdrawal_requests w ${where}`, params.slice(0, -2));

    return res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      },
    });
  } catch (err) {
    console.error('List withdrawals error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch withdrawals.' });
  }
};

// PATCH /api/commissions/withdrawals/:id/status (Admin/SuperAdmin)
const updateWithdrawalStatus = async (req, res) => {
  const { id } = req.params;
  const { status, admin_notes } = req.body;
  const adminId = req.user.id;

  if (!['pending', 'approved', 'rejected', 'paid'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status.' });
  }

  try {
    const wRes = await pool.query(
      `UPDATE withdrawal_requests 
       SET status = $1, admin_notes = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE id = $4 RETURNING student_id, amount`,
      [status, admin_notes, adminId, id]
    );

    if (wRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    return res.json({ success: true, message: `Withdrawal request marked as ${status}.` });
  } catch (err) {
    console.error('Update withdrawal error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update withdrawal status.' });
  }
};

module.exports = { listCommissions, getEarningsSummary, requestWithdrawal, listWithdrawals, updateWithdrawalStatus };
