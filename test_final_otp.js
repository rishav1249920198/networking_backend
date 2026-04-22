const axios = require('axios');
require('dotenv').config();

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;
const TEST_EMAIL = `test_otp_final@example.com`;

async function testFinalOTP() {
  console.log('--- FINAL OTP VERIFICATION TEST ---');

  // 1. Request OTP
  await axios.post(`${BASE_URL}/api/auth/register`, {
    full_name: 'Final Test',
    email: TEST_EMAIL,
    mobile: '1212121212',
    password: 'Password123!',
    centre_id: '8093db5f-7ec4-49c0-9d5f-fc9197c72950'
  });

  // 2. Try WRONG OTP
  try {
    console.log('Testing WRONG OTP (expecting failure)...');
    await axios.post(`${BASE_URL}/api/auth/verify-otp`, {
      email: TEST_EMAIL,
      otp: '000000'
    });
  } catch (err) {
    console.log('✅ Correctly rejected wrong OTP:', err.response?.data.message);
  }

  // 3. To test SUCCESS, I need to see the log.
  console.log('Check your terminal logs for the [OTP DEBUG] values now.');
  process.exit(0);
}

testFinalOTP();
