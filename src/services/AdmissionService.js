const pool = require('../config/db');
const { validateReferral } = require('./referralValidator');

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

    // 2. Validate Duplicate Admission
    let dupQuery = '';
    let dupParams = [];
    if (admission_mode === 'online') {
      dupQuery = `SELECT id FROM admissions WHERE student_id = $1 AND course_id = $2 AND status IN ('pending', 'approved')`;
      dupParams = [student_id, course_id];
    } else {
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
        const validation = await validateReferral(referredByUserId, student_id);
        if (!validation.valid) {
          throw new Error(validation.message);
        }
      }
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
