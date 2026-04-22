const pool = require('../config/db');
const { validateReferral } = require('./referralValidator');
const bcrypt = require('bcryptjs');
const { generateSystemId, generateReferralCode } = require('../utils/generators');
const { sendEmail } = require('./emailService');

class AdmissionService {
  /**
   * Validates and creates a new admission.
   * Throws Error with message if validation fails.
   */
  static async createAdmission({
    centre_id, course_id, student_id, student_name, student_mobile, student_email,
    referral_code, payment_mode, payment_reference, payment_proof_path,
    admission_mode, staff_id = null, notes = null, dbClient = pool
  }) {
    // 1. Get Course
    const courseResult = await dbClient.query(
      `SELECT id, fee, commission_percent, commission_ic, is_active FROM courses WHERE id = $1 AND centre_id = $2`,
      [course_id, centre_id]
    );
    if (courseResult.rows.length === 0 || !courseResult.rows[0].is_active) {
      throw new Error('Course not found or inactive.');
    }
    const course = courseResult.rows[0];

    // 2. Auto-Create User if Missing (Public / Offline)
    if (!student_id && student_email && student_mobile) {
      const userCheck = await dbClient.query(`SELECT id FROM users WHERE email = $1 OR mobile = $2`, [student_email, student_mobile]);
      if (userCheck.rows.length > 0) {
         student_id = userCheck.rows[0].id;
      } else {
         const roleRes = await dbClient.query(`SELECT id FROM roles WHERE name = 'student'`);
         const passHash = await bcrypt.hash(student_mobile.toString(), 10);
         
         let sysId;
         let uniqueSysId = false;
         while (!uniqueSysId) {
            const lastUser = await dbClient.query('SELECT system_id FROM users ORDER BY created_at DESC LIMIT 1');
            let nextNum = 1;
            if (lastUser.rows.length > 0 && lastUser.rows[0].system_id) {
               const currentId = lastUser.rows[0].system_id;
               const numericPart = currentId.replace('IGCIM', '');
               nextNum = parseInt(numericPart) + 1;
            }
            sysId = `IGCIM${String(nextNum).padStart(4, '0')}`;
            
            const check = await dbClient.query(`SELECT id FROM users WHERE system_id = $1`, [sysId]);
            if (check.rows.length === 0) uniqueSysId = true;
         }

         let newRefCode;
         let uniqueRef = false;
         while(!uniqueRef) {
           newRefCode = generateReferralCode('IGCIM');
           const check = await dbClient.query(`SELECT id FROM users WHERE referral_code = $1`, [newRefCode]);
           if (check.rows.length === 0) uniqueRef = true;
         }

         const newUser = await dbClient.query(
           `INSERT INTO users (system_id, centre_id, role_id, full_name, email, mobile, password_hash, referral_code)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, system_id`,
           [sysId, centre_id, roleRes.rows[0].id, student_name, student_email, student_mobile, passHash, newRefCode]
         );
         student_id = newUser.rows[0].id;
      }
    }

    // 3. Global Fraud Protection: Validate Duplicate Admission
    // Check if email, mobile, or payment reference already exists in any PENDING or APPROVED admission
    const fraudCheck = await dbClient.query(`
      SELECT 'email' as type FROM admissions WHERE student_email = $1 AND status IN ('pending', 'approved')
      UNION ALL
      SELECT 'mobile' as type FROM admissions WHERE student_mobile = $2 AND status IN ('pending', 'approved')
      UNION ALL
      SELECT 'payment' as type FROM admissions WHERE payment_reference = $3 AND status IN ('pending', 'approved') AND $3 IS NOT NULL
    `, [student_email, student_mobile, payment_reference]);

    if (fraudCheck.rows.length > 0) {
      const type = fraudCheck.rows[0].type;
      if (type === 'email') throw new Error('An admission with this email already exists.');
      if (type === 'mobile') throw new Error('An admission with this mobile number already exists.');
      if (type === 'payment') throw new Error('This payment reference has already been used.');
    }

    // 3. Process Referral Code (NON-BLOCKING)
    let referredByUserId = null;
    if (referral_code) {
      try {
        const refResult = await dbClient.query(
          `SELECT id FROM users WHERE referral_code = $1 AND is_active = TRUE`,
          [referral_code.toUpperCase()]
        );
        if (refResult.rows.length === 0) {
          console.warn(`[AdmissionService] Invalid referral code used: ${referral_code}`);
        } else {
          referredByUserId = refResult.rows[0].id;

          if (admission_mode === 'online' && referredByUserId === student_id) {
            console.warn('[AdmissionService] Self-referral attempt blocked.');
            referredByUserId = null;
          } else if (admission_mode === 'online' && student_id) {
            const validation = await validateReferral(referredByUserId, student_id);
            if (!validation.valid) {
              console.warn(`[AdmissionService] Referral validation failed: ${validation.message}`);
              referredByUserId = null;
            }
          }
        }
      } catch (err) {
        console.error('[AdmissionService] Referral validation error:', err);
      }
    }

    // Link referred_by to user table if missing
    if (referredByUserId && student_id) {
       await dbClient.query(
         `UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL`,
         [referredByUserId, student_id]
       );
    }

    // 4. Insert Admission
    const insertSQL = `
      INSERT INTO admissions
        (centre_id, course_id, student_id, referred_by_user_id, admission_mode,
         snapshot_fee, snapshot_commission_percent, snapshot_commission_ic,
         student_name, student_mobile, student_email,
         payment_proof_path, payment_mode, payment_reference, entered_by_staff_id, notes,
         client_ip)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id, status, created_at
    `;
    const insertParams = [
      centre_id, course_id, student_id, referredByUserId, admission_mode,
      course.fee, course.commission_percent, course.commission_ic,
      student_name, student_mobile, student_email,
      payment_proof_path, payment_mode, payment_reference, staff_id, notes,
      arguments[0].client_ip || null
    ];

    const admResult = await dbClient.query(insertSQL, insertParams);
    const admissionId = admResult.rows[0].id;

    // 5. Post-Insertion Fraud Scan
    (async () => {
      try {
        const FraudService = require('./fraudService');
        const flags = await FraudService.getFraudFlags(admissionId);
        if (flags.length > 0) {
          await pool.query('UPDATE admissions SET fraud_flags = $1 WHERE id = $2', [JSON.stringify(flags), admissionId]);
        }
      } catch (err) {
        console.error('[AdmissionService] Post-insertion fraud scan failed:', err);
      }
    })();

    // Send Background Notification Emails
    (async () => {
      try {
        // 1. Referral Pending Alert (to referrer)
        if (referredByUserId) {
          const referrerRes = await dbClient.query('SELECT full_name, email FROM users WHERE id = $1', [referredByUserId]);
          if (referrerRes.rows.length > 0) {
            const referrer = referrerRes.rows[0];
            const refHtml = `
              <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
                <p>Hello <strong>${referrer.full_name}</strong>,</p>
                <p>Great news! Someone just submitted an admission application using your referral code.</p>
                <p><strong>Student Name:</strong> ${student_name || 'N/A'}</p>
                <p>Once the centre administrator approves their admission, your commission will be calculated and credited to your IGCIM wallet automatically.</p>
                <p>Keep referring and earning!</p>
                <p>Best regards,<br>IGCIM Computer Centre</p>
              </div>
            `;
            sendEmail(referrer.email, 'Pending Commission - New Referral!', refHtml).catch(e => console.error("Referral email error:", e));
          }
        }

        // 2. Admin Notification
        const adminRes = await dbClient.query(
          `SELECT email FROM users u 
           JOIN roles r ON u.role_id = r.id 
           WHERE r.name IN ('admin', 'super_admin') 
           AND (u.centre_id = $1 OR r.name = 'super_admin')`,
          [centre_id]
        );
        const uniqueEmails = [...new Set(adminRes.rows.map(r => r.email))];
        
        uniqueEmails.forEach(adminEmail => {
          const adminHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
              <p>Hello Admin,</p>
              <p>A new admission application has been submitted and is pending your review.</p>
              <ul>
                <li><strong>Student Name:</strong> ${student_name || 'N/A'}</li>
                <li><strong>Mobile:</strong> ${student_mobile || 'N/A'}</li>
                <li><strong>Course ID:</strong> ${course_id}</li>
                <li><strong>Mode:</strong> ${admission_mode}</li>
              </ul>
              <p>Please log in to the admin dashboard to review and approve/reject this application.</p>
              <p>IGCIM System Alert</p>
            </div>
          `;
          sendEmail(adminEmail, 'New Admission Request Submitted', adminHtml).catch(e => console.error("Admin notification email error:", e));
        });
      } catch (err) {
        console.error("Failed to send admission notification emails:", err);
      }
    })();

    return admResult.rows[0];
  }
}

module.exports = AdmissionService;
