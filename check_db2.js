const pool = require('./src/config/db');

async function checkDb() {
  try {
    const res = await pool.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'admissions' AND column_name = 'student_id';
    `);
    console.log("student_id column constraints:", res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

checkDb();
