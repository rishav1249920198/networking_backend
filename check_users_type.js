const pool = require('./src/config/db');

async function check() {
  try {
    const res = await pool.query(`
      SELECT table_schema, table_name, table_type 
      FROM information_schema.tables 
      WHERE table_name = 'users'
    `);
    console.log(JSON.stringify(res.rows));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();
