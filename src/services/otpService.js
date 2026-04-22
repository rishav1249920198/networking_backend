const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sendMail } = require('../config/mailer');
const { generateOTP } = require('../utils/generators');
require('dotenv').config();

const OTP_EXPIRE_MINUTES = parseInt(process.env.OTP_EXPIRE_MINUTES) || 10;
const MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 3;

/**
 * Send OTP via Email (Hardened v2)
 * Generates OTP once, hashes it, saves to DB, then sends email.
 * @param {string} email Target email
 * @param {string} context 'register' | 'admin_2fa' | 'forgot_password' | 'login'
 * @param {string} userId (Optional) ID of the user if already registered
 */
const sendEmailOTP = async (email, context, userId = null) => {
  try {
    // 1. Check cooldown (60s)
    const recentOtp = await pool.query(
      `SELECT created_at FROM otp_verifications 
       WHERE identifier = $1 AND context = $2
       ORDER BY created_at DESC LIMIT 1`,
      [email, context]
    );
    
    if (recentOtp.rows.length > 0) {
      const timeSinceLastOtp = Date.now() - new Date(recentOtp.rows[0].created_at).getTime();
      if (timeSinceLastOtp < 60 * 1000) {
        return { success: false, message: 'Please wait 60 seconds before requesting a new OTP.' };
      }
    }

    // 2. Generate OTP Exactly Once
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRE_MINUTES * 60 * 1000);

    // 3. Hash the OTP for secure storage
    const otpHash = await bcrypt.hash(otp, 10);

    // 4. Invalidate OLD OTPs for this context+identifier
    await pool.query(
      `UPDATE otp_verifications SET is_used = TRUE
       WHERE identifier = $1 AND context = $2 AND is_used = FALSE`,
      [email, context]
    );

    // 5. Save the HASH to DB
    await pool.query(
      `INSERT INTO otp_verifications (user_id, identifier, context, otp_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, email, context, otpHash, expiresAt]
    );

    // TEMP: Debug Log (as requested)
    console.log(`[OTP DEBUG] Context: ${context} | Email: ${email} | Generated: ${otp}`);

    // 6. Send Email
    const subjectMap = {
      register: 'IGCIM - Email Verification OTP',
      login: 'IGCIM - Login OTP',
      forgot_password: 'IGCIM - Password Reset OTP',
      mobile_verify: 'IGCIM - Mobile Verification OTP',
      admin_2fa: 'IGCIM Admin - Security Verification Code'
    };

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #f0f4ff; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #0A2463; margin: 0;">IGCIM Computer Centre</h2>
          <p style="color: #666; margin: 5px 0;">Educational Networking Platform</p>
        </div>
        <div style="background: white; border-radius: 10px; padding: 30px; text-align: center;">
          <h3 style="color: #0A2463;">Your Verification Code</h3>
          <div style="font-size: 42px; font-weight: bold; letter-spacing: 10px; color: #00B4D8; margin: 20px 0;">
            ${otp}
          </div>
          <p style="color: #666;">This OTP is valid for <strong>${OTP_EXPIRE_MINUTES} minutes</strong>.</p>
          <p style="color: #999; font-size: 12px;">If you did not request this, please ignore this email.</p>
        </div>
      </div>
    `;

    await sendMail({ to: email, subject: subjectMap[context] || 'IGCIM OTP', html });
    return { success: true, message: 'OTP sent to email.' };

  } catch (error) {
    console.error('OTP SEND ERROR:', error);
    return { success: false, message: 'Failed to send OTP email.' };
  }
};

/**
 * Verify OTP (Hardened v2)
 * Compares entered OTP with stored hash.
 */
const verifyOTP = async (identifier, enteredOtp, context) => {
  try {
    const result = await pool.query(
      `SELECT * FROM otp_verifications
       WHERE identifier = $1 AND context = $2 AND is_used = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [identifier, context]
    );

    if (result.rows.length === 0) {
      return { valid: false, message: 'No active OTP found. Please request a new one.' };
    }

    const record = result.rows[0];

    // Check expiry
    if (new Date(record.expires_at) < new Date()) {
      return { valid: false, message: 'OTP has expired. Please request a new one.' };
    }

    // Check attempts
    if (record.attempts >= MAX_ATTEMPTS) {
      return { valid: false, message: 'Too many invalid attempts. New OTP required.' };
    }

    // HASH COMPARISON
    const isMatch = await bcrypt.compare(String(enteredOtp), record.otp_hash);

    // TEMP: Debug Log (as requested)
    console.log(`[OTP DEBUG] Context: ${context} | Email: ${identifier} | Entered: ${enteredOtp} | StoredHash: ${record.otp_hash.substring(0, 10)}... | Match: ${isMatch}`);

    if (!isMatch) {
      // Increment attempts
      await pool.query(
        `UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1`,
        [record.id]
      );
      const remaining = MAX_ATTEMPTS - record.attempts - 1;
      return { valid: false, message: `Invalid OTP. ${remaining} attempt(s) remaining.` };
    }

    // Successful Match - Mark as used
    await pool.query(
      `UPDATE otp_verifications SET is_used = TRUE WHERE id = $1`,
      [record.id]
    );

    return { valid: true, message: 'OTP verified successfully.' };

  } catch (error) {
    console.error('OTP VERIFY ERROR:', error);
    return { valid: false, message: 'Internal verification error.' };
  }
};

module.exports = { sendEmailOTP, verifyOTP };
