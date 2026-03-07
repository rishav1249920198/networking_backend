const express = require('express');
const router = express.Router();
const { register, verifyEmailOTP, resendOTP, login, forgotPassword, resetPassword, getMe } = require('../controllers/authController');
const { otpLimiter, loginLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');

router.post('/register', register);
router.post('/verify-otp', verifyEmailOTP);
router.post('/resend-otp', otpLimiter, resendOTP);
router.post('/login', loginLimiter, login);
router.post('/forgot-password', otpLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate, getMe);

module.exports = router;
