const express = require('express');
const router = express.Router();
const { getProfile, updateProfile, dailyCheckIn } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

// All user routes are protected
router.use(protect);

router.get('/profile', getProfile);
router.patch('/profile', updateProfile);
router.post('/check-in', dailyCheckIn);

module.exports = router;
