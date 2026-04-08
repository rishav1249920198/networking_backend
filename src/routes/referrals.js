const express = require('express');
const router = express.Router();
const { getReferralTreeForUser, getReferralStats, validateReferralCode, getLeaderboard } = require('../controllers/referralController');
const { authenticate } = require('../middleware/auth');

router.get('/tree', authenticate, getReferralTreeForUser);
router.get('/stats', authenticate, getReferralStats);
router.get('/leaderboard', getLeaderboard); // public ranking
router.get('/validate/:code', validateReferralCode);  // public

module.exports = router;
