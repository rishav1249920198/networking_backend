const { verifyToken } = require('../utils/jwt');
const pool = require('../config/db');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("TOKEN:", authHeader);
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    // Fetch fresh user from DB (checks if still active)
    const result = await pool.query(
      `SELECT u.id, u.system_id, u.full_name, u.email, u.mobile,
              u.role_id, r.name AS role, u.centre_id, u.is_active,
              u.locked_until
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({
        success: false,
        message: `Account temporarily locked until ${user.locked_until}`,
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const allowed = Array.isArray(roles[0]) ? roles[0] : roles;
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }
  next();
};
const requireAdmin = requireRole(['super_admin', 'centre_admin', 'admin']);
const requireCoAdminOrAdmin = requireRole(['super_admin', 'centre_admin', 'admin', 'co-admin']);
const requireStudent = requireRole(['student', 'co-admin']);

module.exports = { authenticate, requireRole, requireAdmin, requireCoAdminOrAdmin, requireStudent };
