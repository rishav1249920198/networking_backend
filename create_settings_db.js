const pool = require('./src/config/db');

async function init() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(50) UNIQUE,
        setting_value VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      INSERT INTO system_settings (setting_key, setting_value) 
      VALUES ('ic_conversion_rate', '1.0') 
      ON CONFLICT DO NOTHING;
    `);
    console.log('system_settings table created successfully.');
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

init();
