const express = require('express');
const router = express.Router();
const { getStudents, getPendingReferrals } = require('../controllers/userController');
const { authenticate, requireRole } = require('../middleware/auth');

const adminOnly = [authenticate, requireRole(['super_admin', 'centre_admin'])];

router.get('/students', ...adminOnly, getStudents);
router.get('/pending-referrals', ...adminOnly, getPendingReferrals);

module.exports = router;
