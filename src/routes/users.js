const express = require('express');
const router = express.Router();
const { getStudents, getPendingReferrals, getAllUsers, updateUserRole, deleteUser, getProfile, updateProfile, dailyCheckIn, getBonuses } = require('../controllers/userController');
const { authenticate, requireAdmin, requireCoAdminOrAdmin } = require('../middleware/auth');

// Admin & Co-Admin
router.get('/students', authenticate, requireCoAdminOrAdmin, getStudents);
router.get('/pending-referrals', authenticate, requireCoAdminOrAdmin, getPendingReferrals);

// Student Personal Features
router.get('/profile', authenticate, getProfile);
router.patch('/profile', authenticate, updateProfile);
router.post('/check-in', authenticate, dailyCheckIn);
router.get('/check-in/history', authenticate, getCheckInHistory);
router.get('/bonuses', authenticate, getBonuses);

// Admin Only (Strict Management)
router.get('/', authenticate, requireAdmin, getAllUsers);
router.put('/:id/role', authenticate, requireAdmin, updateUserRole);
router.delete('/:id', authenticate, requireAdmin, deleteUser);

module.exports = router;
