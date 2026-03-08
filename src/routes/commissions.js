const express = require('express');
const router = express.Router();
const { listCommissions, getEarningsSummary, requestWithdrawal, listWithdrawals, updateWithdrawalStatus } = require('../controllers/commissionController');
const { authenticate, requireCoAdminOrAdmin } = require('../middleware/auth');

router.get('/', authenticate, listCommissions);
router.get('/summary', authenticate, getEarningsSummary);
router.post('/withdraw', authenticate, requestWithdrawal);

// Admin & Co-Admin
router.get('/withdrawals', authenticate, requireCoAdminOrAdmin, listWithdrawals);
router.patch('/withdrawals/:id/status', authenticate, requireCoAdminOrAdmin, updateWithdrawalStatus);

module.exports = router;
