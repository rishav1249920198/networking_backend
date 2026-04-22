const pool = require('./src/config/db');

async function auditData() {
  console.log('--- Table: courses ---');
  try {
    const res = await pool.query('SELECT name, points, base_amount, price FROM courses');
    console.table(res.rows);
  } catch (err) {
    console.error('Error courses:', err.message);
  }

  console.log('\n--- System Settings ---');
  try {
    const res = await pool.query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key LIKE '%override%' OR setting_key LIKE '%rate%'");
    console.table(res.rows);
  } catch (err) {
    console.error('Error settings:', err.message);
  }
  process.exit(0);
}

auditData();
