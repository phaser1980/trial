const { Pool } = require('pg');
require('dotenv').config();

// Create a single pool instance
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

// Initialize database schema
async function initializeDatabase() {
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
      console.log('[DB] Creating database schema...');

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

      console.log('[DB] Database schema created successfully');
    } else {
      console.log('[DB] Tables already exist');
      
      // Get current sequence count
      const count = await client.query('SELECT COUNT(*) FROM sequences');
      console.log('[DB] Found existing sequences table with', count.rows[0].count, 'records');
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
}

// Initialize the database schema
initializeDatabase().catch(console.error);

// Database utility functions
const dbUtils = {
  pool,  // Export the pool directly
  
  // Helper function to get a client from the pool
  async getClient() {
    return await pool.connect();
  },
  
  // Helper function for direct queries
  async query(text, params) {
    return await pool.query(text, params);
  },
  
  // Function to store model prediction
  async storeModelPrediction(client, sequenceId, modelName, predictedSymbol, confidence) {
    const query = `
      INSERT INTO model_predictions 
      (sequence_id, model_name, predicted_symbol, confidence)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `;
    const values = [sequenceId, modelName, predictedSymbol, confidence];
    const result = await client.query(query, values);
    return result.rows[0].id;
  },

  // Function to update prediction correctness
  async updatePredictionCorrectness(client, predictionId, wasCorrect) {
    const query = `
      UPDATE model_predictions 
      SET was_correct = $1
      WHERE id = $2;
    `;
    await client.query(query, [wasCorrect, predictionId]);
  },

  // Function to store model performance metrics
  async storeModelPerformance(client, modelName, metrics) {
    const query = `
      INSERT INTO model_performance 
      (model_name, accuracy, confidence_calibration, sample_size, needs_retraining)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id;
    `;
    const values = [
      modelName,
      metrics.accuracy,
      metrics.confidenceCalibration,
      metrics.sampleSize,
      metrics.needsRetraining || false
    ];
    const result = await client.query(query, values);
    return result.rows[0].id;
  },

  // Function to get recent model performance
  async getModelPerformance(client, modelName, limit = 100) {
    const query = `
      SELECT *
      FROM model_performance
      WHERE model_name = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;
    const result = await client.query(query, [modelName, limit]);
    return result.rows;
  },

  // Function to get model predictions accuracy
  async getModelAccuracy(client, modelName, timeWindow = '24 hours') {
    const query = `
      SELECT 
        COUNT(*) as total_predictions,
        COUNT(*) FILTER (WHERE was_correct = true) as correct_predictions,
        AVG(CASE WHEN was_correct = true THEN 1 ELSE 0 END) as accuracy,
        AVG(confidence) as avg_confidence
      FROM model_predictions
      WHERE model_name = $1
      AND created_at >= NOW() - INTERVAL $2;
    `;
    const result = await client.query(query, [modelName, timeWindow]);
    return result.rows[0];
  },

  // Function to refresh materialized view
  async refreshPerformanceView(client) {
    await client.query('REFRESH MATERIALIZED VIEW recent_model_performance');
  },

  // Function to clean up old partitions
  async cleanupOldPartitions(client) {
    const retentionPeriod = '90 days';
    await client.query(`
      DROP TABLE IF EXISTS sequences_history_old;
      ALTER TABLE sequences_history RENAME TO sequences_history_old;
      CREATE TABLE sequences_history PARTITION OF sequences
        FOR VALUES FROM (MINVALUE) TO (CURRENT_DATE - INTERVAL '7 days');
    `);
  }
};

// Export the database utilities
module.exports = dbUtils;
