const pool = require('./src/config/db');
const FraudService = require('./src/services/fraudService');

async function testFraud() {
  try {
    console.log('--- TESTING FRAUD DETECTION SIGNALS ---');
    
    // 1. Check IP Burst logic (Insert dummy admissions if needed, but let's just mock/check)
    const ip = '127.0.0.1';
    console.log(`Checking IP: ${ip}`);
    
    // We'll insert 11 fake admissions for this IP to trigger 'Strong' alert
    await pool.query('BEGIN');
    for(let i=0; i<12; i++) {
        await pool.query(`
          INSERT INTO admissions (centre_id, course_id, student_id, student_name, student_mobile, student_email, client_ip, snapshot_fee, snapshot_commission_percent, snapshot_commission_ic, admission_mode)
          VALUES ((SELECT id FROM centres LIMIT 1), (SELECT id FROM courses LIMIT 1), NULL, 'Fraud Test', '000000000${i}', 'test${i}@fraud.com', $1, 500, 10, 1, 'online')
          RETURNING id
        `, [ip]);
    }
    
    const lastAdm = await pool.query("SELECT id FROM admissions WHERE client_ip = $1 ORDER BY created_at DESC LIMIT 1", [ip]);
    const admissionId = lastAdm.rows[0].id;
    
    const flags = await FraudService.getFraudFlags(admissionId);
    console.log('Detected Flags:', flags);

    if (flags.includes('IP Burst: Strong Alert (10+)')) {
        console.log('✅ IP Burst Tiering works!');
    } else {
        console.error('❌ IP Burst Tiering failed expected result.');
    }

    await pool.query('ROLLBACK'); // Don't persist test data
    console.log('--- TEST COMPLETED ---');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

testFraud();
