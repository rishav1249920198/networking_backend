const express = require('express');
const router = express.Router();
const {
  register,
  verifyEmailOTP,
  resendOTP,
  login,
  forgotPassword,
  resetPassword,
  getMe,
  requestLoginOTP,
  verify2FA,
  refreshTokens,
  logout
} = require('../controllers/authController');
const { otpLimiter, loginLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');

router.post('/register', register);
router.post('/verify-otp', verifyEmailOTP);
router.post('/resend-otp', otpLimiter, resendOTP);
router.post('/request-otp', otpLimiter, requestLoginOTP);
router.post('/login', loginLimiter, login);
router.post('/verify-2fa', verify2FA);
router.post('/refresh', refreshTokens);
router.post('/logout', logout);
router.post('/forgot-password', otpLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate, getMe);

module.exports = router;
