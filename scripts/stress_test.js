const pool = require('../src/config/db');
const EarningEngine = require('../src/services/earningEngine');

async function simulate(userCount = 50) {
    console.log(`\n🚀 Starting Stress Test: ${userCount} Users`);
    const client = await pool.connect();
    
    try {
        // 1. Setup Test Course
        const courseRes = await client.query(`
            INSERT INTO courses (name, category, fee, points, cap_percent, level_distribution, boost_enabled, centre_id)
            VALUES ('STRESS_TEST_COURSE', 'computer', 1000, 1, 6.0, '{"L1": 50, "L2": 25, "L3": 25}', true, (SELECT id FROM centres LIMIT 1))
            RETURNING id
        `);
        const courseId = courseRes.rows[0].id;

        // 2. Create Users & Admissions
        const rootUserRes = await client.query(`SELECT id, referral_code FROM users LIMIT 1`);
        let lastReferrerId = rootUserRes.rows[0].id;
        const roleRes = await client.query("SELECT id FROM roles WHERE name = 'student' LIMIT 1");
        const studentRoleId = roleRes.rows[0].id;
        const centreIdRes = await client.query('SELECT id FROM centres LIMIT 1');
        const defaultCentreId = centreIdRes.rows[0].id;

        const admissionIds = [];

        for (let i = 1; i <= userCount; i++) {
            const studentEmail = `stress_user_${Date.now()}_${i}@test.com`;
            const studentName = `Stress User ${i}`;
            
            const newUserRes = await client.query(`
                INSERT INTO users (full_name, email, mobile, password_hash, referral_code, centre_id, referred_by, system_id, role_id)
                VALUES ($1, $2, $3, 'hash', $4, $5, $6, $7, $8)
                RETURNING id
            `, [studentName, studentEmail, `${Math.floor(6000000000 + Math.random() * 3000000000)}`, `STRESS${i}${Date.now()}`, defaultCentreId, lastReferrerId, `SYS${Date.now()}${i}`, studentRoleId]);
            
            const studentId = newUserRes.rows[0].id;

            const admRes = await client.query(`
                INSERT INTO admissions (student_id, course_id, referred_by_user_id, status, snapshot_fee, snapshot_commission_percent, student_name, centre_id, admission_mode, student_mobile, student_email)
                VALUES ($1, $2, $3, 'approved', 1000, 5, $4, $5, 'online', $6, $7)
                RETURNING id
            `, [studentId, courseId, lastReferrerId, studentName, defaultCentreId, `${Math.floor(6000000000 + Math.random() * 3000000000)}`, studentEmail]);
            
            admissionIds.push(admRes.rows[0].id);
            lastReferrerId = studentId;
        }

        // 3. Sequential Commission Processing (To verify rolling cap)
        for (const id of admissionIds) {
            await EarningEngine.processAdmissionEarning(id);
        }

        // 4. Verification
        console.log(`\n📊 VERIFICATION REPORT`);
        
        const breachCheck = await client.query(`
            SELECT admission_id, SUM(rupees) as total 
            FROM points_transactions 
            GROUP BY admission_id 
            HAVING SUM(rupees) > 60.1
        `);
        
        if (breachCheck.rows.length > 0) {
            console.error(`❌ CAP BREACH DETECTED!`);
        } else {
            console.log(`✅ PASS: Cap enforcement solid.`);
        }

        const boostCheck = await client.query(`
            SELECT direct_referral_count, boost_level FROM users WHERE system_id LIKE 'SYS%' LIMIT 5
        `);
        console.log(`ℹ️  Progression samples:`, boostCheck.rows);

        const withdrawalCheck = await client.query(`
            SELECT COUNT(*) FROM users WHERE withdrawal_unlocked = TRUE AND system_id LIKE 'SYS%'
        `);
        console.log(`ℹ️  Withdrawal Unlocked: ${withdrawalCheck.rows[0].count} users.`);

    } catch (err) {
        console.error(`❌ TEST FAILED:`, err);
    } finally {
        client.release();
        process.exit();
    }
}

simulate(50);
