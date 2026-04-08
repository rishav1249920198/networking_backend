const pool = require('../config/db');

const logAudit = async (adminId, targetId, action, details, ipAddress) => {
  try {
    const query = `
      INSERT INTO audit_logs (admin_id, target_id, action, details, ip_address)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const values = [adminId, targetId, action, details, ipAddress || 'unknown'];
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    // We log the error but do not throw it to prevent blocking the main transaction
    console.error('Failed to insert audit log:', error);
  }
};

module.exports = { logAudit };
