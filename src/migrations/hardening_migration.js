const pool = require('../config/db');

async function runHardeningMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Phase 1: Altering Users Table ---');
    
    // Add completion_bonus_given flag
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS completion_bonus_given BOOLEAN DEFAULT FALSE;
    `);

    // Handle ref_position conversion
    // If it exists as VARCHAR, we drop and re-create as INT for cleanliness
    await client.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS ref_position;
      ALTER TABLE users ADD COLUMN ref_position INTEGER;
    `);

    console.log('--- Phase 2: Backfilling ref_position Deterministically ---');
    // Using a window function to rank referrals per sponsor
    await client.query(`
      WITH RankedReferrals AS (
        SELECT 
          id, 
          referred_by, 
          ROW_NUMBER() OVER (PARTITION BY referred_by ORDER BY created_at ASC, id ASC) as rank
        FROM users
        WHERE referred_by IS NOT NULL
      )
      UPDATE users u
      SET ref_position = r.rank
      FROM RankedReferrals r
      WHERE u.id = r.id;
    `);

    // Now set ref_position to NOT NULL for new users (Sponsors themselves don't have it, so we can't make it strictly NOT NULL for all)
    // Actually, ref_position is NULL for the root nodes. That's fine.
    
    console.log('--- Phase 3: Hardening Points Transactions ---');
    
    // 1. Unique (admission_id, type) - Ensures one payout per admission per type
    // We check if it exists to avoid errors on re-run
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_points_admission_type') THEN
          ALTER TABLE points_transactions 
          ADD CONSTRAINT uq_points_admission_type UNIQUE (admission_id, type);
        END IF;
      END $$;
    `);

    // 2. Unique (user_id, type) for completion bonus
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_unique_bonus_completion') THEN
          CREATE UNIQUE INDEX idx_unique_bonus_completion 
          ON points_transactions (user_id, type) 
          WHERE (type = 'bonus_completion');
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('✅ Hardening Migration script prepared successfully.');
    console.log('IMPORTANT: Run this script to apply changes to production.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runHardeningMigration().catch(() => process.exit(1));
}

module.exports = runHardeningMigration;
