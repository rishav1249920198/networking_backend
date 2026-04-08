const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL is not set. Database connections will fail.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err.message);
});

// Verify connectivity at startup without crashing the server
pool.connect()
  .then((client) => {
    console.log('✅ Supabase PostgreSQL connected successfully');
    client.release();
  })
  .catch((err) => {
    console.error('⚠️  Could not connect to Supabase PostgreSQL:', err.message);
    console.error('   Check your DATABASE_URL in the .env file.');
    throw new Error('Database connection failed: ' + err.message);
  });

module.exports = pool;
