const pool = require('./src/config/db');

async function checkDb() {
  try {
    const res = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'admissions'`);
    console.log("Admissions table columns:", res.rows);
    if(res.rows.length === 0) {
      console.log("Admissions table DOES NOT EXIST!");
    }
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

checkDb();
