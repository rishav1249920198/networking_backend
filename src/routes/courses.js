const express = require('express');
const router = express.Router();
const { listCourses, listPublicCourses, createCourse, updateCourse, deleteCourse } = require('../controllers/courseController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.get('/public', listPublicCourses);
router.get('/', authenticate, listCourses);
router.post('/', authenticate, requireRole('centre_admin', 'super_admin'), createCourse);
router.put('/:id', authenticate, requireRole('centre_admin', 'super_admin'), updateCourse);
router.delete('/:id', authenticate, requireRole('centre_admin', 'super_admin'), deleteCourse);

module.exports = router;
