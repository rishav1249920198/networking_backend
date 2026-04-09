require('dotenv').config();
const pool = require('./src/config/db');

async function migrate() {
  const sql = `
    -- Add gamification columns to users
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_checkin_date DATE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT FALSE;

    -- Create bonuses table
    CREATE TABLE IF NOT EXISTS bonuses (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bonus_type VARCHAR(50) NOT NULL,
      amount     NUMERIC(10,2) NOT NULL, -- Stored in INR (stable value)
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Create index for faster lookups
    CREATE INDEX IF NOT EXISTS idx_bonuses_user_id ON bonuses(user_id);
  `;

  try {
    await pool.query(sql);
    console.log('✅ Gamification Migration Successful');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration Error:', err);
    process.exit(1);
  }
}

migrate();
