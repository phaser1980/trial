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

    // Drop the existing migrations table to start fresh
    console.log('Dropping existing migrations table...');
    await client.query('DROP TABLE IF EXISTS migrations CASCADE');

    // Create migrations table if it doesn't exist
    console.log('Creating migrations table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
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

    // Begin transaction
    await client.query('BEGIN');

    try {
      for (const file of sqlFiles) {
        // Check if migration was already applied
        const { rows } = await client.query(
          'SELECT filename FROM migrations WHERE filename = $1',
          [file]
        );

        if (rows.length === 0) {
          console.log(`Applying migration: ${file}`);
          const filePath = path.join(migrationsDir, file);
          const sql = await fs.readFile(filePath, 'utf8');

          try {
            // Execute the entire file as one statement for functions/triggers
            await client.query(sql);
            console.log(`Successfully executed ${file}`);

            // Record the migration
            await client.query(
              'INSERT INTO migrations (filename) VALUES ($1)',
              [file]
            );
            console.log(`Migration ${file} applied successfully`);
          } catch (err) {
            console.error(`Error executing ${file}:`, err);
            throw err;
          }
        } else {
          console.log(`Migration already applied: ${file}`);
        }
      }

      // Commit transaction
      await client.query('COMMIT');
      console.log('All migrations completed successfully');
    } catch (err) {
      // Rollback on error
      await client.query('ROLLBACK');
      console.error('Migration failed:', err);
      throw err;
    }
  } catch (err) {
    console.error('Database initialization failed:', err);
    throw err;
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
