const pool = require('../config/db');

/**
 * Create a new notification for a user
 * @param {string} userId - Recipient ID
 * @param {string} title - Notification title
 * @param {string} message - Detailed message
 * @param {string} type - 'referral', 'admission', 'commission', 'withdrawal'
 * @param {string} link - Optional frontend link
 */
const createNotification = async (userId, title, message, type = 'general', link = null) => {
  try {
    if (!userId) return; // Prevent errors if user ID is missing
    
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, title, message, type, link]
    );
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
};

/**
 * Notify all super admins and center admins
 * @param {string} title 
 * @param {string} message 
 * @param {string} type 
 * @param {string} link 
 * @param {string} centreId - Optional, notify only admins of this centre
 */
const notifyAdmins = async (title, message, type = 'admin_action', link = null, centreId = null) => {
  try {
    let query = `
      SELECT u.id FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE r.name IN ('super_admin', 'admin', 'co-admin')
    `;
    
    const params = [];
    if (centreId) {
      query += ` AND (u.centre_id = $1 OR r.name = 'super_admin')`;
      params.push(centreId);
    }

    const admins = await pool.query(query, params);
    
    const notifications = admins.rows.map(admin => 
      pool.query(
        `INSERT INTO notifications (user_id, title, message, type, link) VALUES ($1, $2, $3, $4, $5)`,
        [admin.id, title, message, type, link]
      )
    );
    
    await Promise.all(notifications);
  } catch (err) {
    console.error('Failed to notify admins:', err);
  }
};

/**
 * Broadcast a notification to ALL active students in the system
 * @param {string} title 
 * @param {string} message 
 * @param {string} type 
 * @param {string} link 
 */
const notifyAllStudents = async (title, message, type = 'broadcast', link = null) => {
  try {
    // Fetch all active students and co-admins (since both can refer)
    const recipients = await pool.query(
      `SELECT u.id FROM users u 
       JOIN roles r ON r.id = u.role_id 
       WHERE r.name IN ('student', 'co-admin') AND u.is_active = TRUE`
    );

    if (recipients.rows.length === 0) return;

    // Use a multi-row insert for efficiency if possible, or Promise.all
    const notifications = recipients.rows.map(user => 
      pool.query(
        `INSERT INTO notifications (user_id, title, message, type, link) VALUES ($1, $2, $3, $4, $5)`,
        [user.id, title, message, type, link]
      )
    );
    
    await Promise.all(notifications);
    console.log(`[NotificationService] Broadcast sent to ${recipients.rows.length} recipients: ${title}`);
  } catch (err) {
    console.error('Failed to broadcast to all students:', err);
  }
};

module.exports = { createNotification, notifyAdmins, notifyAllStudents };
