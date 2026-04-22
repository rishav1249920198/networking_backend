const pool = require('./src/config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Migrating Courses Table for Dynamic Commissions ---');

    // Add new columns to courses table
    await client.query(`
      ALTER TABLE courses 
      ADD COLUMN IF NOT EXISTS commission_cap_percent NUMERIC(5,2) DEFAULT 3.5,
      ADD COLUMN IF NOT EXISTS levels_enabled INTEGER DEFAULT 4,
      ADD COLUMN IF NOT EXISTS level_distribution JSONB DEFAULT '{"L1": 0.50, "L2": 0.25, "L3": 0.15, "L4": 0.10}',
      ADD COLUMN IF NOT EXISTS bonus_enabled BOOLEAN DEFAULT TRUE;
    `);

    console.log('Columns added successfully.');

    // Update existing records to have base_amount aligned with points if needed
    // (Optional, just ensuring data consistency)
    await client.query(`
      UPDATE courses SET base_amount = points * 50 WHERE base_amount = 0 OR base_amount IS NULL;
    `);

    await client.query('COMMIT');
    console.log('--- Migration Successful ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('--- Migration Failed ---', err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();
