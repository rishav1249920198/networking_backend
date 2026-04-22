const express = require('express');
const router = express.Router();
const { getReferralTreeForUser, validateReferralCode, getLeaderboard } = require('../controllers/referralController');
const { authenticate } = require('../middleware/auth');

router.get('/tree', authenticate, getReferralTreeForUser);
router.get('/leaderboard', getLeaderboard); // public ranking
router.get('/validate/:code', validateReferralCode);  // public

module.exports = router;
