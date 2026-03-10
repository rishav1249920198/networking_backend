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
    let centreId = centre_id;
    if (!centreId) {
      const centreResult = await pool.query(`SELECT id FROM centres LIMIT 1`);
      centreId = centreResult.rows[0]?.id;
    }

    // 4 create user & 6 save user in database (with retry for system_id collisions)
    let newUser;
    let registered = false;
    let attempts = 0;
    while (!registered && attempts < 5) {
      attempts++;
      try {
        const countResult = await pool.query(`SELECT COUNT(*) FROM users`);
        const seq = parseInt(countResult.rows[0].count) + attempts; // Offset by attempts to handle race conditions
        const systemId = generateSystemId('IGCIM', seq);

        const userResult = await pool.query(
          `INSERT INTO users (system_id, centre_id, role_id, full_name, email, mobile,
                              password_hash, referral_code, referred_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, system_id, email, full_name`,
          [systemId, centreId, roleId, final_name, email, mobile, passwordHash, newReferralCode, referredByUserId]
        );
        newUser = userResult.rows[0];
        registered = true;
      } catch (insertErr) {
        if (insertErr.code === '23505' && insertErr.constraint === 'users_system_id_key' && attempts < 5) {
          console.warn(`[Register] system_id collision, retrying (attempt ${attempts})...`);
          continue;
        }
        throw insertErr;
      }
    }


    // Send email OTP with a timeout fallback to prevent registration hang
    console.log(`[Register] Requesting OTP for ${email}...`);
    
    // Create a promise that resolves after 10 seconds as a fallback
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        console.warn(`[Register] Email sending taking too long for ${email}, continuing response...`);
        resolve({ success: true, message: 'timeout_fallback' });
      }, 10000);
    });

    // Race the actual email sending against the timeout
    Promise.race([
      sendEmailOTP(email, 'register'),
      timeoutPromise
    ]).then(result => {
      if (result.success) {
        console.log(`[Register] OTP process finished for ${email}`);
      } else {
        console.error(`[Register] OTP process failed for ${email}:`, result.message);
      }
    }).catch(err => {
      console.error(`[Register] Background OTP error for ${email}:`, err);
    });

    // Return success response immediately while email process continues (or finishes)
    return res.status(201).json({
      success: true,
      message: 'Registration successful'
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
    const result = await verifyOTP(email, otp, 'register');
    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.message });
    }

    await pool.query(
      `UPDATE users SET is_email_verified = TRUE WHERE email = $1`,
      [email]
    );

    return res.json({ success: true, message: 'Email verified successfully. You can now login.' });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ success: false, message: 'Verification failed.' });
  }
};

// POST /api/auth/resend-otp
const resendOTP = async (req, res) => {
  const { email, purpose } = req.body;
  try {
    await sendEmailOTP(email, purpose || 'register');
    return res.json({ success: true, message: 'OTP resent to email.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to send OTP.' });
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
      return res.status(429).json({
        success: false,
        message: result.message || 'Please wait before requesting a new OTP.',
      });
    }

    return res.json({
      success: true,
      message: 'OTP sent successfully',
    });
  } catch (err) {
    console.error('Request login OTP error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send OTP.' });
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
    await sendEmailOTP(email, 'forgot_password');
    return res.json({ success: true, message: 'OTP sent to your email address.' });
  } catch (err) {
    console.error('Forgot Password Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to send OTP.' });
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
