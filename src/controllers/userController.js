const pool = require('../config/db');

// GET /api/users/students
const getStudents = async (req, res) => {
  const { centre_id, role } = req.user;
  const centreFilter = role !== 'super_admin' ? ` AND u.centre_id = '${centre_id}'` : '';

  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const query = `
      SELECT 
        u.id, 
        u.system_id, 
        u.full_name, 
        u.email, 
        u.mobile, 
        u.referral_code,
        u.is_active,
        u.created_at,
        ref.full_name AS referred_by_name,
        (SELECT COUNT(*) FROM users inv WHERE inv.referred_by = u.id)::int AS total_referrals
      FROM users u
      JOIN roles ro ON ro.id = u.role_id
      LEFT JOIN users ref ON ref.id = u.referred_by
      WHERE ro.name = 'student' ${centreFilter}
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const countQuery = `
      SELECT COUNT(*)
      FROM users u
      JOIN roles ro ON ro.id = u.role_id
      WHERE ro.name = 'student' ${centreFilter}
    `;

    const result = await pool.query(query, [limit, offset]);
    const countResult = await pool.query(countQuery);
    
    return res.json({ 
      success: true, 
      data: result.rows,
      pagination: { 
        page: parseInt(page), 
        limit: parseInt(limit), 
        total: parseInt(countResult.rows[0].count) 
      }
    });
  } catch (err) {
    console.error('Fetch Students Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch students.' });
  }
};

// GET /api/users/pending-referrals
// Students who registered via a referral code but have NO approved admission yet
const getPendingReferrals = async (req, res) => {
  const { centre_id, role } = req.user;
  const centreFilter = role !== 'super_admin' ? ` AND u.centre_id = '${centre_id}'` : '';

  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const queryStr = `
      SELECT
        u.id,
        u.system_id,
        u.full_name,
        u.email,
        u.mobile,
        u.created_at,
        ref.id         AS referrer_id,
        ref.full_name  AS referrer_name,
        ref.system_id  AS referrer_system_id,
        ref.referral_code AS referrer_code,
        -- see if they have ANY admission at all
        (SELECT status FROM admissions WHERE student_id = u.id ORDER BY created_at DESC LIMIT 1) AS latest_admission_status
      FROM users u
      JOIN roles ro ON ro.id = u.role_id
      JOIN users ref ON ref.id = u.referred_by
      WHERE ro.name = 'student'
        AND u.referred_by IS NOT NULL
        -- exclude if already has an approved admission (commission already handled)
        AND NOT EXISTS (
          SELECT 1 FROM admissions a
          WHERE a.student_id = u.id AND a.status = 'approved'
        )
        ${centreFilter}
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const countQuery = `
      SELECT COUNT(*)
      FROM users u
      JOIN roles ro ON ro.id = u.role_id
      WHERE ro.name = 'student'
        AND u.referred_by IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM admissions a
          WHERE a.student_id = u.id AND a.status = 'approved'
        )
        ${centreFilter}
    `;

    const result = await pool.query(queryStr, [limit, offset]);
    const countResult = await pool.query(countQuery);

    return res.json({ 
      success: true, 
      data: result.rows,
      pagination: { 
        page: parseInt(page), 
        limit: parseInt(limit), 
        total: parseInt(countResult.rows[0].count) 
      }
    });
  } catch (err) {
    console.error('Fetch Pending Referrals Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch pending referrals.' });
  }
};

// GET /api/users
const getAllUsers = async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const query = `
      SELECT u.id, u.system_id, u.full_name, u.email, u.mobile, ro.name as role, u.created_at
      FROM users u
      JOIN roles ro ON ro.id = u.role_id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const countQuery = `SELECT COUNT(*) FROM users`;
    const result = await pool.query(query, [limit, offset]);
    const countResult = await pool.query(countQuery);

    return res.json({
      success: true,
      data: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.rows[0].count) }
    });
  } catch (err) {
    console.error('Fetch All Users Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
};

// PUT /api/users/:id/role
const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const { role } = req.body; // 'student' or 'co-admin'
  if (!['student', 'co-admin'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role assignment.' });
  }

  try {
    const roleRes = await pool.query(`SELECT id FROM roles WHERE name = $1`, [role]);
    if (roleRes.rowCount === 0) return res.status(400).json({ success: false, message: 'Role not found' });
    const roleId = roleRes.rows[0].id;

    const result = await pool.query(`UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id`, [roleId, id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'User not found.' });
    return res.json({ success: true, message: \`User successfully updated to \${role}\` });
  } catch (err) {
    console.error('Update User Role Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update user role.' });
  }
};

// DELETE /api/users/:id
const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const checkUser = await pool.query(`SELECT ro.name as role FROM users u JOIN roles ro ON ro.id = u.role_id WHERE u.id = $1`, [id]);
    if (checkUser.rowCount === 0) return res.status(404).json({ success: false, message: 'User not found.' });
    
    // Prevent deletion of higher admins
    if (['super_admin', 'admin', 'centre_admin'].includes(checkUser.rows[0].role)) {
      return res.status(403).json({ success: false, message: 'Cannot delete an administrator account.' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return res.json({ success: true, message: 'User successfully deleted.' });
  } catch (err) {
    console.error('Delete User Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete user.' });
  }
};

module.exports = { getStudents, getPendingReferrals, getAllUsers, updateUserRole, deleteUser };
