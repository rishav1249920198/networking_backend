const pool = require('./src/config/db');

async function fixDb() {
  try {
    console.log("Dropping constraint...");
    await pool.query(`ALTER TABLE otp_verifications DROP CONSTRAINT IF EXISTS otp_verifications_purpose_check;`);
    console.log("Adding constraint...");
    await pool.query(`ALTER TABLE otp_verifications ADD CONSTRAINT otp_verifications_purpose_check CHECK (purpose IN ('register', 'forgot_password', 'mobile_verify', 'login'));`);
    console.log("Done.");
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

fixDb();
