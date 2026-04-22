const pool = require('../config/db');

async function runLastMileMigration() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('--- Phase 1: Adding Hardening Columns ---');
        
        // Add earning_processed flag to admissions
        await client.query(`
            ALTER TABLE admissions 
            ADD COLUMN IF NOT EXISTS earning_processed BOOLEAN DEFAULT FALSE;
        `);

        // Add left_count and right_count to users
        await client.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS left_count INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS right_count INTEGER DEFAULT 0;
        `);

        console.log('--- Phase 2: Backfilling earning_processed ---');
        // Mark all existing approved admissions as processed to prevent double payout
        await client.query(`
            UPDATE admissions 
            SET earning_processed = TRUE 
            WHERE status = 'approved';
        `);

        console.log('--- Phase 3: Backfilling Tree Counts ---');
        // This function calculates total subtree members for a branch
        // We run it for every user who has children
        
        // 1. Reset all counts just in case
        await client.query('UPDATE users SET left_count = 0, right_count = 0');

        // 2. Fetch all users to calculate their counts
        const allUsers = await client.query('SELECT id, left_child_id, right_child_id FROM users');
        
        for (const user of allUsers.rows) {
            const getCount = async (childId) => {
                if (!childId) return 0;
                const res = await client.query(`
                    WITH RECURSIVE Subtree AS (
                        SELECT id FROM users WHERE id = $1
                        UNION ALL
                        SELECT u.id FROM users u INNER JOIN Subtree s ON s.id = u.parent_id
                    )
                    SELECT COUNT(*) FROM Subtree
                `, [childId]);
                return parseInt(res.rows[0].count);
            };

            const lCount = await getCount(user.left_child_id);
            const rCount = await getCount(user.right_child_id);

            if (lCount > 0 || rCount > 0) {
                await client.query(
                    'UPDATE users SET left_count = $1, right_count = $2 WHERE id = $3',
                    [lCount, rCount, user.id]
                );
            }
        }

        console.log('--- Phase 4: Standardizing Decimals ---');
        await client.query(`
            ALTER TABLE points_transactions 
            ALTER COLUMN rupees TYPE NUMERIC(15,2),
            ALTER COLUMN points TYPE NUMERIC(15,2);

            ALTER TABLE points_wallet 
            ALTER COLUMN total_points TYPE NUMERIC(15,2),
            ALTER COLUMN total_rupees TYPE NUMERIC(15,2);
        `);

        await client.query('COMMIT');
        console.log('✅ Last Mile Migration Successful');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', err);
        throw err;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    runLastMileMigration().catch(() => process.exit(1));
}

module.exports = runLastMileMigration;
