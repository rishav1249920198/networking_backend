const pool = require('../config/db');

/**
 * TreeHealthCheck
 * Scans the binary tree for logical inconsistencies and corruption.
 */
class TreeHealthCheck {
  static async run() {
    console.log('--- Starting Binary Tree Health Check ---');
    const issues = [];

    try {
      // 1. Find inconsistencies where user has parent_id but parent doesn't point to them
      const orphans = await pool.query(`
        SELECT u.id, u.system_id, u.parent_id, p.left_child_id, p.right_child_id
        FROM users u
        JOIN users p ON u.parent_id = p.id
        WHERE p.left_child_id != u.id AND p.right_child_id != u.id
      `);

      if (orphans.rows.length > 0) {
        orphans.rows.forEach(r => {
          issues.push(`[Orphan] User ${r.system_id} (${r.id}) has parent ${r.parent_id} but parent does not recognize them as left/right child.`);
        });
      }

      // 2. Find inconsistencies where parent has child but child has different parent_id
      const brokenLinks = await pool.query(`
        SELECT p.id as parent_id, p.left_child_id, p.right_child_id, 
               u1.parent_id as left_actual_parent, u2.parent_id as right_actual_parent
        FROM users p
        LEFT JOIN users u1 ON p.left_child_id = u1.id
        LEFT JOIN users u2 ON p.right_child_id = u2.id
        WHERE (p.left_child_id IS NOT NULL AND u1.parent_id != p.id)
           OR (p.right_child_id IS NOT NULL AND u2.parent_id != p.id)
      `);

      if (brokenLinks.rows.length > 0) {
        brokenLinks.rows.forEach(r => {
          issues.push(`[BrokenLink] Parent ${r.parent_id} has invalid child pointer(s).`);
        });
      }

      // 3. Find Multiple Assignment (Duplicate children)
      const duplicates = await pool.query(`
        SELECT child_id, COUNT(*) 
        FROM (
          SELECT left_child_id as child_id FROM users WHERE left_child_id IS NOT NULL
          UNION ALL
          SELECT right_child_id as child_id FROM users WHERE right_child_id IS NOT NULL
        ) t
        GROUP BY child_id
        HAVING COUNT(*) > 1
      `);

      if (duplicates.rows.length > 0) {
        duplicates.rows.forEach(r => {
          issues.push(`[DuplicatePlacement] User ${r.child_id} is assigned as a child to multiple parents.`);
        });
      }

      if (issues.length === 0) {
        console.log('✅ Tree Health Check: No issues found.');
      } else {
        console.error('❌ Tree Health Check: Issues detected!');
        issues.forEach(msg => console.error(msg));
        // In a real system, we'd notify admins via email here
      }

      return issues;
    } catch (err) {
      console.error('CRITICAL: Tree Health Check failed to run:', err);
      return [err.message];
    }
  }
}

module.exports = TreeHealthCheck;
