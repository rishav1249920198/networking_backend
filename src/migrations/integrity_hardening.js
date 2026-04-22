const pool = require('../config/db');

async function runIntegrityMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Starting Integrity Hardening Migration ---');

    // 1. Create Trigger to make points_transactions IMMUTABLE
    await client.query(`
      CREATE OR REPLACE FUNCTION protect_points_ledger()
      RETURNS TRIGGER AS $$
      BEGIN
          RAISE EXCEPTION 'Modification of points ledger is strictly prohibited for production integrity.';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'block_ledger_updates') THEN
          CREATE TRIGGER block_ledger_updates
          BEFORE UPDATE OR DELETE ON points_transactions
          FOR EACH ROW EXECUTE FUNCTION protect_points_ledger();
        END IF;
      END $$;
    `);
    console.log('✅ Points Transactions set to IMMUTABLE (Trigger Active)');

    // 2. Insert Missing Settings for Financial Logic
    const settings = [
      ['override_percent_l1', '0.01'], // 1%
      ['override_percent_l2', '0.005'], // 0.5%
      ['max_withdrawal_per_day', '1']
    ];

    for (const [key, val] of settings) {
      await client.query(`
        INSERT INTO system_settings (setting_key, setting_value)
        VALUES ($1, $2)
        ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;
      `, [key, val]);
    }
    console.log('✅ Financial config parameters updated in system_settings');

    await client.query('COMMIT');
    console.log('✅ Integrity Migration Completed Successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Integrity Migration Failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

runIntegrityMigration();
