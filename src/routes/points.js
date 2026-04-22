const express = require('express');
const router = express.Router();
const { getEarningsBreakdown, getEarningsChart } = require('../controllers/dashboardController');
const { authenticate, requireStudent } = require('../middleware/auth');

router.get('/', authenticate, requireStudent, getEarningsBreakdown); // GET /api/earnings
router.get('/chart', authenticate, requireStudent, getEarningsChart); // GET /api/earnings/chart

module.exports = router;
