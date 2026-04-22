const pool = require('../config/db');
const SpilloverService = require('./spilloverService');

/**
 * Tree Engine
 * Manages user placement in the binary tree and subtree metrics.
 */
class TreeEngine {
  /**
   * Places a newly registered user into the binary tree.
   * This is designed to be non-blocking for the main registration flow.
   * 
   * @param {string} userId - The UUID of the new user.
   * @param {string} referredByUserId - The UUID of the user who referred them.
   */
  static async placeUser(userId, referredByUserId, externalClient = null) {
    const ownsClient = !externalClient;
    const client = externalClient || await pool.connect();
    try {
      if (ownsClient) await client.query('BEGIN');

      // 1. Fetch user's permanent ref_position
      const userRes = await client.query('SELECT ref_position, referred_by FROM users WHERE id = $1', [userId]);
      const { ref_position, referred_by } = userRes.rows[0];

      if (!ref_position || !referred_by) {
          throw new Error(`Cannot place user ${userId}: Missing ref_position or sponsor.`);
      }

      // 2. Find placement slot using deterministic logic
      const { parentId, position } = await SpilloverService.findPlacementSlot(referred_by, ref_position, client);


      // 2. Update the new user's parent, position and status
      await client.query(
        'UPDATE users SET parent_id = $1, binary_position = $2, placement_status = $3, updated_at = NOW() WHERE id = $4',
        [parentId, position, 'placed', userId]
      );


      // 3. Update the parent's child pointer
      const childColumn = position === 'left' ? 'left_child_id' : 'right_child_id';
      await client.query(
        `UPDATE users SET ${childColumn} = $1, updated_at = NOW() WHERE id = $2`,
        [userId, parentId]
      );

      if (ownsClient) await client.query('COMMIT');
      return { success: true, parentId, position };
    } catch (err) {
      if (ownsClient) await client.query('ROLLBACK');
      
      // Fallback: Increment attempts and mark status
      try {
        const userRes = await client.query('SELECT placement_attempts FROM users WHERE id = $1', [userId]);
        const attempts = (userRes.rows[0]?.placement_attempts || 0) + 1;
        const newStatus = attempts >= 3 ? 'failed' : 'pending';

        await client.query(
          'UPDATE users SET placement_status = $1, placement_attempts = $2, updated_at = NOW() WHERE id = $3',
          [newStatus, attempts, userId]
        );
        
        if (newStatus === 'failed') {
          console.error(`[TreeEngine] Placement PERMANENTLY FAILED for user ${userId} after 3 attempts.`);
        }
      } catch (updateErr) {
        console.error(`[TreeEngine] Failed to update failure status for user ${userId}:`, updateErr);
      }
      
      return { success: false, error: err.message };
    } finally {
      if (ownsClient) client.release();
    }
  }

  /**
   * Background task to retry placements for users in 'pending' status.
   */
  static async processPendingPlacements() {
    try {
      // Find users who are pending and have not reached max attempts
      const pendingUsers = await pool.query(
        "SELECT id, referred_by FROM users WHERE placement_status = 'pending' AND placement_attempts < 3 LIMIT 10"
      );

      if (pendingUsers.rows.length === 0) return;

      console.log(`[TreeEngine] Processing ${pendingUsers.rows.length} pending placements...`);

      for (const user of pendingUsers.rows) {
        if (user.referred_by) {
          await this.placeUser(user.id, user.referred_by);
        } else {
          // No sponsor? Mark as failed or manually handle
          await pool.query("UPDATE users SET placement_status = 'failed' WHERE id = $1", [user.id]);
        }
      }
    } catch (err) {
      console.error('[TreeEngine] Error in background placement retry:', err);
    }
  }

  /**
   * Counts total approved admissions in a user's left and right subtrees.
   * Used for withdrawal eligibility.
   * 
   * @param {string} userId - The UUID of the user.
   * @returns {Promise<{leftCount: number, rightCount: number}>}
   */
  static async getSubtreeAdmissions(userId) {
    const result = await pool.query(
      'SELECT left_child_id, right_child_id FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) return { leftCount: 0, rightCount: 0 };

    const { left_child_id, right_child_id } = result.rows[0];

    const countBranch = async (rootId) => {
      if (!rootId) return 0;

      // This is a recursive check. For large trees, this might need optimization
      // via a dedicated "subtree_admissions_count" field updated on admission.
      // But for a start, we'll do a recursive query or a specialized CTE.
      
      const query = `
        WITH RECURSIVE Subtree AS (
          SELECT id, left_child_id, right_child_id FROM users WHERE id = $1
          UNION ALL
          SELECT u.id, u.left_child_id, u.right_child_id
          FROM users u
          INNER JOIN Subtree s ON s.left_child_id = u.id OR s.right_child_id = u.id
        )
        SELECT COUNT(*) FROM admissions 
        WHERE student_id IN (SELECT id FROM Subtree) 
        AND status = 'approved';
      `;
      
      const res = await pool.query(query, [rootId]);
      return parseInt(res.rows[0].count);
    };

    const leftCount = await countBranch(left_child_id);
    const rightCount = await countBranch(right_child_id);

    return { leftCount, rightCount };
  }
}

module.exports = TreeEngine;
