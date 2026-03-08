require('dotenv').config();
const pool = require('./src/config/db');

async function checkData() {
  try {
    const userRes = await pool.query(`
      SELECT u.id, u.email, r.name as role 
      FROM users u 
      JOIN roles r ON u.role_id = r.id 
      WHERE u.email = $1
    `, ['dk4066189@gmail.com']);
    
    console.log('User:', userRes.rows);

    if (userRes.rows.length > 0) {
      const userId = userRes.rows[0].id;
      
      // Try querying a referrals table if it exists
      try {
        const refTableRes = await pool.query('SELECT * FROM referrals WHERE referrer_id = $1', [userId]);
        console.log('referrals table count:', refTableRes.rows.length);
      } catch (e) {
        console.log('referrals table error:', e.message);
      }

      // Query from users table
      const refUsersRes = await pool.query('SELECT id, email FROM users WHERE referred_by = $1', [userId]);
      console.log('users referred_by count:', refUsersRes.rows.length);

      // Query from admissions table
      const admRes = await pool.query('SELECT id, status FROM admissions WHERE referred_by_user_id = $1', [userId]);
      console.log('admissions referred_by_user_id count:', admRes.rows.length);

      // Query from commissions table
      const commRes = await pool.query('SELECT id, amount, status FROM commissions WHERE referrer_id = $1', [userId]);
      console.log('commissions referrer_id count:', commRes.rows.length);
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    pool.end();
  }
}

checkData();
