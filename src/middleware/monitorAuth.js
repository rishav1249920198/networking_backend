/**
 * Monitor Authentication Middleware
 * Enforces x-api-key for bot monitoring. 
 * Allows Admin Session as a fallback to keep the Dashboard functional.
 */
const monitorAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  // 1. Strict API Key check for Monitoring Bot
  if (apiKey && apiKey === process.env.MONITOR_API_KEY) {
    return next();
  }

  // 2. Fallback to Admin Session for Dashboard stability
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'co-admin')) {
    return next();
  }

  // Hardened Unauthorized response
  return res.status(403).json({ error: "Unauthorized" });
};

module.exports = monitorAuth;
