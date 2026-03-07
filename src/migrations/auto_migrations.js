require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const passwordHash = await bcrypt.hash('Rishav@1234', 10);
    const roleRes = await pool.query(`SELECT id FROM roles WHERE name = 'super_admin' OR name = 'admin' LIMIT 1`);
    const roleId = roleRes.rows[0].id;
    
    // Check if new admin exists to avoid duplication
    const check = await pool.query(`SELECT id FROM users WHERE email = 'rishavk051@gmail.com'`);
    if(check.rowCount === 0) {
      const insert = `
        INSERT INTO users (system_id, role_id, full_name, email, mobile, password_hash, referral_code, is_email_verified, is_mobile_verified)
        VALUES ('IGCIM_ADMIN', $1, 'Admin Rishav', 'rishavk051@gmail.com', '9999999999', $2, 'ADMINREF', true, true)
        RETURNING id
      `;
      const res = await pool.query(insert, [roleId, passwordHash]);
      console.log(`Created new admin with ID: ${res.rows[0].id}`);
    } else {
      console.log('New admin already exists.');
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
