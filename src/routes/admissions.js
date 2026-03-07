const express = require('express');
const router = express.Router();
const { createOnlineAdmission, createOfflineAdmission, approveAdmission, rejectAdmission, listAdmissions, adminEnrollAndApprove, createPublicAdmission } = require('../controllers/admissionController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { handleUpload } = require('../middleware/upload');

// Public route: No authentication required
router.post('/public', handleUpload, createPublicAdmission);

// Student: submit online admission via dashboard
router.post('/online', authenticate, requireRole('student'), handleUpload, createOnlineAdmission);

// Staff/Admin/Co-Admin: create offline admission
router.post('/offline', authenticate, requireRole('staff', 'centre_admin', 'super_admin', 'admin', 'co-admin'), createOfflineAdmission);

// Admin/Co-Admin: quick enroll + approve in one step
router.post('/admin-enroll-approve', authenticate, requireRole('centre_admin', 'super_admin', 'admin', 'co-admin'), adminEnrollAndApprove);

// Admin/Co-Admin: approve / reject
router.patch('/:id/approve', authenticate, requireRole('centre_admin', 'super_admin', 'admin', 'co-admin'), approveAdmission);
router.patch('/:id/reject', authenticate, requireRole('centre_admin', 'super_admin', 'admin', 'co-admin'), rejectAdmission);

// List admissions (role-filtered in controller)
router.get('/', authenticate, listAdmissions);

module.exports = router;
