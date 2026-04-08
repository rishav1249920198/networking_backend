const pool = require('./src/config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(`ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS inr_amount NUMERIC(10,2) DEFAULT NULL;`);
    await client.query(`UPDATE withdrawal_requests SET inr_amount = amount WHERE inr_amount IS NULL;`);

    await client.query('COMMIT');
    console.log('Migration successful: Added inr_amount to withdrawal_requests.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
