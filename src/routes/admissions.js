const express = require('express');
const router = express.Router();
const { createOnlineAdmission, createOfflineAdmission, approveAdmission, rejectAdmission, listAdmissions, adminEnrollAndApprove } = require('../controllers/admissionController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { handleUpload } = require('../middleware/upload');

// Student: submit online admission
router.post('/online', authenticate, requireRole('student'), handleUpload, createOnlineAdmission);

// Staff/Admin: create offline admission
router.post('/offline', authenticate, requireRole('staff', 'centre_admin', 'super_admin'), createOfflineAdmission);

// Admin: quick enroll + approve in one step (for pending referrals)
router.post('/admin-enroll-approve', authenticate, requireRole('centre_admin', 'super_admin'), adminEnrollAndApprove);

// Admin: approve / reject
router.patch('/:id/approve', authenticate, requireRole('centre_admin', 'super_admin'), approveAdmission);
router.patch('/:id/reject', authenticate, requireRole('centre_admin', 'super_admin'), rejectAdmission);

// List admissions (role-filtered in controller)
router.get('/', authenticate, listAdmissions);

module.exports = router;
