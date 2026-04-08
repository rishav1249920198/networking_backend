const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, getSettings);
router.put('/', authenticate, requireRole('super_admin', 'admin'), updateSettings);

module.exports = router;
