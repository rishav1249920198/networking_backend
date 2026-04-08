const pool = require('../config/db');
const { logAudit } = require('../services/auditService');

// GET /api/settings
const getSettings = async (req, res) => {
  try {
    const result = await pool.query('SELECT setting_key, setting_value FROM system_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    return res.json({ success: true, data: settings });
  } catch (err) {
    console.error('Get settings error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch settings' });
  }
};

// PUT /api/settings
const updateSettings = async (req, res) => {
  // Only super_admin or admin can access (enforced by route middleware)
  const updates = req.body; // e.g. { ic_conversion_rate: '1.0' }
  const adminId = req.user.id;

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const [key, value] of Object.entries(updates)) {
      await client.query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_at) 
         VALUES ($1, $2, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
        [key, String(value)]
      );

      // Audit Log
      await logAudit(
        adminId,
        null,
        `update_setting_${key}`,
        `Updated system setting ${key} to ${value}`,
        req.ip
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, message: 'Settings updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update settings error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update settings' });
  } finally {
    client.release();
  }
};

module.exports = { getSettings, updateSettings };
