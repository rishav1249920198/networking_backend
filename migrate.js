const pool = require('./src/config/db');
async function run() {
  try {
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_certificate_url TEXT;');
    await pool.query('ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS receipt_url TEXT;');
    console.log('DB MIGRATION SUCCESS: Columns added.');
  } catch(e) {
    console.error('DB MIGRATION FAIL:', e);
  } finally {
    pool.end();
  }
}
run();
