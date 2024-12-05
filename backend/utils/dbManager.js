const { pool } = require('../initDb');
const logger = require('./logger');

class DatabaseManager {
  static async withTransaction(operations, options = {}) {
    const {
      timeout = 30000,  // 30 second default timeout
      retries = 3,
      isolationLevel = 'SERIALIZABLE'
    } = options;

    const client = await pool.connect();
    let attempt = 0;
    
    while (attempt < retries) {
      try {
        // Set statement timeout
        await client.query(`SET statement_timeout = ${timeout}`);
        await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
        
        // Execute operations with timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Transaction timeout')), timeout);
        });
        
        const result = await Promise.race([
          operations(client),
          timeoutPromise
        ]);
        
        await client.query('COMMIT');
        return result;
      } catch (error) {
        attempt++;
        await client.query('ROLLBACK').catch(rollbackError => {
          logger.error('Rollback failed:', rollbackError);
        });
        
        // Handle specific PostgreSQL errors
        if (error.code === '40P01' && attempt < retries) { // Deadlock
          logger.warn(`Deadlock detected, retry attempt ${attempt}/${retries}`);
          await new Promise(r => setTimeout(r, Math.random() * 1000 * attempt));
          continue;
        }
        
        if (attempt === retries) {
          logger.error('Transaction failed after retries:', {
            error: error.message,
            code: error.code,
            stack: error.stack
          });
          throw error;
        }
      } finally {
        client.release();
      }
    }
  }

  static async query(text, params = [], options = {}) {
    const client = await pool.connect();
    try {
      const start = Date.now();
      const result = await client.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Query executed:', {
        text,
        duration,
        rows: result.rowCount
      });
      
      return result;
    } catch (error) {
      logger.error('Query error:', {
        text,
        error: error.message,
        code: error.code
      });
      throw error;
    } finally {
      client.release();
    }
  }

  // Utility method for batch operations
  static async withBatch(items, batchSize, operation) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await this.withTransaction(async (client) => {
        return await operation(client, batch);
      });
      results.push(...batchResults);
    }
    return results;
  }
}

module.exports = DatabaseManager;
