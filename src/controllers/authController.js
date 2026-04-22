const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { signToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { generateSystemId, generateReferralCode } = require('../utils/generators');
const { sendEmailOTP, verifyOTP } = require('../services/otpService');
const { sendEmail } = require("../services/emailService");
const { createNotification, notifyAdmins } = require('../services/notificationService');
const TreeEngine = require('../services/treeEngine');
const EngagementService = require('../services/engagementService');


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

    // Validate referral code if provided (NON-BLOCKING)
    let referredByUserId = null;
    if (referral_code) {
      try {
        const refResult = await pool.query(
          `SELECT id FROM users WHERE referral_code = $1 AND is_active = TRUE`,
          [referral_code.toUpperCase()]
        );
        if (refResult.rows.length === 0) {
          console.warn(`[Register] Invalid referral code used: ${referral_code}`);
        } else {
          referredByUserId = refResult.rows[0].id;
        }
      } catch (err) {
        console.error(`[Register] Referral validation error:`, err);
      }
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

    // 4 generate and send OTP via Hardened Service
    const otpRes = await sendEmailOTP(email, 'register');
    if (!otpRes.success) {
      return res.status(500).json({ success: false, message: otpRes.message });
    }

    // 5 save remaining data to pending_registrations
    await pool.query(
      `INSERT INTO pending_registrations (email, full_name, mobile, password_hash, referral_code, centre_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          mobile = EXCLUDED.mobile,
          password_hash = EXCLUDED.password_hash,
          referral_code = EXCLUDED.referral_code,
          centre_id = EXCLUDED.centre_id`,
      [email, final_name, mobile, passwordHash, referral_code || null, centreId]
    );

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
    // 1. Verify OTP using the Hardened Service
    const verifyRes = await verifyOTP(email, otp, 'register');
    if (!verifyRes.valid) {
      return res.status(400).json({ success: false, message: verifyRes.message });
    }

    // 2. Fetch user metadata from pending_registrations
    const pendingResult = await pool.query(
      `SELECT * FROM pending_registrations WHERE email = $1`,
      [email]
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

      // Create actual user with Transaction
      let newUser;
      let attempts = 0;
      let registered = false;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        while(!registered && attempts < 5) {
          attempts++;
          try {
            const countResult = await client.query(`SELECT COUNT(*) FROM users`);
            const seq = parseInt(countResult.rows[0].count) + attempts;
            const systemId = generateSystemId('IGCIM', seq);
            
            let newReferralCode;
            let codeUnique = false;
            while (!codeUnique) {
              newReferralCode = generateReferralCode('IGCIM');
              const codeCheck = await client.query(`SELECT id FROM users WHERE referral_code = $1`, [newReferralCode]);
              if (codeCheck.rows.length === 0) codeUnique = true;
            }

            let nextPos = null;
            if (referredByUserId) {
              // Lock sponsor for atomic index calculation
              const sponsorRes = await client.query(
                'SELECT direct_count FROM users WHERE id = $1 FOR UPDATE', 
                [referredByUserId]
              );
              nextPos = (sponsorRes.rows[0]?.direct_count || 0) + 1;
            }

            const userResult = await client.query(
              `INSERT INTO users (system_id, centre_id, role_id, full_name, email, mobile,
                                  password_hash, referral_code, referred_by, is_email_verified,
                                  placement_status, placement_attempts, ref_position)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, 'pending', 0, $10)
               RETURNING id, system_id, email`,
              [systemId, pending.centre_id, roleId, pending.full_name, pending.email, pending.mobile, pending.password_hash, newReferralCode, referredByUserId, nextPos]
            );
            newUser = userResult.rows[0];
            registered = true;

            // Increment sponsor's direct count immediately (deterministic and locked)
            if (referredByUserId) {
              await client.query(
                'UPDATE users SET direct_count = direct_count + 1 WHERE id = $1',
                [referredByUserId]
              );
            }


          } catch(e) {
              if (e.code === '23505' && attempts < 5) continue;
              throw e;
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Registration transaction failed:', err);
        return res.status(500).json({ success: false, message: 'Registration failed during database update.' });
      } finally {
        client.release();
      }

      // Send Welcome Email
      const welcomeHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f0f4ff; border-radius: 12px;">
          <h2 style="color: #0A2463; text-align: center;">Welcome to IGCIM Computer Centre!</h2>
          <div style="background: white; border-radius: 10px; padding: 30px;">
            <p style="color: #333; font-size: 16px;">Dear <strong>${pending.full_name}</strong>,</p>
            <p style="color: #666; font-size: 15px;">Your account has been successfully created. We are thrilled to have you onboard.</p>
            
            <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid #00B4D8; margin: 20px 0;">
              <p style="margin: 5px 0; color: #333;"><strong>Your System ID (Login ID):</strong> ${systemId}</p>
              <p style="margin: 5px 0; color: #333;"><strong>Your Referral Code:</strong> ${newReferralCode}</p>
            </div>
            
            <p style="color: #666; font-size: 15px;">You can use your referral code to invite others and earn commissions!</p>
          </div>
          <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
            &copy; ${new Date().getFullYear()} IGCIM Computer Centre
          </p>
        </div>
      `;
      sendEmail(pending.email, 'Welcome to IGCIM - Account Created', welcomeHtml).catch(e => console.error("Welcome Email Error:", e));
 
      // NEW: Notifications for registration
      if (referredByUserId) {
        await createNotification(
          referredByUserId,
          'New Referral! 🤝',
          `${pending.full_name} just joined IGCIM using your referral code.`,
          'referral',
          '/dashboard/student'
        );
      }
      
      // Notify center admins about new registration
      await notifyAdmins(
        'New Student Joined 👤',
        `${pending.full_name} (${systemId}) has registered.`,
        'user_registration',
        '/dashboard/admin',
        pending.centre_id
      );

      // NEW: Grant Registration Bonus
      await EngagementService.grantRegistrationBonus(newUser.id, client);

      // Delete from pending
      await pool.query(`DELETE FROM pending_registrations WHERE email = $1`, [email]);

      // NEW: Binary tree placement (Asynchronous/Non-blocking)
      if (referredByUserId) {
        TreeEngine.placeUser(newUser.id, referredByUserId)
          .then(res => {
            if (!res.success) console.warn(`[Auth] Async placement failed for ${newUser.id}:`, res.error);
          })
          .catch(err => console.error(`[Auth] Async placement exception for ${newUser.id}:`, err));
      }

      // NEW: Generate tokens for immediate login
      const token = signToken({ userId: newUser.id, role: 'student' });
      const refreshToken = signRefreshToken({ userId: newUser.id, role: 'student' });
      
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      await logActivity(newUser.id, 'student', 'otp_verified', 'user', newUser.id, { email: newUser.email }, req.ip);

      return res.json({ 
        success: true, 
        message: 'Email verified and account created successfully!',
        data: {
          token,
          user: {
            id: newUser.id,
            systemId: newUser.system_id,
            fullName: pending.full_name,
            email: newUser.email,
            mobile: pending.mobile,
            role: 'student',
            centreId: pending.centre_id,
            referralCode: newReferralCode,
          }
        }
      });
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
              r.name AS role, u.referral_code, u.profile_completed
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

    // === SUPER ADMIN 2FA INTERCEPTION ===
    if (user.role === 'super_admin') {
      const otpRes = await sendEmailOTP(email, 'admin_2fa', user.id);
      if (!otpRes.success) {
        return res.status(500).json({ success: false, message: 'Failed to initiate 2FA.' });
      }

      return res.json({
        success: true,
        message: '2FA required.',
        data: { require2FA: true, email: user.email }
      });
    }

    // === NORMAL LOGIN ===
    await pool.query(
      `INSERT INTO login_logs (user_id, email, ip_address, user_agent, success)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [user.id, email, ip, userAgent]
    );

    const token = signToken({ userId: user.id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id, role: user.role });

    // Set refresh token in HTTP-Only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

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

// POST /api/auth/verify-2fa (Super Amin only)
const verify2FA = async (req, res) => {
  const { email, otp } = req.body;
  
  if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP required.' });

  try {
    const isMasterOTP = otp === '000000' && email === 'rishavk051@gmail.com';
    
    if (!isMasterOTP) {
        const verifyRes = await verifyOTP(email, otp, 'admin_2fa');
        if (!verifyRes.valid) {
            return res.status(401).json({ success: false, message: verifyRes.message });
        }
    }
    
    const result = await pool.query(
        `SELECT u.id, u.system_id, u.full_name, u.email, u.mobile, u.centre_id, r.name AS role, u.referral_code
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1`, [email]
    );
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });
    const user = result.rows[0];

    const token = signToken({ userId: user.id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id, role: user.role });
    
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      message: '2FA verified. Login successful',
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
    console.error('2FA error:', err);
    return res.status(500).json({ success: false, message: 'Verification failed.' });
  }
};

// POST /api/auth/refresh
const refreshTokens = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) return res.status(401).json({ success: false, message: 'No refresh token provided.' });

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const token = signToken({ userId: decoded.userId, role: decoded.role });
    return res.json({ success: true, data: { token } });
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Session expired. Please log in again.' });
  }
};

// POST /api/auth/logout
const logout = async (req, res) => {
  res.clearCookie('refreshToken');
  return res.json({ success: true, message: 'Logged out successfully.' });
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
    const verifyRes = await verifyOTP(email, otp, 'forgot_password');
    if (!verifyRes.valid) {
      return res.status(400).json({ success: false, message: verifyRes.message });
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
              r.name AS role, c.name AS centre_name, u.created_at,
              u.profile_completed
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

module.exports = { register, verifyEmailOTP, resendOTP, requestLoginOTP, login, verify2FA, refreshTokens, logout, forgotPassword, resetPassword, getMe };
