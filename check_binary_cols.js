const pool = require('./src/config/db');

async function checkBinaryColumns() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND (column_name LIKE '%child%' OR column_name LIKE '%parent%' OR column_name LIKE '%placement%' OR column_name = 'direct_count')
    `);
    console.log('BINARY COLUMNS ON USERS:');
    res.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type}`));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

checkBinaryColumns();
