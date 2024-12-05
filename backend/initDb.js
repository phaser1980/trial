const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./utils/logger');
require('dotenv').config();

console.log('Script started!');

// Create a single pool instance
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Redman1303!@localhost:5432/postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize database schema
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log('Testing database connection...');
    await client.query('SELECT NOW()');
    console.log('Database connected successfully');

    // Begin transaction
    await client.query('BEGIN');

    try {
      // Drop existing tables and sequences in the correct order
      console.log('Cleaning up existing database objects...');
      await client.query('DROP TABLE IF EXISTS migrations CASCADE');
      await client.query('DROP TABLE IF EXISTS sequences CASCADE');
      await client.query('DROP TABLE IF EXISTS model_performance CASCADE');
      
      // Drop sequences explicitly by name
      const dropSequences = `
        DO $$ 
        BEGIN
          DROP SEQUENCE IF EXISTS migrations_id_seq;
          DROP SEQUENCE IF EXISTS sequences_id_seq;
        EXCEPTION 
          WHEN undefined_table THEN 
            NULL;
        END $$;
      `;
      await client.query(dropSequences);

      // Create migrations table
      console.log('Creating migrations table...');
      await client.query(`
        CREATE TABLE migrations (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Get list of migration files
      const migrationsDir = path.join(__dirname, 'migrations');
      const files = await fs.readdir(migrationsDir);
      const sqlFiles = files
        .filter(f => f.endsWith('.sql'))
        .sort(); // Ensure migrations run in order

      console.log('Found migration files:', sqlFiles);

      // Apply migrations
      for (const file of sqlFiles) {
        const filename = path.join(migrationsDir, file);
        const appliedMigration = await client.query(
          'SELECT id FROM migrations WHERE filename = $1',
          [file]
        );

        if (appliedMigration.rows.length === 0) {
          console.log(`Applying migration: ${file}`);
          const sql = await fs.readFile(filename, 'utf8');
          await client.query(sql);
          await client.query(
            'INSERT INTO migrations (filename) VALUES ($1)',
            [file]
          );
        } else {
          console.log(`Migration already applied: ${file}`);
        }
      }

      // Commit transaction
      await client.query('COMMIT');
      console.log('Database initialization completed successfully');
    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Export both the pool and the initialization function
module.exports = {
  pool,
  initializeDatabase
};

// Call initializeDatabase when script is run directly
if (require.main === module) {
  console.log('Running initialization...');
  initializeDatabase()
    .then(() => {
      console.log('Database initialization completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Failed to initialize database:', err);
      process.exit(1);
    });
}
