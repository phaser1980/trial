const { pool } = require('./initDb');
const logger = require('./utils/logger');
require('dotenv').config();

// Log database connection events
pool.on('connect', () => {
  logger.info('[DB] New client connected to database');
});

pool.on('error', (err, client) => {
  logger.error('[DB] Unexpected error on idle client:', { error: err });
});

// Initialize database schema
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    logger.info('[DB] Testing database connection...');
    await client.query('SELECT NOW()');
    logger.info('[DB] Database connected successfully');

    // Check if the table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'sequences'
      );
    `);

    if (!tableExists.rows[0].exists) {
      logger.info('[DB] Creating database schema...');

      // Create the tables if they do not exist
      await client.query(`
        -- Main sequences table with partitioning
        CREATE TABLE IF NOT EXISTS sequences (
          id SERIAL PRIMARY KEY,
          symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol <= 3),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          batch_id UUID DEFAULT gen_random_uuid(),
          entropy_value FLOAT,
          pattern_detected BOOLEAN DEFAULT FALSE
        ) PARTITION BY RANGE (created_at);

        -- Create partitions for better query performance
        CREATE TABLE IF NOT EXISTS sequences_current PARTITION OF sequences
          FOR VALUES FROM (CURRENT_DATE - INTERVAL '7 days') TO (CURRENT_DATE + INTERVAL '1 day');
        
        CREATE TABLE IF NOT EXISTS sequences_history PARTITION OF sequences
          FOR VALUES FROM (MINVALUE) TO (CURRENT_DATE - INTERVAL '7 days');

        -- Model predictions table with partitioning
        CREATE TABLE IF NOT EXISTS model_predictions (
          id SERIAL PRIMARY KEY,
          sequence_id INTEGER REFERENCES sequences(id),
          model_name VARCHAR(50) NOT NULL,
          predicted_symbol INTEGER CHECK (predicted_symbol >= 0 AND predicted_symbol <= 3),
          confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
          was_correct BOOLEAN,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) PARTITION BY RANGE (created_at);

        CREATE TABLE IF NOT EXISTS model_predictions_current PARTITION OF model_predictions
          FOR VALUES FROM (CURRENT_DATE - INTERVAL '7 days') TO (CURRENT_DATE + INTERVAL '1 day');
        
        CREATE TABLE IF NOT EXISTS model_predictions_history PARTITION OF model_predictions
          FOR VALUES FROM (MINVALUE) TO (CURRENT_DATE - INTERVAL '7 days');

        -- Model performance metrics with materialized view
        CREATE TABLE IF NOT EXISTS model_performance (
          id SERIAL PRIMARY KEY,
          model_name VARCHAR(50) NOT NULL,
          accuracy FLOAT,
          confidence_calibration FLOAT,
          sample_size INTEGER,
          last_retrain_at TIMESTAMP,
          needs_retraining BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT unique_model_metrics UNIQUE (model_name, created_at)
        );

        -- Create materialized view for quick access to recent performance metrics
        CREATE MATERIALIZED VIEW IF NOT EXISTS recent_model_performance AS
        SELECT 
          model_name,
          AVG(accuracy) as avg_accuracy,
          AVG(confidence_calibration) as avg_calibration,
          COUNT(*) as metric_count,
          MAX(created_at) as last_updated
        FROM model_performance
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY model_name;

        -- Create indexes for better query performance
        CREATE INDEX IF NOT EXISTS idx_sequences_created_at ON sequences(created_at);
        CREATE INDEX IF NOT EXISTS idx_sequences_batch_id ON sequences(batch_id);
        CREATE INDEX IF NOT EXISTS idx_model_predictions_sequence_id ON model_predictions(sequence_id);
        CREATE INDEX IF NOT EXISTS idx_model_predictions_model_name ON model_predictions(model_name);
        CREATE INDEX IF NOT EXISTS idx_model_predictions_created_at ON model_predictions(created_at);
        CREATE INDEX IF NOT EXISTS idx_model_performance_model_name ON model_performance(model_name);
        CREATE INDEX IF NOT EXISTS idx_model_performance_created_at ON model_performance(created_at);
      `);

      logger.info('[DB] Database schema created successfully');
    } else {
      logger.info('[DB] Tables already exist');
      
      // Get current sequence count
      const count = await client.query('SELECT COUNT(*) FROM sequences');
      logger.info('[DB] Found existing sequences table with', count.rows[0].count, 'records');
    }
  } catch (err) {
    logger.error('[DB] Database initialization error:', { error: err });
    logger.error('[DB] Error details:', {
      code: err.code,
      message: err.message,
      detail: err.detail,
    });
  } finally {
    client.release();
  }
}

// Initialize the database schema
initializeDatabase().catch(logger.error);

// Database utility functions
const dbUtils = {
  pool,  // Export the pool directly
  
  // Helper function to get a client from the pool
  async getClient() {
    logger.debug('Getting database client from pool');
    try {
      const client = await pool.connect();
      logger.debug('Successfully acquired database client');
      return client;
    } catch (error) {
      logger.error('Failed to get database client', { error });
      throw error;
    }
  },
  
  // Helper function for direct queries
  async query(text, params) {
    logger.debug('Executing database query', { query: text, params });
    try {
      const result = await pool.query(text, params);
      logger.debug('Query executed successfully', { rowCount: result.rowCount });
      return result;
    } catch (error) {
      logger.error('Query execution failed', { error, query: text, params });
      throw error;
    }
  },
  
  // Function to store model prediction
  async storeModelPrediction(client, sequenceId, modelName, predictedSymbol, confidence) {
    logger.debug('Storing model prediction', { sequenceId, modelName, predictedSymbol, confidence });
    const query = `
      INSERT INTO model_predictions 
      (sequence_id, model_name, predicted_symbol, confidence)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `;
    try {
      const values = [sequenceId, modelName, predictedSymbol, confidence];
      const result = await client.query(query, values);
      
      // After storing prediction, update model performance metrics
      await this.updateModelPerformanceMetrics(client, modelName);
      
      logger.info('Model prediction stored successfully', { 
        predictionId: result.rows[0].id,
        modelName,
        sequenceId 
      });
      return result.rows[0].id;
    } catch (error) {
      logger.error('Failed to store model prediction', { 
        error,
        sequenceId,
        modelName,
        predictedSymbol 
      });
      throw error;
    }
  },

  // Function to update prediction correctness
  async updatePredictionCorrectness(client, actualSymbol) {
    logger.debug('Updating prediction correctness', { actualSymbol });
    
    // First, update the was_correct field for recent predictions
    const updateQuery = `
      UPDATE model_predictions 
      SET was_correct = (predicted_symbol = $1)
      WHERE created_at >= NOW() - INTERVAL '1 minute'
        AND was_correct IS NULL
      RETURNING model_name;
    `;
    
    try {
      const result = await client.query(updateQuery, [actualSymbol]);
      
      // Get unique model names that were updated
      const updatedModels = [...new Set(result.rows.map(row => row.model_name))];
      
      // Update performance metrics for each affected model
      for (const modelName of updatedModels) {
        await this.updateModelPerformanceMetrics(client, modelName);
      }
      
      logger.info('Updated prediction correctness and performance metrics', {
        actualSymbol,
        updatedModels,
        updatedCount: result.rowCount
      });
      
      return result.rowCount;
    } catch (error) {
      logger.error('Failed to update prediction correctness', { error, actualSymbol });
      throw error;
    }
  },

  // Function to update model performance metrics
  async updateModelPerformanceMetrics(client, modelName) {
    try {
      // Calculate recent performance metrics
      const metricsQuery = `
        WITH recent_predictions AS (
          SELECT 
            COUNT(*) as total_predictions,
            COUNT(*) FILTER (WHERE was_correct = true) as correct_predictions,
            AVG(CASE WHEN was_correct = true THEN confidence ELSE 1 - confidence END) as confidence_calibration
          FROM model_predictions
          WHERE model_name = $1
            AND created_at >= NOW() - INTERVAL '1 hour'
            AND was_correct IS NOT NULL
        )
        SELECT 
          total_predictions,
          correct_predictions,
          CASE 
            WHEN total_predictions > 0 THEN correct_predictions::float / total_predictions 
            ELSE 0 
          END as accuracy,
          confidence_calibration
        FROM recent_predictions;
      `;
      
      const metricsResult = await client.query(metricsQuery, [modelName]);
      const metrics = metricsResult.rows[0];
      
      if (metrics.total_predictions > 0) {
        // Store the performance metrics
        const insertQuery = `
          INSERT INTO model_performance 
          (model_name, accuracy, confidence_calibration, sample_size, needs_retraining)
          VALUES ($1, $2, $3, $4, $5);
        `;
        
        const needsRetraining = metrics.accuracy < 0.5 || metrics.confidence_calibration < 0.6;
        
        await client.query(insertQuery, [
          modelName,
          metrics.accuracy,
          metrics.confidence_calibration,
          metrics.total_predictions,
          needsRetraining
        ]);
        
        // Refresh the materialized view
        await this.refreshPerformanceView(client);
        
        logger.info('Updated model performance metrics', {
          modelName,
          metrics,
          needsRetraining
        });
      }
    } catch (error) {
      logger.error('Failed to update model performance metrics', { error, modelName });
      throw error;
    }
  },

  // Function to store model performance metrics
  async storeModelPerformance(client, modelName, metrics) {
    logger.debug('Storing model performance', { modelName, metrics });
    const query = `
      INSERT INTO model_performance 
      (model_name, accuracy, confidence_calibration, sample_size, needs_retraining)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id;
    `;
    try {
      const values = [
        modelName,
        metrics.accuracy || 0,
        metrics.confidenceCalibration || 0,
        metrics.sampleSize || 0,
        metrics.needsRetraining || false
      ];
      const result = await client.query(query, values);
      logger.info('Model performance stored successfully', {
        performanceId: result.rows[0].id,
        modelName,
        metrics
      });
      return result.rows[0].id;
    } catch (error) {
      logger.error('Failed to store model performance', { error, modelName, metrics });
      throw error;
    }
  },

  // Function to get recent model performance
  async getModelPerformance(client, modelName, limit = 100) {
    logger.debug('Getting model performance', { modelName, limit });
    const query = modelName ? `
      SELECT *
      FROM model_performance
      WHERE model_name = $1
      ORDER BY created_at DESC
      LIMIT $2;
    ` : `
      SELECT *
      FROM model_performance
      ORDER BY created_at DESC
      LIMIT $1;
    `;
    
    try {
      const values = modelName ? [modelName, limit] : [limit];
      const result = await client.query(query, values);
      logger.debug('Retrieved model performance', { 
        modelName,
        rowCount: result.rowCount 
      });
      return result.rows;
    } catch (error) {
      logger.error('Failed to get model performance', { error, modelName });
      throw error;
    }
  },

  // Function to get model predictions accuracy
  async getModelAccuracy(client, modelName, timeWindow = '24 hours') {
    logger.debug('Getting model accuracy', { modelName, timeWindow });
    const query = modelName ? `
      SELECT 
        model_name,
        COUNT(*) as total_predictions,
        COUNT(*) FILTER (WHERE was_correct = true) as correct_predictions,
        AVG(CASE WHEN was_correct = true THEN 1 ELSE 0 END)::float as accuracy,
        AVG(confidence)::float as avg_confidence,
        AVG(ABS(CASE WHEN was_correct THEN 1 ELSE 0 END - confidence))::float as calibration_error
      FROM model_predictions
      WHERE model_name = $1
      AND created_at >= NOW() - INTERVAL $2
      GROUP BY model_name;
    ` : `
      SELECT 
        model_name,
        COUNT(*) as total_predictions,
        COUNT(*) FILTER (WHERE was_correct = true) as correct_predictions,
        AVG(CASE WHEN was_correct = true THEN 1 ELSE 0 END)::float as accuracy,
        AVG(confidence)::float as avg_confidence,
        AVG(ABS(CASE WHEN was_correct THEN 1 ELSE 0 END - confidence))::float as calibration_error
      FROM model_predictions
      WHERE created_at >= NOW() - INTERVAL $1
      GROUP BY model_name;
    `;
    
    try {
      const values = modelName ? [modelName, timeWindow] : [timeWindow];
      const result = await client.query(query, values);
      logger.debug('Retrieved model accuracy', {
        modelName,
        rowCount: result.rowCount,
        timeWindow
      });
      return modelName ? result.rows[0] : result.rows;
    } catch (error) {
      logger.error('Failed to get model accuracy', { error, modelName, timeWindow });
      throw error;
    }
  },

  // Function to refresh materialized view
  async refreshPerformanceView(client) {
    logger.debug('Refreshing materialized view');
    try {
      await client.query('REFRESH MATERIALIZED VIEW recent_model_performance');
      logger.info('Materialized view refreshed successfully');
    } catch (error) {
      logger.error('Failed to refresh materialized view', { error });
      throw error;
    }
  },

  // Function to clean up old partitions
  async cleanupOldPartitions(client) {
    logger.debug('Cleaning up old partitions');
    const retentionPeriod = '90 days';
    try {
      await client.query(`
        DROP TABLE IF EXISTS sequences_history_old;
        ALTER TABLE sequences_history RENAME TO sequences_history_old;
        CREATE TABLE sequences_history PARTITION OF sequences
          FOR VALUES FROM (MINVALUE) TO (CURRENT_DATE - INTERVAL '7 days');
      `);
      logger.info('Old partitions cleaned up successfully');
    } catch (error) {
      logger.error('Failed to clean up old partitions', { error });
      throw error;
    }
  }
};

// Export the database utilities
module.exports = dbUtils;
