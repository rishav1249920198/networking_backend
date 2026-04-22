const pool = require('../config/db');

async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('ic_conversion_rate', '50')
      ON CONFLICT (setting_key) DO NOTHING;
    `);
    
    console.log('System settings table and default conversion rate initialized.');
  } catch (err) {
    console.error('Failed to ensure system settings:', err);
  } finally {
    pool.end();
  }
}

run();
