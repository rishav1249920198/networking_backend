const pool = require('../config/db');
const { validateReferral } = require('../services/referralValidator');
const { generateCommission } = require('../services/commissionEngine');
const AdmissionService = require('../services/AdmissionService');

// POST /api/admissions/online
const createOnlineAdmission = async (req, res) => {
  try {
    const admission = await AdmissionService.createAdmission({
      ...req.body,
      student_id: req.user.id,
      centre_id: req.user.centre_id,
      payment_proof_path: req.file ? req.file.path : null,
      admission_mode: 'online'
    });
    return res.status(201).json({
      success: true,
      message: 'Admission submitted successfully. Pending admin approval.',
      data: admission,
    });
  } catch (err) {
    if (err.message && !err.message.includes('SQL')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    console.error('Online admission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit admission.' });
  }
};

// POST /api/admissions/public (Public Route)
const createPublicAdmission = async (req, res) => {
  try {
    // Attempt logic lookup for CentreID (Defaults to primary IGCIM Centre if unmapped)
    const centreRes = await pool.query('SELECT id FROM centres WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
    if (centreRes.rowCount === 0) return res.status(500).json({ success: false, message: 'No active centres found for public admission.' });

    const admission = await AdmissionService.createAdmission({
      ...req.body,
      student_id: null, // No auth context implies pending account status vs physical student binding
      centre_id: centreRes.rows[0].id,
      payment_proof_path: req.file ? req.file.path : null,
      admission_mode: 'online'
    });
    
    return res.status(201).json({
      success: true,
      message: 'Admission submitted successfully. We will contact you soon.',
      data: admission,
    });
  } catch (err) {
    if (err.message && !err.message.includes('SQL')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    console.error('Public admission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit public admission.' });
  }
};

// POST /api/admissions/offline  (Staff only)
const createOfflineAdmission = async (req, res) => {
  try {
    const admission = await AdmissionService.createAdmission({
      ...req.body,
      staff_id: req.user.id,
      centre_id: req.user.centre_id,
      student_id: req.body.student_user_id || null, // Optional for offline
      admission_mode: 'offline'
    });
    return res.status(201).json({
      success: true,
      message: 'Offline admission entry submitted. Pending admin approval.',
      data: admission,
    });
  } catch (err) {
    if (err.message && !err.message.includes('SQL')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    console.error('Offline admission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create offline admission.' });
  }
};

// PATCH /api/admissions/:id/approve  (Admin only)
const approveAdmission = async (req, res) => {
  const { id } = req.params;
  const adminId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const adm = await client.query(
      `SELECT id, status, centre_id FROM admissions WHERE id = $1`,
      [id]
    );
    if (adm.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Admission not found.' });
    }
    if (adm.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Admission is already ${adm.rows[0].status}.` });
    }

    // Approve
    await client.query(
      `UPDATE admissions SET status = 'approved', reviewed_by_id = $1, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [adminId, id]
    );

    // Generate commission
    const commResult = await generateCommission(id, client);

    await client.query(
      `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'admission_approved', 'admission', $3, $4)`,
      [adminId, req.user.role, id, JSON.stringify({ commResult })]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Admission approved and commission generated.',
      data: { admissionId: id, commission: commResult },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Approve admission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve admission.' });
  } finally {
    client.release();
  }
};

// PATCH /api/admissions/:id/reject  (Admin only)
const rejectAdmission = async (req, res) => {
  const { id } = req.params;
  const { rejection_reason } = req.body;
  const adminId = req.user.id;

  try {
    const adm = await pool.query(`SELECT id, status FROM admissions WHERE id = $1`, [id]);
    if (adm.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found.' });
    if (adm.rows[0].status !== 'pending')
      return res.status(400).json({ success: false, message: `Already ${adm.rows[0].status}.` });

    await pool.query(
      `UPDATE admissions SET status = 'rejected', reviewed_by_id = $1, reviewed_at = NOW(),
       rejection_reason = $2, updated_at = NOW() WHERE id = $3`,
      [adminId, rejection_reason, id]
    );

    return res.json({ success: true, message: 'Admission rejected.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to reject admission.' });
  }
};

// GET /api/admissions
const listAdmissions = async (req, res) => {
  const { status, mode, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const user = req.user;

  try {
    let whereClause = 'WHERE 1=1';
    const params = [];

    // Centre filter (non-super-admin sees own centre only)
    if (user.role !== 'super_admin') {
      params.push(user.centre_id);
      whereClause += ` AND a.centre_id = $${params.length}`;
    }

    // Student sees only own admissions
    if (user.role === 'student') {
      params.push(user.id);
      whereClause += ` AND a.student_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      whereClause += ` AND a.status = $${params.length}`;
    }
    if (mode) {
      params.push(mode);
      whereClause += ` AND a.admission_mode = $${params.length}`;
    }

    params.push(parseInt(limit));
    params.push(offset);

    const result = await pool.query(
      `SELECT a.id, a.student_name, a.student_mobile, a.status, a.admission_mode,
              a.snapshot_fee, a.snapshot_commission_percent, a.created_at,
              a.payment_proof_path, a.rejection_reason,
              co.name AS course_name, c.name AS centre_name,
              u.full_name AS referrer_name
       FROM admissions a
       JOIN courses co ON co.id = a.course_id
       JOIN centres c ON c.id = a.centre_id
       LEFT JOIN users u ON u.id = a.referred_by_user_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM admissions a ${whereClause}`,
      params.slice(0, -2)
    );

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
    console.error('List admissions error:', err);
    return res.status(500).json({ success: false, message: 'Failed to list admissions.' });
  }
};

// POST /api/admissions/admin-enroll-approve  (Admin only)
// Creates an offline admission for a referred student and immediately approves it
const adminEnrollAndApprove = async (req, res) => {
  const { student_id, course_id, referrer_id } = req.body;
  const adminId = req.user.id;
  const centre_id = req.user.centre_id || req.body.centre_id;

  if (!student_id || !course_id) {
    return res.status(400).json({ success: false, message: 'student_id and course_id are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get course details
    const courseResult = await client.query(
      `SELECT id, fee, commission_percent, name, is_active FROM courses WHERE id = $1`,
      [course_id]
    );
    if (courseResult.rows.length === 0 || !courseResult.rows[0].is_active) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Course not found or inactive.' });
    }
    const course = courseResult.rows[0];

    // Get student details
    const studentResult = await client.query(
      `SELECT id, full_name, mobile, email, centre_id, referred_by FROM users WHERE id = $1`,
      [student_id]
    );
    if (studentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    const student = studentResult.rows[0];

    // Use the student's own referred_by if not overridden
    const referredByUserId = referrer_id || student.referred_by || null;
    
    // Determine centre
    const effectiveCentreId = centre_id || student.centre_id;
    if (!effectiveCentreId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Centre could not be determined.' });
    }

    // Create the admission as already approved
    const admResult = await client.query(
      `INSERT INTO admissions
        (centre_id, course_id, student_id, referred_by_user_id, admission_mode,
         status, snapshot_fee, snapshot_commission_percent,
         student_name, student_mobile, student_email,
         payment_mode, entered_by_staff_id, reviewed_by_id, reviewed_at, notes)
       VALUES ($1,$2,$3,$4,'offline','approved',$5,$6,$7,$8,$9,'cash',$10,$10,NOW(), 'Admin enrolled and approved')
       RETURNING id`,
      [
        effectiveCentreId, course_id, student_id, referredByUserId,
        course.fee, course.commission_percent,
        student.full_name, student.mobile, student.email,
        adminId,
      ]
    );
    const admissionId = admResult.rows[0].id;

    // Generate commission immediately
    const commResult = await generateCommission(admissionId, client);

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `Enrollment approved! ${commResult.generated ? `Commission ₹${commResult.amount} generated for referrer.` : commResult.message}`,
      data: { admissionId, commission: commResult },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Admin Enroll Approve Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to enroll and approve.' });
  } finally {
    client.release();
  }
};

module.exports = {
  createOnlineAdmission,
  createOfflineAdmission,
  approveAdmission,
  rejectAdmission,
  listAdmissions,
  adminEnrollAndApprove,
};
