const pool = require('../src/config/db');
pool.query("SELECT * FROM users LIMIT 0").then(res => {
    console.log(res.fields.map(f => f.name).join(', '));
    process.exit(0);
});
