const pool = require('../config/db');

// GET /api/courses
const listCourses = async (req, res) => {
  const { category, centre_id } = req.query;
  const user = req.user;
  const isAdmin = ['super_admin', 'centre_admin', 'admin', 'co-admin'].includes(user?.role);
  try {
    // Admins see ALL courses (active + inactive). Students/staff see only active.
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
              c.fee, c.commission_percent, c.is_active, c.created_at,
              ce.name AS centre_name
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

// GET /api/courses/public (no auth needed for homepage)
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

// POST /api/courses  (Admin)
const createCourse = async (req, res) => {
  const { name, category, description, duration_months, fee, commission_percent } = req.body;
  const centre_id = req.body.centre_id || req.user.centre_id;
  if (!name || !fee) {
    return res.status(400).json({ success: false, message: 'Name and fee are required.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO courses (centre_id, name, category, description, duration_months, fee, commission_percent, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7, TRUE) RETURNING *`,
      [centre_id, name, category || 'computer', description, duration_months || null, fee, commission_percent || 10]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Create course error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create course.' });
  }
};

// PUT /api/courses/:id  (Admin)
const updateCourse = async (req, res) => {
  const { id } = req.params;
  const { name, category, description, duration_months, fee, commission_percent, is_active } = req.body;

  try {
    const result = await pool.query(
      `UPDATE courses
       SET name=$1, category=$2, description=$3, duration_months=$4,
           fee=$5, commission_percent=$6, is_active=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [name, category, description, duration_months, fee, commission_percent, is_active, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Course not found.' });
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update course.' });
  }
};

// DELETE /api/courses/:id  (Admin)
const deleteCourse = async (req, res) => {
  const { id } = req.params;
  try {
    // Check if any admissions reference this course
    const admCheck = await pool.query(`SELECT COUNT(*) FROM admissions WHERE course_id = $1`, [id]);
    if (parseInt(admCheck.rows[0].count) > 0) {
      // Soft-delete (deactivate) if admissions exist
      await pool.query(`UPDATE courses SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
      return res.json({ success: true, message: 'Course deactivated (has admissions, cannot permanently delete).' });
    }
    // Permanent delete if no admissions
    const result = await pool.query(`DELETE FROM courses WHERE id = $1 RETURNING id`, [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Course not found.' });
    return res.json({ success: true, message: 'Course permanently deleted.' });
  } catch (err) {
    console.error('Delete course error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete course.' });
  }
};

module.exports = { listCourses, listPublicCourses, createCourse, updateCourse, deleteCourse };
