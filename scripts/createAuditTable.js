const pool = require('../src/config/db');

async function initAuditLogs() {
  try {
    console.log("Creating audit_logs table...");
    const query = `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_id UUID,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        ip_address VARCHAR(45) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(query);
    console.log("audit_logs table verified/created.");
  } catch (err) {
    console.error("DB Initialization Error:", err);
  } finally {
    process.exit(0);
  }
}

initAuditLogs();
