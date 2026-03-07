const pool = require('../config/db');

/**
 * Check for self-referral and circular referral chains
 * @param {string} referrerId - UUID of the referring user
 * @param {string} newUserId - UUID of the user being referred (optional, only for existing users)
 * Returns: { valid: boolean, message: string }
 */
const validateReferral = async (referrerId, newUserId = null) => {
  // Block self-referral
  if (newUserId && referrerId === newUserId) {
    return { valid: false, message: 'You cannot refer yourself.' };
  }

  // Check that the referrer exists and is an active student
  const referrerResult = await pool.query(
    `SELECT id, full_name, role_id, is_active FROM users WHERE id = $1`,
    [referrerId]
  );

  if (referrerResult.rows.length === 0) {
    return { valid: false, message: 'Referral code does not match any active user.' };
  }

  const referrer = referrerResult.rows[0];
  if (!referrer.is_active) {
    return { valid: false, message: 'Referring user account is not active.' };
  }

  // If newUserId provided, check for circular reference (newUser should not be in referrer's ancestor chain)
  if (newUserId) {
    const isCircular = await checkCircularChain(referrerId, newUserId);
    if (isCircular) {
      return { valid: false, message: 'Circular referral chain detected.' };
    }
  }

  return { valid: true, referrer };
};

/**
 * Walk up the referral chain from `startUserId` to see if `targetUserId` appears
 * (prevents circular references)
 */
const checkCircularChain = async (startUserId, targetUserId, depth = 0) => {
  if (depth > 10) return false; // Safety limit
  if (!startUserId) return false;

  const result = await pool.query(
    `SELECT referred_by FROM users WHERE id = $1`,
    [startUserId]
  );

  if (result.rows.length === 0) return false;

  const { referred_by } = result.rows[0];
  if (!referred_by) return false;
  if (referred_by === targetUserId) return true;

  return checkCircularChain(referred_by, targetUserId, depth + 1);
};

/**
 * Get the full referral tree for a user (downline)
 */
const getReferralTree = async (userId, depth = 0, maxDepth = 5) => {
  if (depth >= maxDepth) return [];

  const result = await pool.query(
    `SELECT u.id, u.full_name, u.system_id, u.referral_code, u.created_at,
            COUNT(a.id) AS total_admissions,
            COUNT(CASE WHEN a.status = 'approved' THEN 1 END) AS approved_admissions
     FROM users u
     LEFT JOIN admissions a ON a.student_id = u.id
     WHERE u.referred_by = $1
     GROUP BY u.id`,
    [userId]
  );

  const children = [];
  for (const row of result.rows) {
    const subtree = await getReferralTree(row.id, depth + 1, maxDepth);
    children.push({ ...row, children: subtree });
  }
  return children;
};

module.exports = { validateReferral, getReferralTree };
