const pool = require('../config/db');
const TreeEngine = require('../services/treeEngine');
const EarningEngine = require('../services/earningEngine');
const AdmissionService = require('../services/AdmissionService');

async function verify() {
  console.log('--- Binary System Verification Start ---');
  
  try {
    // 0. Setup: Ensure a course has points
    const courseRes = await pool.query("UPDATE courses SET points = 2 WHERE id = (SELECT id FROM courses WHERE points = 0 LIMIT 1) RETURNING id");
    if (courseRes.rows.length === 0) throw new Error('No course found to update points');
    const courseId = courseRes.rows[0].id;
    console.log(`Using course: ${courseId} with 2 points`);

    const centreRes = await pool.query('SELECT id FROM centres LIMIT 1');
    const centreId = centreRes.rows[0].id;
    
    const roleRes = await pool.query("SELECT id FROM roles WHERE name = 'student'");
    const roleId = roleRes.rows[0].id;

    // 1. Create a dummy sponsor
    const sponsorEmail = `sponsor_${Date.now()}@test.com`;
    const sponsorRes = await pool.query(
      "INSERT INTO users (system_id, centre_id, role_id, full_name, email, mobile, password_hash, referral_code) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [`S_${Date.now().toString().slice(-8)}`, centreId, roleId, 'Test Sponsor', sponsorEmail, `999${Math.floor(Math.random()*1000000)}`, 'hash', `R${Date.now().toString().slice(-8)}`]
    );
    const sponsorId = sponsorRes.rows[0].id;
    console.log(`Created Sponsor: ${sponsorId}`);

    // 2. Simulate 6 placements under this sponsor to verify spillover balance
    const userIds = [];
    for (let i = 1; i <= 6; i++) {
        const uEmail = `user_${i}_${Date.now()}@test.com`;
        const uRes = await pool.query(
            "INSERT INTO users (system_id, centre_id, role_id, full_name, email, mobile, password_hash, referral_code) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
            [`SYS_${i}_${Date.now().toString().slice(-8)}`, centreId, roleId, `Test User ${i}`, uEmail, `900${Math.floor(Math.random()*1000000)}`, 'hash', `R${i}${Date.now().toString().slice(-8)}`]
        );
        const uId = uRes.rows[0].id;
        userIds.push(uId);
        
        console.log(`Placing User ${i}...`);
        const placement = await TreeEngine.placeUser(uId, sponsorId);
        console.log(`User ${i} placed under Parent: ${placement.parentId} at Position: ${placement.position}`);
    }

    // 3. Verify balance (Sponsor should have Level 1: 2 children, Level 2: 4 children)
    const sponsorChildren = await pool.query("SELECT left_child_id, right_child_id FROM users WHERE id = $1", [sponsorId]);
    console.log('Sponsor Direct Children:', sponsorChildren.rows[0]);

    // 4. Simulate Admission for User 3 (should be in Sponsor's Left subtree or Right depending on BFS)
    const createAndApprove = async (studentId, referrerId) => {
        const admission = await pool.query(
            `INSERT INTO admissions (centre_id, course_id, student_id, referred_by_user_id, admission_mode, status, snapshot_fee, snapshot_commission_percent, student_name, student_mobile)
             VALUES ($1, $2, $3, $4, 'online', 'approved', 5000, 10, $5, $6) RETURNING id`,
            [centreId, courseId, studentId, referrerId, 'Test Student', '9999999999']
        );
        const admId = admission.rows[0].id;
        await EarningEngine.processAdmissionEarning(admId);
        return admId;
    };

    console.log('Approving admissions for subtree users...');
    await createAndApprove(userIds[2], sponsorId); // User 3 (Left subtree)
    await createAndApprove(userIds[4], sponsorId); // User 5 (Right subtree)

    // 5. Check Withdrawal Eligibility for Sponsor
    const subtree = await TreeEngine.getSubtreeAdmissions(sponsorId);
    console.log('Sponsor Subtree Admissions:', subtree);

    if (subtree.leftCount >= 1 && subtree.rightCount >= 1) {
        console.log('✅ Sponsor is eligible for withdrawal!');
    } else {
        console.error('❌ Sponsor NOT eligible for withdrawal. Something is wrong with placement balance or count.');
    }

    // 6. Check points_wallet for sponsor
    const wallet = await pool.query("SELECT * FROM points_wallet WHERE user_id = $1", [sponsorId]);
    console.log('Sponsor Wallet:', wallet.rows[0]);

    // 7. Check for Extra Overrides
    const parentIdRes = await pool.query("SELECT parent_id FROM users WHERE id = $1", [sponsorId]);
    if (parentIdRes.rows[0]?.parent_id) {
        const rootWallet = await pool.query("SELECT * FROM points_wallet WHERE user_id = $1", [parentIdRes.rows[0].parent_id]);
        console.log('Grandparent Wallet (seeking overrides):', rootWallet.rows[0]);
    }

    console.log('--- Verification Complete ---');
  } catch (err) {
    console.error('Verification Failed:', err);
  } finally {
    pool.end();
  }
}

verify();
