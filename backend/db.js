const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Redman1303!@localhost:5432/postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Log database connection events
pool.on('connect', () => {
  console.log('[DB] New client connected to database');
});

pool.on('error', (err, client) => {
  console.error('[DB] Unexpected error on idle client:', err);
});

// Initialize database and create table/sequence if not exists
(async () => {
  const client = await pool.connect();
  try {
    console.log('[DB] Testing database connection...');
    await client.query('SELECT NOW()');
    console.log('[DB] Database connected successfully');

    // Check if the table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'sequences'
      );
    `);

    if (!tableExists.rows[0].exists) {
      console.log('[DB] Creating sequences table and sequence...');

      // Create the table and the sequence if they do not exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS sequences (
          id SERIAL PRIMARY KEY,
          symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol <= 3),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE SEQUENCE IF NOT EXISTS sequences_id_seq
        START WITH 1
        INCREMENT BY 1
        OWNED BY sequences.id;

        -- Add index on created_at for better query performance
        CREATE INDEX IF NOT EXISTS idx_sequences_created_at ON sequences(created_at);
      `);

      console.log('[DB] Sequences table and sequence created successfully');
    } else {
      console.log('[DB] Sequences table already exists');
      
      // Get current sequence count
      const count = await client.query('SELECT COUNT(*) FROM sequences');
      console.log('[DB] Found existing sequences table with', count.rows[0].count, 'records');
      
      // Log table structure for debugging
      const columns = await client.query(`
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'sequences'
        ORDER BY ordinal_position;
      `);
      console.log('[DB] Table structure:', columns.rows);
    }
  } catch (err) {
    console.error('[DB] Database initialization error:', err);
    console.error('[DB] Error details:', {
      code: err.code,
      message: err.message,
      detail: err.detail,
    });
  } finally {
    client.release();
  }
})();

module.exports = pool;
