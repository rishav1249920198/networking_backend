const pool = require('../src/config/db');
const EarningEngine = require('../src/services/earningEngine');
const TreeEngine = require('../src/services/treeEngine');

async function runAudit() {
    console.log("=== STARTING ROBUST FINAL SYSTEM AUDIT (V8) ===");
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        console.log("✅ Transaction Started");

        // 1. Setup Test Course
        console.log("[1/6] Creating Audit Course...");
        const courseRes = await client.query(`
            INSERT INTO courses (name, category, fee, points, commission_cap_percent, levels_enabled, level_distribution, bonus_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
        `, ['Audit_3000', 'General', 3000, 1, 3.5, 4, JSON.stringify({ L1: 0.5, L2: 0.25, L3: 0.15, L4: 0.1 }), true]);
        const courseId = courseRes.rows[0].id;
        console.log(`✅ Course Created: ${courseId}`);

        // 2. Setup Root User
        console.log("[2/6] Setup Root User...");
        const rootRes = await client.query(`
            INSERT INTO users (full_name, email, password_hash, role_id, system_id, referral_code, mobile)
            VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name='student' LIMIT 1), $4, $5, $6) RETURNING id
        `, ['Root auditor', 'root@audit.com', 'hash', 'AUDIT-ROOT', 'AUDITROOT', '9000000000']);
        const rootId = rootRes.rows[0].id;

        // 3. Create 6 Level-1 Referrals (L1)
        console.log("[3/6] Setup 6 L1 Users...");
        const l1Users = [];
        for (let i = 1; i <= 6; i++) {
            const res = await client.query(`
                INSERT INTO users (full_name, email, password_hash, role_id, system_id, referral_code, referred_by, ref_position, mobile)
                VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name='student' LIMIT 1), $4, $5, $6, $7, $8) RETURNING id
            `, [`L1 User ${i}`, `l1_${i}@audit.com`, 'hash', `AUDIT-L1-${i}`, `L1CODE${i}`, rootId, i, `910000000${i}`]);
            const userId = res.rows[0].id;
            l1Users.push(userId);
            
            await TreeEngine.placeUser(userId, rootId, client);
        }

        // 4. Create 36 Level-2 Referrals (6 per L1)
        console.log("[4/6] Setup 36 L2 Users...");
        const l2Users = [];
        for (let i = 0; i < 6; i++) {
            const parentId = l1Users[i];
            for (let j = 1; j <= 6; j++) {
                const res = await client.query(`
                    INSERT INTO users (full_name, email, password_hash, role_id, system_id, referral_code, referred_by, ref_position, mobile)
                    VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name='student' LIMIT 1), $4, $5, $6, $7, $8) RETURNING id
                `, [`L2 User ${i}_${j}`, `l2_${i}_${j}@audit.com`, 'hash', `AUDIT-L2-${i}-${j}`, `L2CODE${i}${j}`, parentId, j, `9200000${i}${j}`]);
                const userId = res.rows[0].id;
                l2Users.push(userId);
                await TreeEngine.placeUser(userId, parentId, client);
            }
        }

        // 5. Process Admissions
        console.log("[5/6] Processing 42 Admissions...");
        const centreRes = await client.query('SELECT id FROM centres LIMIT 1');
        const centreId = centreRes.rows[0].id;

        const allUsersToProcess = await client.query(`
            SELECT u.id, u.referred_by, u.full_name, u.mobile 
            FROM users u WHERE u.system_id LIKE 'AUDIT-L%'
        `);

        for (const u of allUsersToProcess.rows) {
            const admRes = await client.query(`
                INSERT INTO admissions (
                    student_id, course_id, referred_by_user_id, status, 
                    snapshot_fee, admission_mode, centre_id,
                    student_name, student_mobile, snapshot_commission_percent
                )
                VALUES ($1, $2, $3, 'approved', 3000, 'online', $4, $5, $6, 3.5) RETURNING id
            `, [u.id, courseId, u.referred_by, centreId, u.full_name, u.mobile]);
            
            await EarningEngine.processAdmissionEarning(admRes.rows[0].id, client);
        }
        console.log("✅ Admissions processed successfully");

        // 6. FINAL ANALYSIS
        console.log("[6/6] Calculating Financial Results...");
        
        const totalRevenue = 42 * 3000;
        const payoutRes = await client.query(`
            SELECT SUM(rupees) as total FROM points_transactions
            WHERE admission_id IN (SELECT id FROM admissions WHERE course_id = $1)
        `, [courseId]);
        const totalPayout = parseFloat(payoutRes.rows[0].total || 0);

        const rootBinaryRes = await client.query('SELECT left_count, right_count, withdrawal_unlocked FROM users WHERE id = $1', [rootId]);
        const rootBinary = rootBinaryRes.rows[0];

        console.log("\n" + "=".repeat(40));
        console.log("ROOT USER AUDIT RESULTS");
        console.log(`L/R COUNT:   L:${rootBinary.left_count} R:${rootBinary.right_count}`);
        console.log(`WITHDRAW:    ${rootBinary.withdrawal_unlocked ? '🔓 UNLOCKED' : '🔒 LOCKED'}`);
        console.log("-".repeat(40));
        console.log(`TOTAL REV:   ₹${totalRevenue.toLocaleString()}`);
        console.log(`TOTAL PAY:   ₹${totalPayout.toLocaleString()}`);
        console.log(`EXPENSE %:   ${((totalPayout / totalRevenue) * 100).toFixed(2)}% (Target Cap: 3.50%)`);
        console.log("=".repeat(40));

        await client.query('ROLLBACK');
        console.log("\nAUDIT COMPLETED AND ROLLED BACK.");

    } catch (err) {
        console.error("\n❌ AUDIT FAILED:");
        console.error(err);
        if (client) await client.query('ROLLBACK');
    } finally {
        client.release();
        process.exit(0);
    }
}

runAudit();
