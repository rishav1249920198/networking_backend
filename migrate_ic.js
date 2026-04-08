const pool = require('./src/config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Add flat IC commission to courses
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS commission_ic NUMERIC(10,2) DEFAULT NULL;`);
    
    // Default the flat IC to the current percentage calculation so existing system doesn't break
    await client.query(`
      UPDATE courses 
      SET commission_ic = (fee * commission_percent / 100)
      WHERE commission_ic IS NULL AND commission_percent IS NOT NULL;
    `);

    // Add flat IC snapshot to admissions
    await client.query(`ALTER TABLE admissions ADD COLUMN IF NOT EXISTS snapshot_commission_ic NUMERIC(10,2) DEFAULT NULL;`);
    
    // Update admissions
    await client.query(`
      UPDATE admissions 
      SET snapshot_commission_ic = (snapshot_fee * snapshot_commission_percent / 100)
      WHERE snapshot_commission_ic IS NULL AND snapshot_commission_percent IS NOT NULL;
    `);

    await client.query('COMMIT');
    console.log('Migration successful: Added commission_ic columns.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
