const pool = require('./src/config/db');

async function fixDb() {
  try {
    await pool.query(`ALTER TABLE admissions ALTER COLUMN student_id DROP NOT NULL;`);
    console.log("student_id column in admissions is now nullable.");
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

fixDb();
