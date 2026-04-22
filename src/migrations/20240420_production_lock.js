const pool = require('../config/db');

async function runProductionLockMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Phase 1: Upgrading Courses Table ---');
    await client.query(`
      ALTER TABLE courses 
      ADD COLUMN IF NOT EXISTS points NUMERIC(15,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cap_percent NUMERIC(5,2) DEFAULT 5.00,
      ADD COLUMN IF NOT EXISTS level_distribution JSONB DEFAULT '{"L1": 50, "L2": 20, "L3": 10, "L4": 10, "L5": 5, "L6": 5}',
      ADD COLUMN IF NOT EXISTS boost_enabled BOOLEAN DEFAULT TRUE;
    `);

    console.log('--- Phase 2: Upgrading Users Table ---');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS direct_referral_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS boost_level INTEGER DEFAULT 0;
    `);

    // Backfill direct_referral_count for existing users based on approved admissions
    await client.query(`
      UPDATE users u
      SET direct_referral_count = (
        SELECT COUNT(*) FROM admissions 
        WHERE referred_by_user_id = u.id AND status = 'approved'
      );
    `);

    console.log('--- Phase 3: Upgrading Points Transactions Table ---');
    await client.query(`
      ALTER TABLE points_transactions 
      ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS remaining_pool NUMERIC(15,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS source_admission_id UUID;
    `);

    console.log('--- Phase 4: Cleaning Deprecated Fields (Optional/Safety) ---');
    // We keep them for now but they will be ignored by the new engine. 
    // Massive deletion of columns can be risky if legacy code is still running.

    await client.query('COMMIT');
    console.log('✅ Production Lock Migration Successful');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runProductionLockMigration().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = runProductionLockMigration;
