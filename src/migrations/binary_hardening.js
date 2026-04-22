const pool = require('../config/db');

async function runHardeningMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Starting Production Hardening Migration ---');

    // 1. Add placement_attempts to users
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS placement_attempts INTEGER DEFAULT 0;
    `);

    // 2. Ensure placement_status exists and has correct default
    // Check if column exists first
    const statusColCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'placement_status';
    `);

    if (statusColCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE users ADD COLUMN placement_status VARCHAR(20) DEFAULT 'pending';
      `);
    } else {
      await client.query(`
        ALTER TABLE users ALTER COLUMN placement_status SET DEFAULT 'pending';
      `);
    }

    // 3. Add Unique Constraint to points_transactions
    // We use a DO block to avoid errors if the constraint already exists
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_payout') THEN
          ALTER TABLE points_transactions 
          ADD CONSTRAINT unique_payout UNIQUE (user_id, admission_id, type);
        END IF;
      END $$;
    `);

    // 4. Update system_settings with hardening parameters
    await client.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('max_override_per_admission', '2.0')
      ON CONFLICT (setting_key) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('min_withdrawal_amount', '300.0')
      ON CONFLICT (setting_key) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('✅ Hardening Migration Completed Successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Hardening Migration Failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

runHardeningMigration();
