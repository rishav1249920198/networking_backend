const pool = require('../config/db');

async function runOptimization() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('--- Phase 1: Ledger Hardening ---');

        // 1. Add metadata to points_transactions for audit purposes
        await client.query(`
            ALTER TABLE points_transactions 
            ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
        `);

        console.log('--- Phase 2: Indexing for Speed ---');

        // 2. Add indexes for Tree Engine
        await client.query('CREATE INDEX IF NOT EXISTS idx_users_parent_id ON users(parent_id)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_users_placement_status ON users(placement_status)');
        
        // 3. Add indexes for Admissions & Earnings
        await client.query('CREATE INDEX IF NOT EXISTS idx_admissions_student_id ON admissions(student_id)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_admissions_status ON admissions(status)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_admissions_course_id ON admissions(course_id)');

        // 4. Ensure ref_position indexing for binary logic
        await client.query('CREATE INDEX IF NOT EXISTS idx_users_binary_position ON users(binary_position)');

        await client.query('COMMIT');
        console.log('✅ Optimization & Hardening Migration Successful');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', err);
    } finally {
        client.release();
        process.exit();
    }
}

runOptimization();
