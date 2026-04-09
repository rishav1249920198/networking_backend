const pool = require('./src/config/db');

async function migrate() {
  console.log('--- STARTING MIGRATION ---');
  try {
    console.log('Testing connection...');
    const testR = await pool.query('SELECT 1');
    console.log('Connection OK');

    console.log('Adding columns to users table...');
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS education VARCHAR(255), 
      ADD COLUMN IF NOT EXISTS address TEXT, 
      ADD COLUMN IF NOT EXISTS bio TEXT
    `);
    console.log('Columns added/verified');

    console.log('Verifying columns...');
    const result = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
    const cols = result.rows.map(r => r.column_name);
    console.log('Current users columns:', cols.join(', '));
    
    if (cols.includes('education') && cols.includes('address') && cols.includes('bio')) {
      console.log('SUCCESS: All profile columns are present.');
    } else {
      console.log('FAILURE: Columns missing after migration attempt.');
    }

  } catch (err) {
    console.error('MIGRATION ERROR:', err);
  } finally {
    process.exit();
  }
}

migrate();
