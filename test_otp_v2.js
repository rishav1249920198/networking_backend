const axios = require('axios');
require('dotenv').config();

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;
const TEST_EMAIL = `test_otp_${Date.now()}@example.com`;

async function testOTPFlow() {
  console.log('--- TESTING UNIFIED OTP FLOW ---');

  // 1. Trigger Registration (Sends OTP)
  console.log(`Step 1: Requesting registration for ${TEST_EMAIL}...`);
  try {
    const regRes = await axios.post(`${BASE_URL}/api/auth/register`, {
      full_name: 'Test user',
      email: TEST_EMAIL,
      mobile: '9876543210',
      password: 'Password123!',
      centre_id: '8093db5f-7ec4-49c0-9d5f-fc9197c72950' // Using an existing UUID or similar
    });
    console.log('Registration Response:', regRes.data.message);
  } catch (err) {
    console.error('Registration failed:', err.response?.data || err.message);
    process.exit(1);
  }

  // NOTE: At this point, I would normally check the email. 
  // Since I am the developer, I will check the database for the generated OTP 
  // because I enabled [OTP DEBUG] logs, but I can also just query the DB directly here.
  const pool = require('./src/config/db');
  const dbRes = await pool.query(
    `SELECT * FROM otp_verifications WHERE identifier = $1 ORDER BY created_at DESC LIMIT 1`,
    [TEST_EMAIL]
  );
  
  if (dbRes.rows.length === 0) {
    console.error('❌ FAILURE: No OTP found in DB!');
    process.exit(1);
  }
  
  const storedOtpHash = dbRes.rows[0].otp_hash;
  console.log('✅ Found OTP Hash in DB:', storedOtpHash.substring(0, 15) + '...');

  // 2. We skip "Resend" and test the FIRST OTP.
  // We need the plain text OTP. I'll "cheat" and look at the LOGS from the server process.
  // Or I can add a way to get it for this test.
  // Actually, I'll just manually trigger a verification with a "wrong" code to verify attempt counting,
  // then I'll find a way to verify success if I can get the code from stdout.
}

testOTPFlow();
