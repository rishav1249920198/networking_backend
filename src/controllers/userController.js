const pool = require('../config/db');

// GET /api/users/profile
const getProfile = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT full_name, email, mobile, system_id, referral_code, 
              profile_completed, last_checkin_date, education, address, bio
       FROM users WHERE id = $1`,
      [userId]
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};

// PATCH /api/users/profile
const updateProfile = async (req, res) => {
  const userId = req.user.id;
  const { full_name, education, address, bio } = req.body;

  try {
    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query('SELECT profile_completed FROM public.users WHERE id = $1', [userId]);
      const wasCompleted = userRes.rows[0]?.profile_completed;

      // Update user info
      await client.query(
        `UPDATE public.users SET full_name = $1, education = $2, address = $3, bio = $4 WHERE id = $5`,
        [full_name || '', education || '', address || '', bio || '', userId]
      );

      let bonusGranted = false;
      if (wasCompleted === false || wasCompleted === null) {
        await client.query('UPDATE public.users SET profile_completed = TRUE WHERE id = $1', [userId]);
        
        // Grant 100 IC (₹1.00) Bonus - Robust insert
        try {
          await client.query(
            `INSERT INTO bonuses (user_id, bonus_type, amount) 
             VALUES ($1, 'profile_completion', 1.00)
             ON CONFLICT (user_id, bonus_type) DO NOTHING`,
            [userId]
          );
          bonusGranted = true;
        } catch (bonusErr) {
          console.warn('[ProfileUpdate] Bonus grant failed or already exists:', bonusErr.message);
        }
      }

      await client.query('COMMIT');
      return res.json({ 
        success: true, 
        message: 'Profile updated successfully!',
        bonus_granted: bonusGranted 
      });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[ProfileUpdate] Transaction Error:', e);
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

// POST /api/users/check-in
const dailyCheckIn = async (req, res) => {
  const userId = req.user.id;
  const today = new Date().toISOString().split('T')[0];

  try {
    const userRes = await pool.query('SELECT last_checkin_date FROM users WHERE id = $1', [userId]);
    const lastCheckin = userRes.rows[0]?.last_checkin_date;

    // Convert lastCheckin to YYYY-MM-DD if exists
    const lastDate = lastCheckin ? new Date(lastCheckin).toISOString().split('T')[0] : null;

    if (lastDate === today) {
      return res.status(400).json({ success: false, message: 'Already checked in today!' });
    }

    // Grant 10 IC (₹0.10) Daily Bonus
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(
        'UPDATE users SET last_checkin_date = $1 WHERE id = $2',
        [today, userId]
      );

      await client.query(
        `INSERT INTO bonuses (user_id, bonus_type, amount) VALUES ($1, 'daily_checkin', 0.10)`,
        [userId]
      );

      await client.query('COMMIT');
      return res.json({ success: true, message: 'Daily Check-in Successful! +10 IC Credited.' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Check-in error:', err);
    return res.status(500).json({ success: false, message: 'Failed to check-in' });
  }
};

// GET /api/users/students (Admin/Co-Admin)
const getStudents = async (req, res) => {
  try {
    const { centre_id, role } = req.user;
    const filter = role === 'super_admin' ? '' : `AND u.centre_id = '${centre_id}'`;
    
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.mobile, u.system_id, u.referral_code, 
              u.created_at, r.name as role_name, c.name as centre_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN centres c ON c.id = u.centre_id
       WHERE r.name = 'student' ${filter}
       ORDER BY u.created_at DESC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('getStudents error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch students' });
  }
};

// GET /api/users/pending-referrals (Admin/Co-Admin)
const getPendingReferrals = async (req, res) => {
  try {
    const { centre_id, role } = req.user;
    const filter = role === 'super_admin' ? '' : `AND u.centre_id = '${centre_id}'`;

    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.mobile, u.system_id, u.referral_code, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN admissions a ON a.student_id = u.id
       WHERE r.name = 'student' AND a.id IS NULL ${filter}
       ORDER BY u.created_at DESC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch pending referrals' });
  }
};

// GET /api/users (Admin Only)
const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.mobile, u.system_id, r.name as role, u.is_active, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.created_at DESC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
};

// PUT /api/users/:id/role (Admin Only)
const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const { role_name } = req.body;
  try {
    const roleRes = await pool.query('SELECT id FROM roles WHERE name = $1', [role_name]);
    if (roleRes.rowCount === 0) return res.status(400).json({ success: false, message: 'Invalid role' });
    
    await pool.query('UPDATE users SET role_id = $1 WHERE id = $2', [roleRes.rows[0].id, id]);
    return res.json({ success: true, message: 'User role updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update role' });
  }
};

// DELETE /api/users/:id (Admin Only)
const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
};

// GET /api/users/bonuses (Student)
const getBonuses = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT id, bonus_type, amount, created_at 
       FROM bonuses WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('getBonuses error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch rewards history' });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  dailyCheckIn,
  getBonuses,
  getStudents,
  getPendingReferrals,
  getAllUsers,
  updateUserRole,
  deleteUser
};
