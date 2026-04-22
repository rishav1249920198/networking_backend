const pool = require('../config/db');

/**
 * Fraud Service (Upgraded)
 * Detects suspicious activity using tiered thresholds and behavioral analysis.
 */
class FraudService {
  /**
   * Scans a specific admission for fraud markers.
   */
  static async getFraudFlags(admissionId) {
    const admRes = await pool.query(`
      SELECT student_id, student_mobile, student_email, client_ip, referred_by_user_id, created_at 
      FROM admissions WHERE id = $1
    `, [admissionId]);

    if (admRes.rows.length === 0) return [];
    const { student_id, student_mobile, student_email, client_ip, referred_by_user_id, created_at } = admRes.rows[0];

    const flags = [];

    // 1. DUPLICATE IDENTITY CHECKS
    const mobileCheck = await pool.query(`
      SELECT id FROM admissions 
      WHERE student_mobile = $1 AND id != $2 AND status != 'rejected'
    `, [student_mobile, admissionId]);
    if (mobileCheck.rows.length > 0) flags.push('Duplicate Mobile');

    const emailCheck = await pool.query(`
      SELECT id FROM admissions 
      WHERE student_email = $1 AND id != $2 AND status != 'rejected'
    `, [student_email, admissionId]);
    if (emailCheck.rows.length > 0) flags.push('Duplicate Email');

    const userCheck = await pool.query(`
      SELECT id FROM users 
      WHERE (mobile = $1 OR email = $2) AND id != $3
    `, [student_mobile, student_email, student_id]);
    if (userCheck.rows.length > 0) flags.push('Account Exists Elsewhere');

    // 2. TIERED IP BURST DETECTION (Decision: 3 / 5 / 10)
    if (client_ip) {
      const ipBurst = await pool.query(`
        SELECT COUNT(*) FROM admissions 
        WHERE client_ip = $1 AND created_at >= NOW() - INTERVAL '24 hours'
      `, [client_ip]);
      const count = parseInt(ipBurst.rows[0].count);
      
      if (count >= 10) flags.push('IP Burst: Strong Alert (10+)');
      else if (count >= 5) flags.push('IP Burst: Medium Alert (5+)');
      else if (count >= 3) flags.push('IP Burst: Soft Warning (3+)');
    }

    // 3. RAPID REFERRAL CHAINS
    if (referred_by_user_id) {
       const rapidRef = await pool.query(`
         SELECT COUNT(*) FROM admissions 
         WHERE referred_by_user_id = $1 AND created_at >= $2::timestamp - INTERVAL '30 minutes'
         AND created_at <= $2::timestamp + INTERVAL '30 minutes'
       `, [referred_by_user_id, created_at]);
       if (parseInt(rapidRef.rows[0].count) >= 3) flags.push('Rapid Referral Velocity');
    }

    // 4. CIRCULAR REFERRAL DETECTION (A -> B -> A)
    if (referred_by_user_id && student_id) {
       const loop = await pool.query(`
         SELECT id FROM users WHERE id = $1 AND referred_by = $2
       `, [referred_by_user_id, student_id]);
       if (loop.rows.length > 0) flags.push('Circular Referral (Loop)');
    }

    return flags;
  }

  /**
   * Batch scans pending admissions for admin visibility.
   */
  static async scanPendingAdmissions() {
    const pending = await pool.query("SELECT id FROM admissions WHERE status = 'pending'");
    const results = {};
    for (const row of pending.rows) {
      const flags = await this.getFraudFlags(row.id);
      if (flags.length > 0) results[row.id] = flags;
    }
    return results;
  }
}

module.exports = FraudService;
