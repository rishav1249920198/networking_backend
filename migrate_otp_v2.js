const pool = require('./src/config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Migrating OTP System ---');

    // 1. Recreate otp_verifications with new schema
    // We drop and recreate because the schema is significantly different (otp_code -> otp_hash)
    // and context isolation is new.
    await client.query(`DROP TABLE IF EXISTS otp_verifications CASCADE`);
    
    await client.query(`
      CREATE TABLE otp_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        identifier TEXT NOT NULL,
        context TEXT NOT NULL,
        otp_hash TEXT NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        attempts INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Index for fast lookups
    await client.query(`
      CREATE INDEX idx_otp_lookup ON otp_verifications (identifier, context, is_used)
    `);

    // 2. Deprecate admission_otps (Optional: can keep table for now but logic moves away)
    console.log('Table otp_verifications created with context support.');

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
