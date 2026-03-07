const pool = require('../config/db');
const { sendMail } = require('../config/mailer');
const { generateOTP } = require('../utils/generators');
require('dotenv').config();

const OTP_EXPIRE_MINUTES = parseInt(process.env.OTP_EXPIRE_MINUTES) || 10;
const MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 3;

/**
 * Send OTP to email
 * purpose: 'register' | 'forgot_password' | 'mobile_verify'
 */
const sendEmailOTP = async (email, purpose) => {
  // Check cooldown first
  const recentOtp = await pool.query(
    `SELECT created_at FROM otp_verifications 
     WHERE identifier = $1 AND purpose = $2
     ORDER BY created_at DESC LIMIT 1`,
    [email, purpose]
  );
  
  if (recentOtp.rows.length > 0) {
    const timeSinceLastOtp = Date.now() - new Date(recentOtp.rows[0].created_at).getTime();
    if (timeSinceLastOtp < 60 * 1000) { // 60 seconds cooldown
      return { success: false, message: 'Please wait 60 seconds before requesting a new OTP.' };
    }
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRE_MINUTES * 60 * 1000);

  // Invalidate any previous OTPs for this identifier+purpose
  await pool.query(
    `UPDATE otp_verifications SET is_used = TRUE
     WHERE identifier = $1 AND purpose = $2 AND is_used = FALSE`,
    [email, purpose]
  );

  await pool.query(
    `INSERT INTO otp_verifications (identifier, otp_code, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [email, otp, purpose, expiresAt]
  );

  const subjectMap = {
    register: 'IGCIM - Email Verification OTP',
    forgot_password: 'IGCIM - Password Reset OTP',
    mobile_verify: 'IGCIM - Mobile Verification OTP',
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
      <p style="color: #999; font-size: 11px; text-align: center; margin-top: 15px;">
        &copy; ${new Date().getFullYear()} IGCIM Computer Centre. All rights reserved.
      </p>
    </div>
  `;

  await sendMail({ to: email, subject: subjectMap[purpose] || 'IGCIM OTP', html });

  // Always log OTP to backend terminal so you can copy it during development
  console.log(`\n🔐 OTP for ${email} [${purpose}]: ${otp}\n`);

  return { success: true, message: 'OTP sent to email' };
};

/**
 * Verify OTP
 */
const verifyOTP = async (identifier, otp, purpose) => {
  const result = await pool.query(
    `SELECT * FROM otp_verifications
     WHERE identifier = $1 AND purpose = $2 AND is_used = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose]
  );

  if (result.rows.length === 0) {
    return { valid: false, message: 'No active OTP found. Please request a new one.' };
  }

  const record = result.rows[0];

  if (new Date(record.expires_at) < new Date()) {
    return { valid: false, message: 'OTP has expired. Please request a new one.' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { valid: false, message: 'Too many invalid attempts. Please request a new OTP.' };
  }

  if (record.otp_code !== String(otp)) {
    // Increment attempts
    await pool.query(
      `UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1`,
      [record.id]
    );
    const remaining = MAX_ATTEMPTS - record.attempts - 1;
    return { valid: false, message: `Invalid OTP. ${remaining} attempt(s) remaining.` };
  }

  // Mark as used
  await pool.query(
    `UPDATE otp_verifications SET is_used = TRUE WHERE id = $1`,
    [record.id]
  );

  return { valid: true, message: 'OTP verified successfully' };
};

module.exports = { sendEmailOTP, verifyOTP };
