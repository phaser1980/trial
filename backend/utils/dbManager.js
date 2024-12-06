const { Pool } = require('pg');
const logger = require('./logger');
require('dotenv').config();

class DatabaseManager {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Redman1303!@localhost:5432/postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err, client) => {
      logger.error('Unexpected error on idle client', err);
    });
  }

  async withTransaction(callback, options = {}) {
    const client = await this.pool.connect();
    let completed = false;

    try {
      await client.query('BEGIN');
      
      if (options.isolationLevel) {
        await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
      }
      
      if (options.timeout) {
        await client.query(`SET LOCAL statement_timeout = ${options.timeout}`);
      }

      const result = await callback(client);
      await client.query('COMMIT');
      completed = true;
      return result;
    } catch (e) {
      if (!completed) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          logger.error('Error rolling back transaction:', rollbackError);
        }
      }
      throw e;
    } finally {
      if (!client.released) {
        client.release();
      }
    }
  }

  async withBatch(items, batchSize, callback) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await callback(i, batch);
      results.push(...batchResults);
    }
    return results;
  }

  async query(text, params = []) {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Executed query', {
        text,
        duration,
        rows: res.rowCount
      });
      return res;
    } catch (err) {
      logger.error('Query error', {
        text,
        error: err.message,
        stack: err.stack
      });
      throw err;
    }
  }

  async end() {
    await this.pool.end();
  }
}

// Create singleton instance
const dbManager = new DatabaseManager();

module.exports = dbManager;
