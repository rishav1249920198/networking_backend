const pool = require('../config/db');

/**
 * Spillover Service
 * Handles finding the next available slot in the binary tree using BFS.
 */
class SpilloverService {
  /**
   * Finds the next available parent and position (left/right) for a new user
   * under a specific sponsor's subtree using Breadth-First Search.
   * 
   * @param {string} sponsorId - The UUID of the user who referred the new member.
   * @param {object} client - Optional pg client for transactions.
   * @returns {Promise<{parentId: string, position: 'left' | 'right'}>}
   */
  /**
   * Finds the next available parent and position (left/right) for a new user
   * based on their permanent ref_position (Odd=Left, Even=Right).
   * 
   * @param {string} sponsorId - The UUID of the user who referred the new member.
   * @param {number} refPosition - The permanent index of this referral (1, 2, 3...).
   * @param {object} client - Optional pg client for transactions.
   * @returns {Promise<{parentId: string, position: 'left' | 'right'}>}
   */
  static async findPlacementSlot(sponsorId, refPosition, client = pool) {
    const targetSide = (refPosition % 2 !== 0) ? 'left' : 'right';

    // 1. Fetch sponsor's immediate slots
    const sponsorRes = await client.query(
      'SELECT left_child_id, right_child_id FROM users WHERE id = $1',
      [sponsorId]
    );

    if (sponsorRes.rows.length === 0) throw new Error('Sponsor not found');
    const { left_child_id, right_child_id } = sponsorRes.rows[0];

    // Priority 1: If the correct side is empty, take it.
    if (targetSide === 'left' && !left_child_id) return { parentId: sponsorId, position: 'left' };
    if (targetSide === 'right' && !right_child_id) return { parentId: sponsorId, position: 'right' };

    // Priority 2: Force search into the correct branch (Left or Right)
    // If refPosition=3 (Left) and Left is full, we search ONLY in Left subtree.
    // This supports the 1L/1R withdrawal rule deterministically.
    const rootSearchId = targetSide === 'left' ? left_child_id : right_child_id;

    if (!rootSearchId) {
       // This handles the case where ref_position=2 (Right) but Right is empty.
       // (Already handled above, but being safe)
       return { parentId: sponsorId, position: targetSide };
    }

    // Use BFS to find the first open slot in the target branch
    const { parentId } = await this.bfsSearch(rootSearchId, client);

    // After finding a parent in the subtree, we need to decide which side of THAT parent to take.
    // Standard BFS finds the first node with at least one free slot.
    const res = await client.query('SELECT left_child_id FROM users WHERE id = $1', [parentId]);
    const finalPos = !res.rows[0].left_child_id ? 'left' : 'right';

    return { parentId, position: finalPos };
  }


  /**
   * Counts total members in a subtree using RECURSIVE CTE.
   */
  static async getSubtreeMemberCount(rootId, client) {
    const res = await client.query(`
      WITH RECURSIVE Subtree AS (
        SELECT id, left_child_id, right_child_id FROM users WHERE id = $1
        UNION ALL
        SELECT u.id, u.left_child_id, u.right_child_id
        FROM users u
        INNER JOIN Subtree s ON s.id = u.parent_id
      )
      SELECT COUNT(*) FROM Subtree
    `, [rootId]);
    return parseInt(res.rows[0].count);
  }

  /**
   * Optimized BFS to find the first available slot starting from a node.
   * Fetches entire subtree structure in ONE query to avoid connection timeouts.
   */
  static async bfsSearch(rootId, client) {
    const res = await client.query(`
      WITH RECURSIVE Tree AS (
        SELECT id, left_child_id, right_child_id, 1 as depth
        FROM users WHERE id = $1
        UNION ALL
        SELECT u.id, u.left_child_id, u.right_child_id, t.depth + 1
        FROM users u
        JOIN Tree t ON u.parent_id = t.id
      )
      SELECT id, left_child_id, right_child_id FROM Tree ORDER BY depth ASC, id ASC
    `, [rootId]);

    const nodes = res.rows;
    for (const node of nodes) {
      if (!node.left_child_id || !node.right_child_id) {
        return { parentId: node.id };
      }
    }
    
    throw new Error('No slot found in subtree');
  }

}

module.exports = SpilloverService;
