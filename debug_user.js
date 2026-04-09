const pool = require('./src/config/db');

async function debug() {
  const email = 'dk4066189@gmail.com';
  console.log('--- DEBUG START ---');
  try {
    const user = await pool.query('SELECT id, full_name, profile_completed FROM public.users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      console.log('ERROR: User not found with email:', email);
      return;
    }
    const u = user.rows[0];
    console.log('USER ID:', u.id);
    console.log('CURRENT NAME IN DB:', u.full_name);
    console.log('PROFILE COMPLETED:', u.profile_completed);

    const bonuses = await pool.query('SELECT * FROM bonuses WHERE user_id = $1', [u.id]);
    console.log('BONUSES FOUND:', bonuses.rows.length);
    bonuses.rows.forEach(b => console.log(` - ${b.bonus_type}: ${b.amount}`));

    const ledger = await pool.query(`
      WITH comm_sums AS (SELECT COALESCE(SUM(amount), 0) AS c FROM commissions WHERE referrer_id = $1),
           bonus_sums AS (SELECT COALESCE(SUM(amount), 0) AS b FROM bonuses WHERE user_id = $1),
           req_sums AS (SELECT COALESCE(SUM(amount), 0) AS r FROM withdrawal_requests WHERE student_id = $1 AND status != 'rejected')
      SELECT (c.c + b.b - r.r) AS balance FROM comm_sums c, bonus_sums b, req_sums r
    `, [u.id]);
    console.log('CALCULATED BALANCE:', ledger.rows[0].balance);

  } catch (err) {
    console.error('DEBUG ERROR:', err);
  } finally {
    process.exit();
  }
}

debug();
