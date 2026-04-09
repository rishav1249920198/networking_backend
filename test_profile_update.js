const pool = require('./src/config/db');

async function testUpdate() {
  const userId = '1019c413-09b0-499d-812a-a157d3dfb353'; // Rishav's ID from provided token
  console.log('--- TESTING PROFILE UPDATE FOR', userId, '---');
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Test the specific UPDATE query
    console.log('Running UPDATE...');
    const res = await client.query(
      `UPDATE public.users SET full_name = $1, education = $2, address = $3, bio = $4 WHERE id = $5 RETURNING *`,
      ['Rishav kumar', '12th', 'munger', 'student', userId]
    );
    
    console.log('Update result rowCount:', res.rowCount);
    if (res.rowCount === 0) {
      console.log('WARNING: No rows were updated. Does the ID exist in public.users?');
    } else {
      console.log('Update successful. Row id:', res.rows[0].id);
    }
    
    await client.query('ROLLBACK'); // Don't persist test
    console.log('Test logic completed (rolled back).');
  } catch (err) {
    console.error('CRITICAL UPDATE ERROR:', err);
  } finally {
    client.release();
    process.exit();
  }
}

testUpdate();
