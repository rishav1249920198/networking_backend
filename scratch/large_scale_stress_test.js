const pool = require('../src/config/db');
const EarningEngine = require('../src/services/earningEngine');
const TreeEngine = require('../src/services/treeEngine');

async function runStressTest(totalUsers) {
    console.log(`\n=== STARTING STRESS TEST: ${totalUsers} USERS ===`);
    const client = await pool.connect();
    const startTime = Date.now();

    try {
        // 1. Setup Center & Role (Shared)
        const centreRes = await client.query('SELECT id FROM centres LIMIT 1');
        const centreId = centreRes.rows[0].id;
        const roleRes = await client.query("SELECT id FROM roles WHERE name = 'student'");
        const roleId = roleRes.rows[0].id;

        // 2. Setup 5% Cap Course
        const courseRes = await client.query(`
            INSERT INTO courses (name, category, fee, points, commission_cap_percent, levels_enabled, level_distribution, bonus_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
        `, [`StressTest_${totalUsers}_${Date.now()}`, 'General', 5000, 2, 5.0, 6, JSON.stringify({ L1: 0.4, L2: 0.2, L3: 0.15, L4: 0.1, L5: 0.08, L6: 0.07 }), true]);
        const courseId = courseRes.rows[0].id;
        console.log(`✅ Test Course (5% Cap): ${courseId}`);

        // 3. Root User
        const rootSystemId = `ROOT-${Date.now()}`;
        const rootRes = await client.query(`
            INSERT INTO users (full_name, email, password_hash, role_id, system_id, referral_code, mobile)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
        `, ['Stressor Root', `${rootSystemId}@test.com`, 'hash', roleId, rootSystemId, `R${rootSystemId}`, `9${Math.floor(Math.random()*1000000000)}`]);
        const rootId = rootRes.rows[0].id;

        // 4. Sequential Generation
        let users = [rootId];
        let totalRev = 0;
        let totalPay = 0;
        let capBreaches = 0;

        console.log(`Generating ${totalUsers} users...`);
        for (let i = 1; i <= totalUsers; i++) {
            // TRANSACTION PER ADMISSION (Stability)
            await client.query('BEGIN');
            try {
                const parentId = users[Math.floor(Math.random() * users.length)];
                const sysId = `U-${i}-${Date.now()}`;
                
                const res = await client.query(`
                    INSERT INTO users (full_name, email, password_hash, role_id, system_id, referral_code, referred_by, ref_position, mobile, centre_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
                `, [`User ${i}`, `${sysId}@test.com`, 'hash', roleId, sysId, `R${sysId}`, parentId, (i % 6) + 1, `9${Math.floor(Math.random()*1000000000)}`, centreId]);
                const userId = res.rows[0].id;
                users.push(userId);

                await TreeEngine.placeUser(userId, parentId, client);

                totalRev += 5000;
                const admRes = await client.query(`
                    INSERT INTO admissions (student_id, course_id, referred_by_user_id, status, snapshot_fee, admission_mode, centre_id, student_name, student_mobile, snapshot_commission_percent)
                    VALUES ($1, $2, $3, 'approved', 5000, 'online', $4, $5, $6, 5.0) RETURNING id
                `, [userId, courseId, parentId, centreId, `User ${i}`, `9999999999`]);
                
                const earnRes = await EarningEngine.processAdmissionEarning(admRes.rows[0].id, client);
                totalPay += parseFloat(earnRes.finalPayout);
                if (earnRes.finalPayout > earnRes.cap) capBreaches++;

                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            }

            if (i % 50 === 0) console.log(`   Processed ${i} admissions...`);
        }

        const duration = (Date.now() - startTime) / 1000;
        console.log("\n" + "=".repeat(40));
        console.log(`STRESS TEST RESULTS (${totalUsers} Users)`);
        console.log(`DURATION:    ${duration.toFixed(2)}s (${(totalUsers / duration).toFixed(2)} users/sec)`);
        console.log(`CAP BREACHES: ${capBreaches} ❌`);
        console.log(`TOTAL REV:   ₹${totalRev.toLocaleString()}`);
        console.log(`TOTAL PAY:   ₹${totalPay.toLocaleString()}`);
        console.log(`EXPENSE %:   ${((totalPay / totalRev) * 100).toFixed(2)}% (Cap: 5%)`);
        
        const rootBinary = await client.query('SELECT left_count, right_count, withdrawal_unlocked FROM users WHERE id = $1', [rootId]);
        console.log(`ROOT BINARY: L:${rootBinary.rows[0].left_count} R:${rootBinary.rows[0].right_count} (${rootBinary.rows[0].withdrawal_unlocked ? '🔓' : '🔒'})`);
        console.log("=".repeat(40));

        // CLEANUP (optional, but good for stress test iterative tiers)
        // await client.query('DELETE FROM users WHERE system_id LIKE \'U-%\' OR system_id LIKE \'ROOT-%\'');
        // await client.query('DELETE FROM courses WHERE id = $1', [courseId]);

    } catch (err) {
        console.error("STRESS TEST FAILED:", err);
    } finally {
        client.release();
    }
}

async function run() {
    await runStressTest(50);
    await runStressTest(200);
    await runStressTest(500);
    process.exit(0);
}

run();
