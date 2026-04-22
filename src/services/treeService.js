const pool = require('../config/db');

/**
 * Tree Service
 * Handles binary tree member counts and structure.
 * Fully defensive against missing columns in production DB.
 */
class TreeService {
  /**
   * Fetches total member counts and withdrawal eligibility for a user.
   * Uses safe per-column queries to handle partial schema deployments.
   */
  static async getBinaryStats(userId) {
    // Fetch only the base columns guaranteed to exist
    const rootRes = await pool.query(
      'SELECT id, referred_by FROM users WHERE id = $1',
      [userId]
    );

    if (rootRes.rows.length === 0) {
      return { leftCount: 0, rightCount: 0, directCount: 0, withdrawalUnlocked: false, leftRefs: 0, rightRefs: 0, isLockedByLeftRight: true, boost_level: 0, totalDirectsPossible: 0 };
    }

    // Safely read optional columns added by migrations, defaulting if missing
    let left_count = 0, right_count = 0, withdrawal_unlocked = false, boost_level = 0, direct_referral_count = 0;
    try {
      const extRes = await pool.query(
        `SELECT 
          COALESCE(left_count, 0) as left_count,
          COALESCE(right_count, 0) as right_count,
          COALESCE(withdrawal_unlocked, false) as withdrawal_unlocked,
          COALESCE(boost_level, 0) as boost_level,
          COALESCE(direct_referral_count, 0) as direct_referral_count
        FROM users WHERE id = $1`,
        [userId]
      );
      if (extRes.rows[0]) {
        left_count = parseInt(extRes.rows[0].left_count) || 0;
        right_count = parseInt(extRes.rows[0].right_count) || 0;
        withdrawal_unlocked = extRes.rows[0].withdrawal_unlocked || false;
        boost_level = parseInt(extRes.rows[0].boost_level) || 0;
        direct_referral_count = parseInt(extRes.rows[0].direct_referral_count) || 0;
      }
    } catch (e) {
      // Columns not yet migrated in production — use safe defaults
      console.warn('[TreeService] Optional columns not found, using defaults:', e.message);
    }

    // Count direct referrals who have approved admissions
    // Try ref_position-based counting first, fall back to simple count
    let leftRefs = 0, rightRefs = 0;
    try {
      const [leftRes, rightRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) FROM users 
           WHERE referred_by = $1 AND ref_position % 2 != 0 AND id IN (
             SELECT student_id FROM admissions WHERE status = 'approved'
           )`,
          [userId]
        ),
        pool.query(
          `SELECT COUNT(*) FROM users 
           WHERE referred_by = $1 AND ref_position % 2 = 0 AND id IN (
             SELECT student_id FROM admissions WHERE status = 'approved'
           )`,
          [userId]
        )
      ]);
      leftRefs = parseInt(leftRes.rows[0].count) || 0;
      rightRefs = parseInt(rightRes.rows[0].count) || 0;
    } catch (e) {
      // ref_position column missing — fall back to simple direct count
      console.warn('[TreeService] ref_position not found, using simple count:', e.message);
      try {
        const countRes = await pool.query(
          `SELECT COUNT(*) FROM users 
           WHERE referred_by = $1 AND id IN (
             SELECT student_id FROM admissions WHERE status = 'approved'
           )`,
          [userId]
        );
        const total = parseInt(countRes.rows[0].count) || 0;
        leftRefs = Math.floor(total / 2);
        rightRefs = total - leftRefs;
      } catch (e2) {
        console.warn('[TreeService] Fallback count also failed:', e2.message);
      }
    }

    return {
      leftCount: left_count || leftRefs,
      rightCount: right_count || rightRefs,
      directCount: leftRefs + rightRefs,
      withdrawalUnlocked: withdrawal_unlocked,
      leftRefs,
      rightRefs,
      isLockedByLeftRight: (leftRefs < 1 || rightRefs < 1) && !withdrawal_unlocked,
      boost_level,
      totalDirectsPossible: direct_referral_count
    };
  }
}

module.exports = TreeService;
