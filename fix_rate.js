const pool = require('./src/config/db'); 
async function update() { 
  await pool.query(`UPDATE system_settings SET setting_value = '1.0' WHERE setting_key = 'ic_conversion_rate'`); 
  console.log('Updated conversion rate to 1.0'); 
  process.exit(0); 
} 
update();
