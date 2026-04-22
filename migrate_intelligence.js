const pool = require('./src/config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('--- STARTING INTELLIGENCE UPGRADE MIGRATION ---');
    await client.query('BEGIN');

    // 1. Hardening withdrawal_requests
    console.log('Upgrading withdrawal_requests...');
    await client.query(`
      ALTER TABLE withdrawal_requests 
      ADD COLUMN IF NOT EXISTS payout_reference_id TEXT,
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id)
    `);

    // 2. Backfill existing 'paid' withdrawals
    console.log('Backfilling existing paid withdrawals...');
    await client.query(`
      UPDATE withdrawal_requests 
      SET 
        payout_reference_id = 'LEGACY',
        paid_at = COALESCE(reviewed_at, created_at),
        admin_notes = COALESCE(admin_notes || ' ', '') || '[Legacy Payout]'
      WHERE status = 'paid' AND payout_reference_id IS NULL
    `);

    // 3. Cleanup: Remove DB-based conversion rate to ensure conversionUtils is source of truth
    console.log('Removing ic_conversion_rate from system_settings...');
    await client.query(`DELETE FROM system_settings WHERE setting_key = 'ic_conversion_rate'`);

    // 4. Upgrading admissions for Fraud & IP signals
    console.log('Upgrading admissions...');
    await client.query(`
      ALTER TABLE admissions 
      ADD COLUMN IF NOT EXISTS client_ip TEXT,
      ADD COLUMN IF NOT EXISTS fraud_flags JSONB DEFAULT '[]'
    `);

    // 5. Upgrading users for Fraud persistence
    console.log('Upgrading users...');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS fraud_flags JSONB DEFAULT '[]'
    `);

    await client.query('COMMIT');
    console.log('--- MIGRATION COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('--- MIGRATION FAILED ---', err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();
