const pool = require('../config/db');
const axios = require('axios');
const { sendEmail } = require('../services/emailService');
const { logAudit } = require('../services/auditService');
const { createNotification, notifyAdmins } = require('../services/notificationService');


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
         SELECT COUNT(*) AS total_commissions, COALESCE(SUM(amount), 0) AS total_comm_earnings
         FROM commissions WHERE referrer_id = $1
       ),
       bonus_sums AS (
         SELECT COALESCE(SUM(amount), 0) AS total_bonus_earnings
         FROM bonuses WHERE user_id = $1
       ),
       req_sums AS (
         SELECT 
           COALESCE(SUM(CASE WHEN status IN ('pending', 'approved') THEN amount END), 0) AS processing_earnings,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid_earnings
         FROM withdrawal_requests WHERE student_id = $1
       )
       SELECT
         c.total_commissions,
         (c.total_comm_earnings + b.total_bonus_earnings) AS total_earnings,
         r.processing_earnings,
         r.paid_earnings,
         (c.total_comm_earnings + b.total_bonus_earnings - r.processing_earnings - r.paid_earnings) AS pending_earnings
       FROM comm_sums c CROSS JOIN bonus_sums b CROSS JOIN req_sums r`,
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
    // Fetch current conversion rate
    const settingsRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'ic_conversion_rate'");
    const conversionRate = parseFloat(settingsRes.rows[0]?.setting_value || '1.0');

    const ic_amount = parseFloat(amount);
    const inr_amount = parseFloat((ic_amount * conversionRate).toFixed(2));

    // Check available (pending) balance via Ledger (ALL VALUES IN INR)
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

    const available = parseFloat(balance.rows[0].available);
    if (available <= 0) {
      return res.status(400).json({ success: false, message: 'No commission available' });
    }

    if (available < inr_amount) {
      return res.status(400).json({ success: false, message: 'Insufficient available balance.' });
    }

    const result = await pool.query(
      `INSERT INTO withdrawal_requests (student_id, centre_id, amount, upi_id, bank_account, bank_ifsc, bank_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status, created_at`,
      [student_id, centre_id, inr_amount, upi_id, bank_account, bank_ifsc, bank_name]
    );

    // Send Withdrawal Request Email
    try {
      const studentRes = await pool.query('SELECT email, full_name FROM users WHERE id = $1', [student_id]);
      if (studentRes.rows.length > 0) {
        const student = studentRes.rows[0];
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
            <p>Dear ${student.full_name},</p>
            <p>We have successfully received your withdrawal request for <strong>${amount} IC</strong> (Converted Value: <strong>₹${inr_amount}</strong>).</p>
            <p>Our team will review your request shortly.</p>
            <p>You will receive another email once the withdrawal has been approved.</p>
            <p>Best regards<br>IGCIM Computer Centre</p>
          </div>
        `;
        sendEmail(student.email, 'Withdrawal Request Received - IGCIM Credits', emailHtml).catch(e => console.error("SMTP EMAIL ERROR:", e));

        // Notify Admins
        const adminRes = await pool.query(
          `SELECT email FROM users u 
           JOIN roles r ON u.role_id = r.id 
           WHERE r.name IN ('admin', 'super_admin') 
           AND (u.centre_id = $1 OR r.name = 'super_admin')`,
          [centre_id]
        );
        const uniqueEmails = [...new Set(adminRes.rows.map(r => r.email))];
        uniqueEmails.forEach(adminEmail => {
          const adminHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
              <p>Hello Admin,</p>
              <p>A new withdrawal request has been submitted.</p>
              <ul>
                <li><strong>Student Name:</strong> ${student.full_name}</li>
                <li><strong>Amount:</strong> ${amount} IC</li>
                <li><strong>Converted Amount:</strong> ₹${inr_amount}</li>
                <li><strong>Payment Method:</strong> ${upi_id ? 'UPI' : 'Bank Transfer'}</li>
              </ul>
              <p>Please log in to the admin dashboard to review and approve/reject this request.</p>
              <p>IGCIM System Alert</p>
            </div>
          `;
          sendEmail(adminEmail, 'New Commission Withdrawal Request', adminHtml).catch(e => console.error("Admin withdrawal email error:", e));
        });
      }
    } catch (e) {
      console.error("Failed to fetch student for withdrawal email:", e);
    }

    // NEW: Notify Admins
    const studentRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [student_id]);
    const studentName = studentRes.rows[0]?.full_name || 'A student';
    
    await notifyAdmins(
      'New Withdrawal Request 💰',
      `${studentName} has requested a withdrawal of ${amount} IC (₹${inr_amount}).`,
      'withdrawal_request',
      '/dashboard/admin/payouts',
      centre_id
    );

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted.',
      data: result.rows[0],
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
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

    if (role === 'student') {
      params.push(req.user.id);
      where += ` AND w.student_id = $${params.length}`;
    } else if (role !== 'super_admin') {
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
       WHERE id = $4 RETURNING *`,
      [status, admin_notes, adminId, id]
    );

    if (wRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    // Secure Audit Log
    await logAudit(
      adminId,
      id,
      `withdrawal_status_${status}`,
      `Withdrawal converted to ${status}. Amount: ${wRes.rows[0].amount}. Admin notes: ${admin_notes || 'None'}`,
      req.ip
    );

    // Send Approval Email
    if (['approved', 'paid'].includes(status)) {
        try {
          const { student_id, amount } = wRes.rows[0];
          const studentRes = await pool.query('SELECT email, full_name FROM users WHERE id = $1', [student_id]);
          
          if (studentRes.rows.length > 0) {
            const student = studentRes.rows[0];
            
            // Send Approval Email
            const emailHtml = `
              <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
                <p>Dear ${student.full_name},</p>
                <p>Your withdrawal request has been <strong>approved</strong> by IGCIM Computer Centre.</p>
                <p>The withdrawal amount of <strong>${parseFloat(amount).toLocaleString()} IC</strong> (₹${parseFloat(wRes.rows[0].inr_amount).toLocaleString()}) will be transferred to your registered payment method within 24 hours.</p>
                <p>If the amount is not received within this timeframe, please contact support.</p>
                <p>Best regards<br>IGCIM Computer Centre</p>
              </div>
            `;
            sendEmail(student.email, 'Withdrawal Approved', emailHtml).then(() => {

            }).catch(e => console.error("SMTP EMAIL ERROR:", e));
          }
        } catch (e) {
            console.error("Failed to fetch student for withdrawal approval email:", e);
        }
    } else if (status === 'rejected') {
        try {
          const { student_id, amount } = wRes.rows[0];
          const studentRes = await pool.query('SELECT email, full_name FROM users WHERE id = $1', [student_id]);
          if (studentRes.rows.length > 0) {
            const student = studentRes.rows[0];
            const emailHtml = `
              <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
                <p>Dear ${student.full_name},</p>
                <p>Your withdrawal request was reviewed but could not be approved at this time.</p>
                ${admin_notes ? `<p><strong>Admin Note:</strong> ${admin_notes}</p>` : ''}
                <p>The requested amount has been returned to your commission balance.</p>
                <p>You may submit another withdrawal request anytime.</p>
                <p>Best regards<br>IGCIM Computer Centre</p>
              </div>
            `;
            sendEmail(student.email, 'Withdrawal Request Update', emailHtml).then(() => {

            }).catch(e => console.error("SMTP EMAIL ERROR:", e));
          }
        } catch (e) {
            console.error("Failed to fetch student for withdrawal rejection email:", e);
        }
    }

    // NEW: Notify Student
    if (['approved', 'paid', 'rejected'].includes(status)) {
        const studentRes = await pool.query('SELECT student_id, amount FROM withdrawal_requests WHERE id = $1', [id]);
        const { student_id, amount } = studentRes.rows[0];
        
        let title = 'Withdrawal Update';
        let msg = `Your withdrawal request for ${amount} IC has been updated to ${status}.`;
        
        if (status === 'approved' || status === 'paid') {
            title = 'Withdrawal Successful! ✅';
            msg = `Your withdrawal of ${amount} IC (₹${wRes.rows[0].inr_amount}) has been processed and sent.`;
        } else if (status === 'rejected') {
            title = 'Withdrawal Rejected ❌';
            msg = `Your withdrawal of ${amount} IC was not approved. ${admin_notes ? `Reason: ${admin_notes}` : ''}`;
        }
        
        await createNotification(student_id, title, msg, 'withdrawal_update', '/dashboard/student/earnings');
    }

    return res.json({ success: true, message: `Withdrawal request marked as ${status}.` });
  } catch (err) {
    console.error('Update withdrawal error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update withdrawal status.' });
  }
};


module.exports = { 
  listCommissions, 
  getEarningsSummary, 
  requestWithdrawal, 
  listWithdrawals, 
  updateWithdrawalStatus
};
