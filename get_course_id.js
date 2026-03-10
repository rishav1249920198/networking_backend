const pool = require('./src/config/db');
require('dotenv').config();

async function getCourse() {
  try {
    const res = await pool.query('SELECT id, name FROM courses LIMIT 1');
    console.log(JSON.stringify(res.rows[0]));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

getCourse();
