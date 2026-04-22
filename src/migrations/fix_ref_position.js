const pool = require('../config/db');

async function fixRefPosition() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('--- Fixing Position Column Collision ---');

        // 1. Ensure binary_position exists for tree placement
        await client.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS binary_position VARCHAR(10) CHECK (binary_position IN ('left', 'right'));
        `);

        // 2. Ensure ref_position is an integer (if it was messed up by IF NOT EXISTS logic)
        // Check current type
        const typeRes = await client.query(`
            SELECT data_type FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'ref_position'
        `);
        
        const currentType = typeRes.rows[0]?.data_type;
        console.log(`Current ref_position type: ${currentType}`);

        if (currentType === 'character varying') {
            console.log('Converting ref_position back to integer for referral indexing...');
            // Backup data if possible or just clear if it's junk
            await client.query(`ALTER TABLE users ALTER COLUMN ref_position TYPE INTEGER USING (CASE WHEN ref_position ~ '^[0-9]+$' THEN ref_position::integer ELSE 0 END)`);
        }

        await client.query('COMMIT');
        console.log('✅ Position columns successfully separated.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', err);
    } finally {
        client.release();
        process.exit();
    }
}

fixRefPosition();
