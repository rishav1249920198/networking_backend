require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const runMigrations = async () => {
  try {
    console.log('Running database optimizations...');
    
    // 5. Database Optimization - Add Indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
      CREATE INDEX IF NOT EXISTS idx_admissions_student_id ON admissions(student_id);
      CREATE INDEX IF NOT EXISTS idx_admissions_course_id ON admissions(course_id);
      CREATE INDEX IF NOT EXISTS idx_commissions_user_id ON commissions(referrer_id);
    `);
    console.log('✅ Added indexes to users, admissions, and commissions tables.');

    // 4. Commission System Improvements - Modify status check if needed
    // (Adding 'paid' if it isn't in the original CHECK constraint. PostgreSQL requires dropping and recreating check constraints).
    await pool.query(`
      ALTER TABLE commissions DROP CONSTRAINT IF EXISTS commissions_status_check;
      ALTER TABLE commissions ADD CONSTRAINT commissions_status_check CHECK (status IN ('pending','approved','rejected','paid'));
    `);
    console.log('✅ Updated commissions status ENUM check constraints.');

  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    pool.end();
  }
};

runMigrations();
