const express = require('express');
const router = express.Router();
const { getStudents, getPendingReferrals, getAllUsers, updateUserRole, deleteUser } = require('../controllers/userController');
const { authenticate, requireRole } = require('../middleware/auth');

const adminOnly = [authenticate, requireRole(['super_admin', 'centre_admin', 'admin'])];
const adminAndCoAdmin = [authenticate, requireRole(['super_admin', 'centre_admin', 'admin', 'co-admin'])];

// Admin & Co-Admin
router.get('/', ...adminAndCoAdmin, getAllUsers);
router.get('/students', ...adminAndCoAdmin, getStudents);
router.get('/pending-referrals', ...adminAndCoAdmin, getPendingReferrals);

// Admin Only (Strict Management)
router.put('/:id/role', ...adminOnly, updateUserRole);
router.delete('/:id', ...adminOnly, deleteUser);

module.exports = router;
