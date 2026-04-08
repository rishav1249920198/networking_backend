const pool = require('../config/db');
const { notifyAllStudents } = require('../services/notificationService');

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
    const course = result.rows[0];
    
    // Asynchronous Broadcast
    notifyAllStudents(
      'New Course Launch! 🚀',
      `The new ${course.name} course is now live. Enroll your referrals today and earn a ${course.commission_percent}% commission on every successful enrollment!`,
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
  const { name, category, description, duration_months, fee, commission_percent, is_active } = req.body;
  const { role, centre_id } = req.user;

  try {
    // Security check: Only super_admin or centre's admin can update
    const courseCheck = await pool.query('SELECT centre_id, fee, commission_percent FROM courses WHERE id = $1', [id]);
    if (courseCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'Course not found.' });
    
    if (role !== 'super_admin' && courseCheck.rows[0].centre_id !== centre_id) {
      return res.status(403).json({ success: false, message: 'You do not have permission to edit this course.' });
    }

    const oldCourse = courseCheck.rows[0];
    const result = await pool.query(
      `UPDATE courses
       SET name=$1, category=$2, description=$3, duration_months=$4,
           fee=$5, commission_percent=$6, is_active=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [name, category || 'computer', description, duration_months, fee, commission_percent, is_active !== undefined ? is_active : true, id]
    );
    const updatedCourse = result.rows[0];

    // Check for significant updates (Commission increase or Fee change)
    const commChanged = parseFloat(oldCourse.commission_percent) !== parseFloat(updatedCourse.commission_percent);
    const feeChanged = parseFloat(oldCourse.fee) !== parseFloat(updatedCourse.fee);

    if (commChanged || feeChanged) {
        let title = 'Course Update Alert! 📢';
        let msg = `We've updated the ${updatedCourse.name} course. Check out the new details in your dashboard!`;

        if (commChanged) {
          const isHigher = parseFloat(updatedCourse.commission_percent) > parseFloat(oldCourse.commission_percent);
          title = isHigher ? 'Higher Commission Alert! 💰' : 'Course Update: Revised Commission 🏷️';
          msg = isHigher 
            ? `Great news! we've increased the commission for ${updatedCourse.name}. You can now earn a higher rate of ${updatedCourse.commission_percent}%!`
            : `The commission for ${updatedCourse.name} has been updated to ${updatedCourse.commission_percent}%. Start referring today!`;
        } else if (feeChanged) {
          const isLower = parseFloat(updatedCourse.fee) < parseFloat(oldCourse.fee);
          title = isLower ? 'Price Dropped! 📉' : 'Course Pricing Updated! 🏷️';
          msg = isLower
            ? `Good news! The ${updatedCourse.name} course is now more affordable at ₹${parseFloat(updatedCourse.fee).toLocaleString()}. It's easier than ever to refer students!`
            : `The pricing for ${updatedCourse.name} has been updated to ₹${parseFloat(updatedCourse.fee).toLocaleString()}. Check it out now!`;
        }

        notifyAllStudents(title, msg, 'course_update', '/dashboard/student').catch(e => console.error('Broadcast failed:', e));
    }

    return res.json({ success: true, data: updatedCourse });
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
    // Security check
    const courseCheck = await pool.query('SELECT centre_id FROM courses WHERE id = $1', [id]);
    if (courseCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'Course not found.' });
    
    if (role !== 'super_admin' && courseCheck.rows[0].centre_id !== centre_id) {
      return res.status(403).json({ success: false, message: 'You do not have permission to delete this course.' });
    }

    // Check if any admissions reference this course
    const admCheck = await pool.query(`SELECT COUNT(*) FROM admissions WHERE course_id = $1`, [id]);
    if (parseInt(admCheck.rows[0].count) > 0) {
      // Soft-delete (deactivate) if admissions exist
      await pool.query(`UPDATE courses SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
      return res.json({ success: true, message: 'Course deactivated (historical admissions exist, cannot permanently delete).' });
    }
    // Permanent delete if no admissions
    const result = await pool.query(`DELETE FROM courses WHERE id = $1 RETURNING id`, [id]);
    return res.json({ success: true, message: 'Course permanently deleted.' });
  } catch (err) {
    console.error('Delete course error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete course.' });
  }
};

module.exports = { listCourses, listPublicCourses, createCourse, updateCourse, deleteCourse };
