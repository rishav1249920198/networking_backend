const pool = require('../config/db');

async function runUserPolishMigration() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('--- Phase 1: Adding Profile columns to Users ---');
        
        await client.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS dob DATE,
            ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20),
            ADD COLUMN IF NOT EXISTS profile_completeness INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{"financial": true, "system": true, "marketing": false}',
            ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(20) DEFAULT 'system',
            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
        `);

        console.log('--- Phase 2: Updating existing completeness base ---');
        // Backfill completeness loosely based on what they have
        await client.query(`
            UPDATE users SET profile_completeness = 
            (
                CASE WHEN full_name IS NOT NULL AND full_name != '' THEN 25 ELSE 0 END +
                CASE WHEN email IS NOT NULL AND email != '' THEN 25 ELSE 0 END +
                CASE WHEN mobile IS NOT NULL AND mobile != '' THEN 25 ELSE 0 END +
                CASE WHEN education IS NOT NULL AND education != '' THEN 25 ELSE 0 END
            )
            WHERE profile_completeness = 0;
        `);

        await client.query('COMMIT');
        console.log('✅ User Polish Migration Successful');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', err);
        throw err;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    runUserPolishMigration().catch(() => process.exit(1));
}

module.exports = runUserPolishMigration;
