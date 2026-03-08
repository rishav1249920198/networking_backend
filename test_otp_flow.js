require('dotenv').config();
const request = require('supertest');
const app = require('./src/index');
const pool = require('./src/config/db');

async function runTests() {
  console.log('--- starting OTP system test ---');
  let otpCode = null;
  const testEmail = 'testotp@igcim.app';

  try {
    // 1. Send OTP Request
    console.log('1. Requesting OTP...');
    const res1 = await request(app)
      .post('/api/admissions/send-otp')
      .send({
        student_name: 'Test Student',
        student_email: testEmail,
        student_mobile: '9999999999'
      });
    
    if (!res1.body.success) {
      console.error('OTP Dispatch Failed:', res1.body);
      process.exit(1);
    }
    console.log('✅ OTP Dispatch OK');

    // 2. Extract OTP from DB mock
    const otpRes = await pool.query('SELECT otp FROM admission_otps WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [testEmail]);
    otpCode = otpRes.rows[0].otp;
    console.log(`✅ Extracted OTP: ${otpCode}`);

    // 3. Fake course lookup
    const courseRes = await pool.query('SELECT id FROM courses LIMIT 1');
    const courseId = courseRes.rows[0].id;

    // 4. Verify and Admit Reuqest
    console.log('3. Requesting verification & admission...');
    const res2 = await request(app)
      .post('/api/admissions/verify-and-admit')
      .send({
        student_name: 'Test Student',
        student_email: testEmail,
        student_mobile: '9999999999',
        otp: otpCode,
        course_id: courseId,
        payment_mode: 'cash',
        address: 'Test st'
      });
    
    if (!res2.body.success) {
      console.error('Verification Failed:', res2.body);
      process.exit(1);
    }
    console.log('✅ Verification & Admission OK');

    // 5. Verify User Auto-Creation
    const userRes = await pool.query('SELECT id, referral_code, system_id FROM users WHERE email = $1', [testEmail]);
    if (userRes.rows.length === 0) throw new Error('User not found');
    console.log('✅ Auto-created user found:', userRes.rows[0].referral_code);

    // 6. Cleanup mock test values
    await pool.query('DELETE FROM admissions WHERE student_email = $1', [testEmail]);
    await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);

    console.log('\n--- TESTS PASSED ---');
  } catch (err) {
    console.error('Test Error:', err);
  } finally {
    pool.end();
  }
}

runTests();
