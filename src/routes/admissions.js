const express = require('express');
const router = express.Router();
const { handleUpload } = require('../middleware/upload');
const { authenticate, requireRole, requireCoAdminOrAdmin } = require('../middleware/auth');
const {
  createOnlineAdmission,
  createPublicAdmission,
  createOfflineAdmission,
  approveAdmission,
  rejectAdmission,
  listAdmissions,
  adminEnrollAndApprove,
  sendAdmissionOTP,
  verifyAndCreateAdmission
} = require('../controllers/admissionController');

router.post('/send-otp', sendAdmissionOTP);
router.post('/verify-and-admit', handleUpload, verifyAndCreateAdmission);

router.post('/public', handleUpload, createPublicAdmission);
router.post('/online', authenticate, requireRole('student', 'co-admin'), handleUpload, createOnlineAdmission);
router.post('/offline', authenticate, requireRole('staff', 'centre_admin', 'super_admin', 'admin', 'co-admin'), createOfflineAdmission);
router.post('/admin-enroll-approve', authenticate, requireCoAdminOrAdmin, adminEnrollAndApprove);
router.patch('/:id/approve', authenticate, requireCoAdminOrAdmin, approveAdmission);
router.patch('/:id/reject', authenticate, requireCoAdminOrAdmin, rejectAdmission);
router.get('/', authenticate, listAdmissions);

module.exports = router;
