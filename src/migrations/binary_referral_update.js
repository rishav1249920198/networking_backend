const pool = require('../config/db');

async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Adding binary tree columns to users table...');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS left_child_id UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS right_child_id UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS direct_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS placement_status VARCHAR(20) DEFAULT 'placed'
    `);

    console.log('Creating points_wallet table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS points_wallet (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        total_points NUMERIC(15,2) DEFAULT 0,
        total_rupees NUMERIC(15,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('Creating points_transactions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS points_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        admission_id UUID REFERENCES admissions(id) ON DELETE SET NULL,
        points NUMERIC(15,2) NOT NULL,
        rupees NUMERIC(15,2) NOT NULL,
        type VARCHAR(30) NOT NULL, 
        note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('Adding points column to courses table...');
    await client.query(`
      ALTER TABLE courses 
      ADD COLUMN IF NOT EXISTS points NUMERIC(10,2) DEFAULT 0
    `);

    // Insert wallet for all existing users if they don't have one
    console.log('Initializing points_wallet for existing users...');
    await client.query(`
      INSERT INTO points_wallet (user_id)
      SELECT id FROM users
      ON CONFLICT (user_id) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('Binary Referral and Points Systems migration successful.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

runMigration();
