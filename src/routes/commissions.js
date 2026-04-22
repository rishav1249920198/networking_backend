const express = require('express');
const router = express.Router();
const { requestWithdrawal, listWithdrawals, updateWithdrawalStatus } = require('../controllers/commissionController');
const { authenticate, requireCoAdminOrAdmin } = require('../middleware/auth');

router.post('/withdraw', authenticate, requestWithdrawal);

// Admin & Co-Admin
router.get('/withdrawals', authenticate, listWithdrawals);
router.patch('/withdrawals/:id/status', authenticate, requireCoAdminOrAdmin, updateWithdrawalStatus);

module.exports = router;
