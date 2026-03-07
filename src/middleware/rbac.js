/**
 * Role-Based Access Control middleware factory
 * Usage: requireRole('super_admin', 'centre_admin')
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
};

/**
 * Ensure the user belongs to the requested centre
 * (unless they are super_admin)
 */
const requireCentreAccess = (req, res, next) => {
  const { user } = req;
  if (!user) return res.status(401).json({ success: false, message: 'Not authenticated' });

  if (user.role === 'super_admin') return next();

  const requestedCentreId = req.params.centreId || req.body.centreId || req.query.centreId;
  if (requestedCentreId && requestedCentreId !== user.centre_id) {
    return res.status(403).json({ success: false, message: 'Access denied to this centre' });
  }
  next();
};

module.exports = { requireRole, requireCentreAccess };
