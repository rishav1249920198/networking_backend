require('dotenv').config();
const request = require('supertest');
const app = require('./src/index'); // We will find the real path
const { signToken } = require('./src/utils/jwt');
const pool = require('./src/config/db');

// Create token for dk4066189@gmail.com
const targetUserId = 'a15116e0-edab-4a18-a971-c049a9844887'; // from previous script output
const token = signToken({ userId: targetUserId, role: 'co-admin' });

async function testApi() {
  try {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);
      
    console.log('STATUS:', res.statusCode);
    console.log('RESPONSE:', JSON.stringify(res.body, null, 2));
  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    pool.end();
  }
}

testApi();
