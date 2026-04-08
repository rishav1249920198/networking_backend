
const pool = require('./src/config/db');

async function fix() {
  try {
    console.log('Resetting partner_certificate_url for rishavk051@gmail.com...');
    await pool.query("UPDATE users SET partner_certificate_url = NULL WHERE email = 'rishavk051@gmail.com'");
    console.log('✅ SUCCESS');
  } catch (err) {
    console.error('❌ ERROR:', err);
  } finally {
    process.exit(0);
  }
}

fix();
