const express = require('express');
const router = express.Router();
const { listCommissions, getEarningsSummary, requestWithdrawal, listWithdrawals, updateWithdrawalStatus } = require('../controllers/commissionController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, listCommissions);
router.get('/summary', authenticate, getEarningsSummary);
router.post('/withdraw', authenticate, requestWithdrawal);

// Admin / Super Admin routes
router.get('/withdrawals', authenticate, requireRole(['centre_admin', 'super_admin']), listWithdrawals);
router.patch('/withdrawals/:id/status', authenticate, requireRole(['centre_admin', 'super_admin']), updateWithdrawalStatus);

module.exports = router;
