const pool = require('./config/db');

async function syncRefs() {
  try {
    const res = await pool.query(`
      UPDATE users u
      SET referred_by = a.referred_by_user_id
      FROM admissions a
      WHERE a.student_id = u.id
        AND u.referred_by IS NULL
        AND a.referred_by_user_id IS NOT NULL
    `);
    console.log(`Synced refereed_by for ${res.rowCount} users.`);
  } catch(e) { console.error('Error:', e); }
  process.exit();
}

syncRefs();
