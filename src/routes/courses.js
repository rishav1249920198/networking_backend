const express = require('express');
const router = express.Router();
const { listCourses, listPublicCourses, createCourse, updateCourse, deleteCourse } = require('../controllers/courseController');
const { authenticate, requireCoAdminOrAdmin } = require('../middleware/auth');

router.get('/public', listPublicCourses);
router.get('/', authenticate, listCourses);
router.post('/', authenticate, requireCoAdminOrAdmin, createCourse);
router.put('/:id', authenticate, requireCoAdminOrAdmin, updateCourse);
router.delete('/:id', authenticate, requireCoAdminOrAdmin, deleteCourse);

module.exports = router;
