const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: parseInt(process.env.OTP_RATE_LIMIT_MAX) || 5, // Limit each IP/Email to 5 OTP requests per hour
  message: { success: false, message: 'Too many OTP requests. Please wait 1 hour before trying again.' },
  keyGenerator: (req, res) => req.body.email || req.body.mobile || ipKeyGenerator(req, res),
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 failed login requests per 15 minutes
  message: { success: false, message: 'Too many login attempts from this IP. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the rate limit
});

module.exports = { generalLimiter, otpLimiter, loginLimiter };
