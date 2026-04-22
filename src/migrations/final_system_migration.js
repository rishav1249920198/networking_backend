const pool = require('../config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Phase 1: Altering Courses Table ---');
    await client.query(`
      ALTER TABLE courses 
      ADD COLUMN IF NOT EXISTS base_amount INTEGER DEFAULT 0
    `);

    // Initialize base_amount based on course names (case-insensitive)
    await client.query(`
      UPDATE courses SET base_amount = 50 WHERE name ILIKE '%DCA%' AND name NOT ILIKE '%ADCA%';
      UPDATE courses SET base_amount = 100 WHERE name ILIKE '%ADCA%';
      UPDATE courses SET base_amount = 150 WHERE name ILIKE '%BCA%';
      UPDATE courses SET base_amount = 200 WHERE name ILIKE '%MAX%';
    `);

    console.log('--- Phase 2: Altering Users Table ---');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS withdrawal_unlocked BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ref_position VARCHAR(10) CHECK (ref_position IN ('left', 'right'))
    `);

    console.log('--- Phase 2.5: Altering Points Tables ---');
    await client.query(`
      ALTER TABLE points_transactions 
      ADD COLUMN IF NOT EXISTS rupees NUMERIC(15,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS points NUMERIC(15,2) DEFAULT 0;

      ALTER TABLE points_wallet
      ADD COLUMN IF NOT EXISTS total_rupees NUMERIC(15,2) DEFAULT 0;
    `);


    console.log('--- Phase 3: System Settings ---');
    // Ensure system_settings table exists (usually does)
    await client.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('EARNING_MODEL', 'ladder_v2_tapered')
      ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
    `);

    await client.query('COMMIT');
    console.log('✅ Final System Migration successful.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
  } finally {
    client.release();
    process.exit();
  }
}

runMigration();
