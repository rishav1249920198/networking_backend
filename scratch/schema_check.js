const pool = require('../src/config/db');
async function checkSchema() {
    const res = await pool.query(`
        SELECT column_name, data_type, numeric_precision, numeric_scale 
        FROM information_schema.columns 
        WHERE table_name IN ('courses', 'users', 'points_transactions')
        AND column_name IN ('commission_cap_percent', 'left_count', 'right_count', 'direct_count', 'metadata')
    `);
    console.table(res.rows);
    process.exit(0);
}
checkSchema();
