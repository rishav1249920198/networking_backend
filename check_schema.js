const pool = require('./src/config/db');

async function checkSchema() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    console.log('USERS TABLE COLUMNS:');
    res.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type}`));

    const res2 = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'points_wallet'
    `);
    console.log('\nPOINTS_WALLET COLUMNS:');
    res2.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type}`));

  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

checkSchema();
