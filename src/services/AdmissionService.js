const pool = require('../config/db');
const { validateReferral } = require('./referralValidator');
const bcrypt = require('bcryptjs');
const { generateSystemId, generateReferralCode } = require('../utils/generators');

class AdmissionService {
  /**
   * Validates and creates a new admission.
   * Throws Error with message if validation fails.
   */
  static async createAdmission({
    centre_id, course_id, student_id, student_name, student_mobile, student_email,
    referral_code, payment_mode, payment_reference, payment_proof_path,
    admission_mode, staff_id = null, notes = null
  }) {
    // 1. Get Course
    const courseResult = await pool.query(
      `SELECT id, fee, commission_percent, is_active FROM courses WHERE id = $1 AND centre_id = $2`,
      [course_id, centre_id]
    );
    if (courseResult.rows.length === 0 || !courseResult.rows[0].is_active) {
      throw new Error('Course not found or inactive.');
    }
    const course = courseResult.rows[0];

    // 2. Auto-Create User if Missing (Public / Offline)
    if (!student_id && student_email && student_mobile) {
      const userCheck = await pool.query(`SELECT id FROM users WHERE email = $1 OR mobile = $2`, [student_email, student_mobile]);
      if (userCheck.rows.length > 0) {
         student_id = userCheck.rows[0].id;
      } else {
         const roleRes = await pool.query(`SELECT id FROM roles WHERE name = 'student'`);
         const countRes = await pool.query(`SELECT COUNT(*) FROM users`);
         const sysId = generateSystemId('IGCIM', parseInt(countRes.rows[0].count) + 1);
         const passHash = await bcrypt.hash(student_mobile.toString(), 10);
         
         let newRefCode;
         let unique = false;
         while(!unique) {
           newRefCode = generateReferralCode('IGCIM');
           const check = await pool.query(`SELECT id FROM users WHERE referral_code = $1`, [newRefCode]);
           if (check.rows.length === 0) unique = true;
         }

         const newUser = await pool.query(
           `INSERT INTO users (system_id, centre_id, role_id, full_name, email, mobile, password_hash, referral_code)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
           [sysId, centre_id, roleRes.rows[0].id, student_name, student_email, student_mobile, passHash, newRefCode]
         );
         student_id = newUser.rows[0].id;
      }
    }

    // 3. Validate Duplicate Admission
    let dupQuery = '';
    let dupParams = [];
    if (student_id) {
      if (admission_mode === 'online') {
        dupQuery = `SELECT id FROM admissions WHERE student_id = $1 AND course_id = $2 AND status IN ('pending', 'approved')`;
        dupParams = [student_id, course_id];
      } else {
        dupQuery = `SELECT id FROM admissions WHERE student_email = $1 AND course_id = $2 AND status IN ('pending', 'approved')`;
        dupParams = [student_email, course_id];
      }
    } else {
      // Public admission (no student_id yet)
      dupQuery = `SELECT id FROM admissions WHERE student_email = $1 AND course_id = $2 AND status IN ('pending', 'approved')`;
      dupParams = [student_email, course_id];
    }

    if (dupParams[0]) {
      const dupCheck = await pool.query(dupQuery, dupParams);
      if (dupCheck.rows.length > 0) {
        throw new Error('An active or pending admission for this course already exists.');
      }
    }

    // 3. Process Referral Code
    let referredByUserId = null;
    if (referral_code) {
      const refResult = await pool.query(
        `SELECT id FROM users WHERE referral_code = $1 AND is_active = TRUE`,
        [referral_code.toUpperCase()]
      );
      if (refResult.rows.length === 0) {
        throw new Error('Invalid referral code.');
      }
      referredByUserId = refResult.rows[0].id;

      if (admission_mode === 'online' && referredByUserId === student_id) {
        throw new Error('You cannot use your own referral code.');
      }

      if (admission_mode === 'online') {
        if (student_id) {
          const validation = await validateReferral(referredByUserId, student_id);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
        }
      }
    }

    // Link referred_by to user table if missing
    if (referredByUserId && student_id) {
       await pool.query(
         `UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL`,
         [referredByUserId, student_id]
       );
    }

    // 4. Insert Admission
    const insertSQL = `
      INSERT INTO admissions
        (centre_id, course_id, student_id, referred_by_user_id, admission_mode,
         snapshot_fee, snapshot_commission_percent,
         student_name, student_mobile, student_email,
         payment_proof_path, payment_mode, payment_reference, entered_by_staff_id, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id, status, created_at
    `;
    const insertParams = [
      centre_id, course_id, student_id, referredByUserId, admission_mode,
      course.fee, course.commission_percent,
      student_name, student_mobile, student_email,
      payment_proof_path, payment_mode, payment_reference, staff_id, notes
    ];

    const admResult = await pool.query(insertSQL, insertParams);
    return admResult.rows[0];
  }
}

module.exports = AdmissionService;
