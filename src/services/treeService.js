const pool = require('../config/db');

/**
 * Tree Service
 * Handles binary tree member counts and structure.
 */
class TreeService {
  /**
   * Fetches total member counts and withdrawal eligibility for a user.
   * Hardened: Uses pre-calculated column counts for performance and accuracy.
   */
  static async getBinaryStats(userId) {
    const rootRes = await pool.query(
      'SELECT left_child_id, right_child_id, direct_count, withdrawal_unlocked, left_count, right_count, boost_level, direct_referral_count FROM users WHERE id = $1',
      [userId]
    );

    if (rootRes.rows.length === 0) return { leftCount: 0, rightCount: 0, directCount: 0, withdrawalUnlocked: false };

    const { left_count, right_count, direct_count, withdrawal_unlocked, boost_level, direct_referral_count } = rootRes.rows[0];

    // Count accurate approved direct referrals for withdrawal logic display
    const countRefPositionSide = async (side) => {
      const condition = side === 'left' ? 'ref_position % 2 !== 0' : 'ref_position % 2 === 0';
      const res = await pool.query(`
        SELECT COUNT(*) FROM users 
        WHERE referred_by = $1 AND ${condition} AND id IN (
          SELECT student_id FROM admissions WHERE status = 'approved'
        )
      `, [userId]);
      return parseInt(res.rows[0].count);
    };

    const [leftRefs, rightRefs] = await Promise.all([
      countRefPositionSide('left'),
      countRefPositionSide('right')
    ]);

    return {
      leftCount: left_count,
      rightCount: right_count,
      directCount: leftRefs + rightRefs, // Count of approved admissions
      withdrawalUnlocked: withdrawal_unlocked,
      leftRefs,
      leftRefs,
      rightRefs,
      isLockedByLeftRight: (leftRefs < 1 || rightRefs < 1) && !withdrawal_unlocked,
      boost_level: boost_level || 0,
      totalDirectsPossible: direct_referral_count || 0
    };
  }
}

module.exports = TreeService;
