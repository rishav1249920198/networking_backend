const pool = require('./src/config/db');

async function fixConstraints() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Fixing constraints on pending_registrations ---');

    // Make otp_code and expires_at nullable in pending_registrations
    await client.query(`
      ALTER TABLE pending_registrations 
      ALTER COLUMN otp_code DROP NOT NULL,
      ALTER COLUMN expires_at DROP NOT NULL
    `);

    console.log('Columns otp_code and expires_at are now nullable.');

    await client.query('COMMIT');
    console.log('--- Constraint Fix Successful ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('--- Fix Failed ---', err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

fixConstraints();
