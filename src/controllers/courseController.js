const pool = require('../config/db');
const { notifyAllStudents } = require('../services/notificationService');

// GET /api/courses
const listCourses = async (req, res) => {
  const { category, centre_id } = req.query;
  const user = req.user;
  const isAdmin = ['super_admin', 'centre_admin', 'admin', 'co-admin'].includes(user?.role);
  try {
    let where = isAdmin ? 'WHERE 1=1' : 'WHERE c.is_active = TRUE';
    const params = [];

    const cid = centre_id || (user?.role !== 'super_admin' ? user?.centre_id : null);
    if (cid) {
      params.push(cid);
      where += ` AND c.centre_id = $${params.length}`;
    }
    if (category) {
      params.push(category);
      where += ` AND c.category = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT c.id, c.name, c.category, c.description, c.duration_months,
              c.fee, c.points, c.cap_percent, c.level_distribution, c.boost_enabled,
              c.is_active, c.created_at, ce.name AS centre_name
       FROM courses c
       JOIN centres ce ON ce.id = c.centre_id
       ${where}
       ORDER BY c.category, c.name`,
      params
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('List courses error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch courses.' });
  }
};

const listPublicCourses = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.category, c.description, c.duration_months, c.fee
       FROM courses c
       WHERE c.is_active = TRUE
       ORDER BY c.category, c.name`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch courses.' });
  }
};

const validateCourseData = (data) => {
  const { cap_percent, level_distribution } = data;
  
  if (cap_percent !== undefined) {
    const cp = parseFloat(cap_percent);
    if (cp < 3 || cp > 6) return 'Cap percentage must be between 3% and 6%.';
  }

  if (level_distribution !== undefined) {
    const dist = typeof level_distribution === 'string' ? JSON.parse(level_distribution) : level_distribution;
    const sum = Object.values(dist).reduce((acc, val) => acc + parseFloat(val || 0), 0);
    if (Math.round(sum) !== 100) return 'Level distribution percentages must sum to 100%.';
  }

  return null;
};

// POST /api/courses  (Admin)
const createCourse = async (req, res) => {
  const { 
    name, category, description, duration_months, fee, points, 
    cap_percent, level_distribution, boost_enabled 
  } = req.body;
  const centre_id = req.body.centre_id || req.user.centre_id;

  if (!name || !fee) {
    return res.status(400).json({ success: false, message: 'Name and fee are required.' });
  }

  const error = validateCourseData(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const result = await pool.query(
      `INSERT INTO courses (
        centre_id, name, category, description, duration_months, fee, points, 
        cap_percent, level_distribution, boost_enabled, is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, TRUE) RETURNING *`,
      [
        centre_id, name, category || 'computer', description, duration_months || null, 
        fee, points || 0, cap_percent || 5, 
        level_distribution || '{"L1": 50, "L2": 20, "L3": 10, "L4": 10, "L5": 5, "L6": 5}', 
        boost_enabled !== undefined ? boost_enabled : true
      ]
    );
    const course = result.rows[0];
    
    notifyAllStudents(
      'New Course Launch! 🚀',
      `The new ${course.name} course is now live. Enroll today and start earning!`,
      'course_launch',
      '/dashboard/student'
    ).catch(e => console.error('Broadcast failed:', e));

    return res.status(201).json({ success: true, data: course });
  } catch (err) {
    console.error('Create course error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create course.' });
  }
};

// PUT /api/courses/:id  (Admin)
const updateCourse = async (req, res) => {
  const { id } = req.params;
  const { 
    name, category, description, duration_months, fee, points, 
    cap_percent, level_distribution, boost_enabled, is_active 
  } = req.body;
  const { role, centre_id } = req.user;

  try {
    const courseCheck = await pool.query('SELECT centre_id FROM courses WHERE id = $1', [id]);
    if (courseCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'Course not found.' });
    
    if (role !== 'super_admin' && courseCheck.rows[0].centre_id !== centre_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const error = validateCourseData(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const result = await pool.query(
      `UPDATE courses
       SET name=$1, category=$2, description=$3, duration_months=$4, fee=$5, 
           points=$6, cap_percent=$7, level_distribution=$8, boost_enabled=$9, 
           is_active=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [
        name, category, description, duration_months, fee, points, 
        cap_percent, level_distribution, boost_enabled, 
        is_active !== undefined ? is_active : true, id
      ]
    );

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Update course error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update course.' });
  }
};

// DELETE /api/courses/:id  (Admin)
const deleteCourse = async (req, res) => {
  const { id } = req.params;
  const { role, centre_id } = req.user;

  try {
    const courseCheck = await pool.query('SELECT centre_id FROM courses WHERE id = $1', [id]);
    if (courseCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'Course not found.' });
    
    if (role !== 'super_admin' && courseCheck.rows[0].centre_id !== centre_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const admCheck = await pool.query(`SELECT COUNT(*) FROM admissions WHERE course_id = $1`, [id]);
    if (parseInt(admCheck.rows[0].count) > 0) {
      await pool.query(`UPDATE courses SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
      return res.json({ success: true, message: 'Course deactivated.' });
    }
    await pool.query(`DELETE FROM courses WHERE id = $1`, [id]);
    return res.json({ success: true, message: 'Course deleted.' });
  } catch (err) {
    console.error('Delete course error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete course.' });
  }
};

module.exports = { listCourses, listPublicCourses, createCourse, updateCourse, deleteCourse };
