const pool = require('../config/db');

/**
 * Get all notifications for the current user (Filtered by student/admin scope)
 * @param {object} req 
 * @param {object} res 
 */
const getNotifications = async (req, res) => {
  const userId = req.user.id;
  const { scope = 'student' } = req.query;
  
  // Define types for each scope
  const studentTypes = ['referral', 'commission_credit', 'admission_update', 'withdrawal_update', 'course_launch', 'course_update', 'general', 'broadcast'];
  const adminTypes = ['admission_request', 'withdrawal_request', 'new_student', 'admin_action'];
  
  const targetTypes = scope === 'admin' ? adminTypes : studentTypes;

  try {
    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 AND type = ANY($2)
       ORDER BY created_at DESC LIMIT 10`,
      [userId, targetTypes]
    );
    
    const unreadCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications 
       WHERE user_id = $1 AND is_read = FALSE AND type = ANY($2)`,
      [userId, targetTypes]
    );
    
    return res.json({
      success: true,
      data: result.rows,
      unreadCount: unreadCount.rows[0].count
    });
  } catch (err) {
    console.error('Fetch Notifications Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
};

/**
 * Mark notifications as read for the current user (Only within the current scope)
 */
const markAsRead = async (req, res) => {
  const userId = req.user.id;
  const { scope = 'student' } = req.query;
  
  const studentTypes = ['referral', 'commission_credit', 'admission_update', 'withdrawal_update', 'course_launch', 'course_update', 'general', 'broadcast'];
  const adminTypes = ['admission_request', 'withdrawal_request', 'new_student', 'admin_action'];
  const targetTypes = scope === 'admin' ? adminTypes : studentTypes;

  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE 
       WHERE user_id = $1 AND type = ANY($2) AND is_read = FALSE`,
      [userId, targetTypes]
    );
    return res.json({ success: true, message: 'Notifications marked as read.' });
  } catch (err) {
    console.error('Mark as read error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update notifications.' });
  }
};

module.exports = { getNotifications, markAsRead };
