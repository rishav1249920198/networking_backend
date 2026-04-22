const pool = require('./src/config/db');

async function inspectTables() {
  const tables = ['otp_verifications', 'pending_registrations', 'admission_otps'];
  for (const table of tables) {
    console.log(`--- Table: ${table} ---`);
    try {
      const res = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1
      `, [table]);
      console.table(res.rows);
    } catch (err) {
      console.error(`Error inspecting ${table}:`, err.message);
    }
  }
  process.exit(0);
}

inspectTables();
