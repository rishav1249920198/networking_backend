const pool = require('./src/config/db');

async function inspectSchema() {
  try {
    const colCheck = await pool.query(`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE table_name IN ('admissions', 'users', 'points_transactions')
      AND column_name IN ('earning_processed', 'left_count', 'right_count', 'withdrawal_unlocked', 'rupees', 'points')
    `);
    console.log('Columns found:');
    console.table(colCheck.rows);

    const constraints = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conrelid IN ('admissions'::regclass, 'users'::regclass, 'points_transactions'::regclass)
    `);
    console.log('Constraints found:');
    console.table(constraints.rows);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

inspectSchema();
