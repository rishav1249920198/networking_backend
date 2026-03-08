const pool = require('./config/db');
const fs = require('fs');

async function debug() {
  const users = await pool.query('SELECT id, system_id, full_name, role_id, centre_id, referred_by FROM users');
  const roles = await pool.query('SELECT id, name FROM roles');
  const adms = await pool.query('SELECT id, student_id, centre_id, referred_by_user_id FROM admissions');
  const comms = await pool.query('SELECT id, admission_id, referrer_id, amount FROM commissions');

  fs.writeFileSync('db_debug.json', JSON.stringify({
    users: users.rows,
    roles: roles.rows,
    admissions: adms.rows,
    commissions: comms.rows
  }, null, 2));

  process.exit();
}
debug();
