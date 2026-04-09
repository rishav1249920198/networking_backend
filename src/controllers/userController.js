const pool = require('../config/db');

// GET /api/users/profile
const getProfile = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT full_name, email, mobile, system_id, referral_code, 
              profile_completed, last_checkin_date 
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

      const userRes = await client.query('SELECT profile_completed FROM users WHERE id = $1', [userId]);
      const wasCompleted = userRes.rows[0]?.profile_completed;

      // Update user info
      await client.query(
        `UPDATE users SET full_name = $1 WHERE id = $2`,
        [full_name, userId]
      );

      // We don't have columns for education/address in users yet, but we'll simulate success 
      // or the user can add them later. For now, we update profile_completed to grant bonus.
      
      let bonusGranted = false;
      if (!wasCompleted) {
        await client.query('UPDATE users SET profile_completed = TRUE WHERE id = $1', [userId]);
        
        // Grant 100 IC (₹1.00) Bonus
        await client.query(
          `INSERT INTO bonuses (user_id, bonus_type, amount) VALUES ($1, 'profile_completion', 1.00)`,
          [userId]
        );
        bonusGranted = true;
      }

      await client.query('COMMIT');
      return res.json({ 
        success: true, 
        message: 'Profile updated successfully!',
        bonus_granted: bonusGranted 
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

module.exports = {
  getProfile,
  updateProfile,
  dailyCheckIn
};
