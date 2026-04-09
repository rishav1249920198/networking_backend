const pool = require('./src/config/db');

async function migrate() {
  try {
    const settingsRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'ic_conversion_rate'");
    const rate = parseFloat(settingsRes.rows[0]?.setting_value || '1.0');

    console.log(`Using conversion rate: ${rate}`);

    // If rate is not 1.0, we might have scaled values in the DB.
    // However, since we are moving to INR as source of truth:
    // Any existing IC values should remain as is IF they were already intended as INR.
    // BUT if the user already generated commissions like "30000" for a 300 Rs commission:
    // We should convert them back to 300.

    // 1. Identify commissions that look like IC (very large relative to fee)
    const commissions = await pool.query('SELECT id, amount, snapshot_fee, snapshot_percent FROM commissions');
    for (const c of commissions.rows) {
      const expectedInr = (parseFloat(c.snapshot_fee) * parseFloat(c.snapshot_percent)) / 100;
      // If the current amount is significantly larger than expected INR (e.g. 100x), it's likely scaling.
      if (Math.abs(parseFloat(c.amount) - expectedInr) > 1 && Math.abs(parseFloat(c.amount) - (expectedInr / rate)) < 1) {
          console.log(`Fixing commission ${c.id}: ${c.amount} -> ${expectedInr}`);
          await pool.query('UPDATE commissions SET amount = $1 WHERE id = $2', [expectedInr, c.id]);
      }
    }

    // 2. Clear existing withdrawal requests to be safe (since they might have mixed IC/INR amounts)
    // Or just clear all stats for a fresh start as requested implicitly
    // await pool.query('DELETE FROM withdrawal_requests');
    // await pool.query('DELETE FROM commissions');
    
    console.log('Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

migrate();
