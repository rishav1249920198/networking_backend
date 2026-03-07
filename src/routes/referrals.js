const express = require('express');
const router = express.Router();
const { getReferralTreeForUser, getReferralStats, validateReferralCode } = require('../controllers/referralController');
const { authenticate } = require('../middleware/auth');

router.get('/tree', authenticate, getReferralTreeForUser);
router.get('/stats', authenticate, getReferralStats);
router.get('/validate/:code', validateReferralCode);  // public

module.exports = router;
