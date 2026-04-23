const pool = require('../config/db');
const cache = require('../utils/cacheUtils');
const EngagementService = require('../services/engagementService');
const bcrypt = require('bcryptjs');

// GET /api/users/profile
const getProfile = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT full_name, email, mobile, system_id, referral_code, 
              profile_completed, profile_completeness, last_checkin_date, 
              education, address, bio, dob, whatsapp_number, 
              notification_settings, theme_preference
       FROM users WHERE id = $1`,
      [userId]
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};

// PATCH /api/users/profile
const updateProfile = async (req, res) => {
  const userId = req.user.id;
  const { full_name, education, address, bio, dob, whatsapp_number } = req.body;

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query('SELECT profile_completed FROM users WHERE id = $1', [userId]);
      const wasCompleted = userRes.rows[0]?.profile_completed;

      // Calculate completeness
      const fields = { full_name, education, address, bio, dob, whatsapp_number };
      const filledCount = Object.values(fields).filter(v => v && v.toString().trim() !== '').length;
      const totalFields = Object.keys(fields).length;
      const completeness = Math.round((filledCount / totalFields) * 100);

      const updateRes = await client.query(
        `UPDATE users 
         SET full_name = $1, education = $2, address = $3, bio = $4, 
             dob = $5, whatsapp_number = $6, profile_completeness = $7,
             profile_completed = CASE WHEN $7 >= 100 THEN TRUE ELSE profile_completed END
         WHERE id = $8`, 
        [full_name, education, address, bio, dob, whatsapp_number, completeness, userId]
      );

      if (updateRes.rowCount === 0) throw new Error("User not found");

      let bonusGranted = false;
      if (!wasCompleted && completeness >= 100) {
        await EngagementService.grantProfileCompletionBonus(userId, client);
        bonusGranted = true;
      }

      await client.query('COMMIT');

      const freshUserRes = await client.query(
        `SELECT u.id, u.full_name, u.email, u.mobile, u.system_id, r.name as role, 
                u.profile_completed, u.profile_completeness, u.education, u.address, 
                u.bio, u.dob, u.whatsapp_number
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1`, 
        [userId]
      );
      
      return res.json({ 
        success: true, 
        message: 'Profile updated successfully!',
        bonus_granted: bonusGranted,
        data: freshUserRes.rows[0]
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

// POST /api/users/change-password
const changePassword = async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  try {
    const userRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Current password incorrect' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);

    return res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to change password' });
  }
};

// PATCH /api/users/notifications
const updateNotificationSettings = async (req, res) => {
  const userId = req.user.id;
  const { settings } = req.body; // Expecting { financial, system, marketing }

  try {
    await pool.query('UPDATE users SET notification_settings = notification_settings || $1 WHERE id = $2', [JSON.stringify(settings), userId]);
    return res.json({ success: true, message: 'Notification settings updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
};

// DELETE /api/users/me (Soft Delete)
const deleteAccount = async (req, res) => {
  const userId = req.user.id;
  const { password } = req.body;

  try {
    const userRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Password incorrect' });

    // Check balance
    const walletRes = await pool.query('SELECT total_rupees FROM points_wallet WHERE user_id = $1', [userId]);
    if (walletRes.rows[0]?.total_rupees > 0) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate account with remaining balance. Please withdraw first.' });
    }

    // NEW: Check for pending or approved withdrawals
    const activeWithdrawals = await pool.query(
        "SELECT id FROM withdrawal_requests WHERE student_id = $1 AND status IN ('pending', 'approved')",
        [userId]
    );
    if (activeWithdrawals.rowCount > 0) {
        return res.status(400).json({ success: false, message: 'Cannot deactivate account with active withdrawal requests. Please wait for completion or contact support.' });
    }

    await pool.query("UPDATE users SET deleted_at = NOW(), is_active = FALSE WHERE id = $1", [userId]);
    return res.json({ success: true, message: 'Account deactivated successfully. You have been logged out.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to deactivate account' });
  }
};

// POST /api/users/check-in
const dailyCheckIn = async (req, res) => {
  const userId = req.user.id;
  const today = new Date().toISOString().split('T')[0];

  try {
    const userRes = await pool.query('SELECT last_checkin_date FROM users WHERE id = $1', [userId]);
    const lastCheckin = userRes.rows[0]?.last_checkin_date;

    // Convert lastCheckin to YYYY-MM-DD for same-day check
    const lastDateStr = lastCheckin ? new Date(lastCheckin).toISOString().split('T')[0] : null;

    if (lastDateStr === today) {
      return res.status(400).json({ success: false, message: 'Already checked in today!' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { icAmount, cycleDay, reset } = await EngagementService.processDailyCheckIn(userId, lastCheckin, client);
      
      await client.query('UPDATE users SET last_checkin_date = NOW() WHERE id = $1', [userId]);

      await client.query('COMMIT');
      return res.json({ 
        success: true, 
        message: reset 
            ? `Streak Reset! Day 1 Check-in Successful. Received ${icAmount} IC.`
            : `Day ${cycleDay} Check-in Successful! Received ${icAmount} IC.`,
        reward: icAmount,
        cycleDay,
        reset
      });
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
  const client = await pool.connect();
  try {
    // Prevent deleting yourself
    if (req.user.id === id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account.' });
    }

    await client.query('BEGIN');

    // Delete in dependency order to avoid FK constraint errors
    await client.query('DELETE FROM points_transactions WHERE user_id = $1', [id]);
    await client.query('DELETE FROM points_wallet WHERE user_id = $1', [id]);
    await client.query('DELETE FROM withdrawal_requests WHERE student_id = $1', [id]);
    await client.query('DELETE FROM commissions WHERE user_id = $1 OR source_user_id = $1', [id]);
    await client.query('DELETE FROM admissions WHERE student_id = $1', [id]);
    await client.query('DELETE FROM notifications WHERE user_id = $1', [id]);

    // Detach referral chain — set referred_by to null for users they referred
    await client.query('UPDATE users SET referred_by = NULL WHERE referred_by = $1', [id]);

    // Finally delete the user
    const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await client.query('COMMIT');
    return res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('deleteUser error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete user: ' + err.message });
  } finally {
    client.release();
  }
};

// GET /api/users/check-in/history
const getCheckInHistory = async (req, res) => {
  const userId = req.user.id;
  const { month, year, days } = req.query; // Optional filters

  try {
    let result;

    if (days) {
      // Rolling window: return check-ins from points_transactions
      const daysInt = parseInt(days, 10) || 7;
      result = await pool.query(
        `SELECT DATE(created_at) as date
         FROM points_transactions 
         WHERE user_id = $1 
           AND type = 'daily_checkin'
           AND created_at >= NOW() - INTERVAL '1 day' * $2
         ORDER BY created_at ASC`,
        [userId, daysInt]
      );
    } else {
      // Month/year filter from points_transactions
      const now = new Date();
      const filterMonth = month || (now.getMonth() + 1);
      const filterYear = year || now.getFullYear();

      result = await pool.query(
        `SELECT DATE(created_at) as date
         FROM points_transactions 
         WHERE user_id = $1 
           AND type = 'daily_checkin'
           AND EXTRACT(MONTH FROM created_at) = $2
           AND EXTRACT(YEAR FROM created_at) = $3
         ORDER BY created_at ASC`,
        [userId, filterMonth, filterYear]
      );
    }
    
    // Return unique dates only
    const dates = [...new Set(result.rows.map(r => r.date.toISOString().split('T')[0]))];
    
    return res.json({ success: true, data: dates });
  } catch (err) {
    console.error('getCheckInHistory error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch check-in history' });
  }
};
// GET /api/users/bonuses (Student)
const getBonuses = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 5 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const result = await pool.query(
      `SELECT id, type as bonus_type, rupees as amount, created_at 
       FROM points_transactions WHERE user_id = $1 AND (type LIKE '%bonus%' OR type IN ('daily_checkin', 'profile_completion'))
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM points_transactions WHERE user_id = $1 AND (type LIKE '%bonus%' OR type IN ('daily_checkin', 'profile_completion'))`,
      [userId]
    );


    return res.json({ 
      success: true, 
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        totalPages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('getBonuses error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch rewards history' });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  dailyCheckIn,
  getCheckInHistory,
  getBonuses,
  getStudents,
  getPendingReferrals,
  getAllUsers,
  updateUserRole,
  deleteUser,
  changePassword,
  updateNotificationSettings,
  deleteAccount
};
