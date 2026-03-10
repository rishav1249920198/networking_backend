const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { signToken } = require('../utils/jwt');
const { generateSystemId, generateReferralCode } = require('../utils/generators');
const { sendEmailOTP, verifyOTP } = require('../services/otpService');

// Helper: log activity
const logActivity = async (actorId, actorRole, action, targetType, targetId, metadata, ip) => {
  try {
    await pool.query(
      `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actorId, actorRole, action, targetType, targetId, JSON.stringify(metadata), ip]
    );
  } catch (_) {}
};

// POST /api/auth/register
const register = async (req, res) => {
  console.log("REGISTER BODY:", req.body);
  const { full_name, name, email, mobile, password, referral_code, centre_id } = req.body;
  const final_name = full_name || name;

  try {
    // 1 validate inputs
    if (!final_name) return res.status(400).json({ success: false, message: 'Name is required.' });
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });
    if (!mobile) return res.status(400).json({ success: false, message: 'Mobile is required.' });
    if (!password) return res.status(400).json({ success: false, message: 'Password is required.' });

    // 2 check existing user
    const dupCheck = await pool.query(
      `SELECT id FROM users WHERE email = $1 OR mobile = $2`,
      [email, mobile]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Email or mobile already registered.' });
    }

    // Validate referral code if provided
    let referredByUserId = null;
    if (referral_code) {
      const refResult = await pool.query(
        `SELECT id FROM users WHERE referral_code = $1 AND is_active = TRUE`,
        [referral_code.toUpperCase()]
      );
      if (refResult.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid referral code.' });
      }
      referredByUserId = refResult.rows[0].id;
    }

    // Get student role
    const roleResult = await pool.query(`SELECT id FROM roles WHERE name = 'student'`);
    const roleId = roleResult.rows[0].id;

    // 5 generate referral code
    let newReferralCode;
    let codeUnique = false;
    while (!codeUnique) {
      newReferralCode = generateReferralCode('IGCIM');
      const codeCheck = await pool.query(`SELECT id FROM users WHERE referral_code = $1`, [newReferralCode]);
      if (codeCheck.rows.length === 0) codeUnique = true;
    }

    // 3 hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Use provided centre_id or get first/default centre
    let centreId = centre_id || null;
    if (!centreId) {
      const centreResult = await pool.query(`SELECT id FROM centres LIMIT 1`);
      centreId = centreResult.rows[0]?.id || null;
    }

    // 4 generate OTP - Use numeric 6 digits for consistency
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // 5 save to pending_registrations
    try {
      await pool.query(
        `INSERT INTO pending_registrations (email, full_name, mobile, password_hash, referral_code, centre_id, otp_code, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (email) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           mobile = EXCLUDED.mobile,
           password_hash = EXCLUDED.password_hash,
           referral_code = EXCLUDED.referral_code,
           centre_id = EXCLUDED.centre_id,
           otp_code = EXCLUDED.otp_code,
           expires_at = EXCLUDED.expires_at`,
        [email, final_name, mobile, passwordHash, referral_code || null, centreId, otp, expiresAt]
      );
    } catch (dbErr) {
      console.error("[Register] Database Error saving pending registration:", dbErr);
      // If it's a type mismatch for centre_id (INT vs UUID), try inserting NULL or cast
      if (dbErr.code === '22P02' && dbErr.message.includes('integer')) {
        console.warn("[Register] centre_id type mismatch detected. Retrying with centre_id as NULL or integer if possible.");
        // Fallback: This is a hack, but without schema access, we try to preserve registration flow
        await pool.query(
          `INSERT INTO pending_registrations (email, full_name, mobile, password_hash, referral_code, centre_id, otp_code, expires_at)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
           ON CONFLICT (email) DO UPDATE SET
             full_name = EXCLUDED.full_name,
             mobile = EXCLUDED.mobile,
             password_hash = EXCLUDED.password_hash,
             referral_code = EXCLUDED.referral_code,
             centre_id = NULL,
             otp_code = EXCLUDED.otp_code,
             expires_at = EXCLUDED.expires_at`,
          [email, final_name, mobile, passwordHash, referral_code || null, otp, expiresAt]
        );
      } else {
        throw dbErr;
      }
    }

    // 6 Send email OTP
    const subject = 'IGCIM - Email Verification OTP';
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
          <p style="color: #666;">This OTP is valid for <strong>10 minutes</strong>.</p>
          <p style="color: #999; font-size: 12px;">If you did not request this, please ignore this email.</p>
        </div>
        <p style="color: #999; font-size: 11px; text-align: center; margin-top: 15px;">
          &copy; ${new Date().getFullYear()} IGCIM Computer Centre. All rights reserved.
        </p>
      </div>
    `;

    console.log(`[Register] Attempting to send OTP ${otp} to ${email}...`);
    try {
      const { sendEmail } = require('../services/emailService');
      await sendEmail(email, subject, html);
      console.log(`[Register] OTP successfully sent to ${email}`);
    } catch (emailErr) {
      console.error("SMTP EMAIL ERROR:", emailErr);
      return res.json({ success: false, message: "Failed to send OTP email" });
    }

    return res.status(200).json({
      success: true,
      message: 'OTP sent to your email. Please verify to complete registration.'
    });
  } catch (error) {
    console.error('REGISTER ERROR:', error);
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// POST /api/auth/verify-otp
const verifyEmailOTP = async (req, res) => {
  const { email, otp } = req.body;

  try {
    // Check pending registrations first
    const pendingResult = await pool.query(
      `SELECT * FROM pending_registrations WHERE email = $1 AND otp_code = $2 AND expires_at > NOW()`,
      [email, otp]
    );

    if (pendingResult.rows.length > 0) {
      const pending = pendingResult.rows[0];
      
      // Determine referred_by
      let referredByUserId = null;
      if (pending.referral_code) {
        const refResult = await pool.query(
          `SELECT id FROM users WHERE referral_code = $1 AND is_active = TRUE`,
          [pending.referral_code.toUpperCase()]
        );
        referredByUserId = refResult.rows[0]?.id;
      }

      // Get role
      const roleResult = await pool.query(`SELECT id FROM roles WHERE name = 'student'`);
      const roleId = roleResult.rows[0].id;

      // Create actual user
      let newUser;
      let attempts = 0;
      let registered = false;
      while(!registered && attempts < 5) {
        attempts++;
        try {
          const countResult = await pool.query(`SELECT COUNT(*) FROM users`);
          const seq = parseInt(countResult.rows[0].count) + attempts;
          const systemId = generateSystemId('IGCIM', seq);
          
          let newReferralCode;
          let codeUnique = false;
          while (!codeUnique) {
            newReferralCode = generateReferralCode('IGCIM');
            const codeCheck = await pool.query(`SELECT id FROM users WHERE referral_code = $1`, [newReferralCode]);
            if (codeCheck.rows.length === 0) codeUnique = true;
          }

          const userResult = await pool.query(
            `INSERT INTO users (system_id, centre_id, role_id, full_name, email, mobile,
                                password_hash, referral_code, referred_by, is_email_verified)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
             RETURNING id, system_id, email`,
            [systemId, pending.centre_id, roleId, pending.full_name, pending.email, pending.mobile, pending.password_hash, newReferralCode, referredByUserId]
          );
          newUser = userResult.rows[0];
          registered = true;
        } catch(e) {
            if (e.code === '23505' && attempts < 5) continue;
            throw e;
        }
      }

      // Delete from pending
      await pool.query(`DELETE FROM pending_registrations WHERE email = $1`, [email]);

      return res.json({ success: true, message: 'Email verified and account created successfully!' });
    }

    // Fallback for existing users (like mobile verify or login otp)
    const result = await verifyOTP(email, otp, 'register');
    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.message });
    }

    await pool.query(
      `UPDATE users SET is_email_verified = TRUE WHERE email = $1`,
      [email]
    );

    return res.json({ success: true, message: 'Email verified successfully.' });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ success: false, message: 'Verification failed.' });
  }
};

// POST /api/auth/resend-otp
const resendOTP = async (req, res) => {
  const { email, purpose } = req.body;
  try {
    const result = await sendEmailOTP(email, purpose || 'register');
    if (!result.success) {
      return res.json({ success: false, message: "Failed to send OTP email" });
    }
    return res.json({ success: true, message: 'OTP resent to email.' });
  } catch (err) {
    console.error("RESEND OTP ERROR:", err);
    return res.json({ success: false, message: 'Failed to send OTP.' });
  }
};

// POST /api/auth/request-otp
// Generic email OTP sender used by login/verification screens
const requestLoginOTP = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }

  try {
    const result = await sendEmailOTP(email, 'login');

    if (!result.success) {
      return res.json({
        success: false,
        message: result.message || 'Failed to send OTP email',
      });
    }

    return res.json({
      success: true,
      message: 'OTP sent successfully',
    });
  } catch (err) {
    console.error('Request login OTP error:', err);
    return res.json({ success: false, message: 'Failed to send OTP.' });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  try {
    const result = await pool.query(
      `SELECT u.id, u.system_id, u.full_name, u.email, u.mobile, u.password_hash,
              u.centre_id, u.is_active, u.is_email_verified,
              u.failed_attempts, u.locked_until,
              r.name AS role, u.referral_code
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.email = $1`,
      [email]
    );

    const logFail = async (reason) => {
      await pool.query(
        `INSERT INTO login_logs (user_id, email, ip_address, user_agent, success, failure_reason)
         VALUES ($1, $2, $3, $4, FALSE, $5)`,
        [result.rows[0]?.id || null, email, ip, userAgent, reason]
      );
    };

    if (result.rows.length === 0) {
      await logFail('user_not_found');
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    // Check account lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const lockEnd = new Date(user.locked_until).toLocaleTimeString();
      return res.status(423).json({
        success: false,
        message: `Account locked due to too many failed attempts. Try again after ${lockEnd}.`,
      });
    }

    if (!user.is_email_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in.',
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      const newAttempts = user.failed_attempts + 1;
      let lockUpdate = `UPDATE users SET failed_attempts = $1 WHERE id = $2`;
      const lockParams = [newAttempts, user.id];

      if (newAttempts >= 5) {
        const lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 min lock
        lockUpdate = `UPDATE users SET failed_attempts = $1, locked_until = $3 WHERE id = $2`;
        lockParams.push(lockUntil);
      }

      await pool.query(lockUpdate, lockParams);
      await logFail('wrong_password');

      const remaining = Math.max(0, 5 - newAttempts);
      return res.status(401).json({
        success: false,
        message: `Invalid email or password. ${remaining} attempt(s) remaining.`,
      });
    }

    // Reset failed attempts on success
    await pool.query(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1`,
      [user.id]
    );

    await pool.query(
      `INSERT INTO login_logs (user_id, email, ip_address, user_agent, success)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [user.id, email, ip, userAgent]
    );

    const token = signToken({ userId: user.id, role: user.role });

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          systemId: user.system_id,
          fullName: user.full_name,
          email: user.email,
          mobile: user.mobile,
          role: user.role,
          centreId: user.centre_id,
          referralCode: user.referral_code,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Login failed.' });
  }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (result.rows.length === 0) {
      // Don't reveal if email exists
      return res.json({ success: true, message: 'If this email is registered, you will receive an OTP.' });
    }
    const otpResult = await sendEmailOTP(email, 'forgot_password');
    if (!otpResult.success) {
      return res.json({ success: false, message: "Failed to send OTP email" });
    }
    return res.json({ success: true, message: 'OTP sent to your email address.' });
  } catch (err) {
    console.error('Forgot Password Error:', err);
    return res.json({ success: false, message: 'Failed to send OTP.' });
  }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ success: false, message: 'Email, OTP, and new password are required.' });
  }

  try {
    const isValid = await verifyOTP(email, otp, 'forgot_password');
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const result = await pool.query(
      `UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE email = $2 RETURNING id`,
      [passwordHash, email]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({ success: true, message: 'Password reset successfully. Please login.' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    return res.status(500).json({ success: false, message: 'Password reset failed.' });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.system_id, u.full_name, u.email, u.mobile,
              u.referral_code, u.centre_id, u.profile_photo,
              r.name AS role, c.name AS centre_name, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN centres c ON c.id = u.centre_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
};

module.exports = { register, verifyEmailOTP, resendOTP, requestLoginOTP, login, forgotPassword, resetPassword, getMe };
