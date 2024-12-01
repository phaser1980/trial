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
      console.log('[DB] Creating database schema...');

      // Create the tables if they do not exist
      await client.query(`
        -- Main sequences table
        CREATE TABLE IF NOT EXISTS sequences (
          id SERIAL PRIMARY KEY,
          symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol <= 3),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          batch_id UUID DEFAULT gen_random_uuid(),
          entropy_value FLOAT,
          pattern_detected BOOLEAN DEFAULT FALSE
        );

        -- Model predictions table
        CREATE TABLE IF NOT EXISTS model_predictions (
          id SERIAL PRIMARY KEY,
          sequence_id INTEGER REFERENCES sequences(id),
          model_name VARCHAR(50) NOT NULL,
          predicted_symbol INTEGER CHECK (predicted_symbol >= 0 AND predicted_symbol <= 3),
          confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
          was_correct BOOLEAN,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        -- Model performance metrics
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

        -- Entropy tracking
        CREATE TABLE IF NOT EXISTS entropy_tracking (
          id SERIAL PRIMARY KEY,
          batch_id UUID REFERENCES sequences(batch_id),
          window_size INTEGER,
          entropy_value FLOAT,
          chi_square_value FLOAT,
          pattern_strength FLOAT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        -- Pattern detection
        CREATE TABLE IF NOT EXISTS pattern_detection (
          id SERIAL PRIMARY KEY,
          batch_id UUID REFERENCES sequences(batch_id),
          pattern_type VARCHAR(50),
          confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
          detected_length INTEGER,
          sample_size INTEGER,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        -- Create indexes for better query performance
        CREATE INDEX IF NOT EXISTS idx_sequences_created_at ON sequences(created_at);
        CREATE INDEX IF NOT EXISTS idx_sequences_batch_id ON sequences(batch_id);
        CREATE INDEX IF NOT EXISTS idx_model_predictions_sequence_id ON model_predictions(sequence_id);
        CREATE INDEX IF NOT EXISTS idx_model_predictions_model_name ON model_predictions(model_name);
        CREATE INDEX IF NOT EXISTS idx_model_performance_model_name ON model_performance(model_name);
        CREATE INDEX IF NOT EXISTS idx_entropy_tracking_batch_id ON entropy_tracking(batch_id);
        CREATE INDEX IF NOT EXISTS idx_pattern_detection_batch_id ON pattern_detection(batch_id);
      `);

      console.log('[DB] Database schema created successfully');
    } else {
      console.log('[DB] Tables already exist');
      
      // Get current sequence count
      const count = await client.query('SELECT COUNT(*) FROM sequences');
      console.log('[DB] Found existing sequences table with', count.rows[0].count, 'records');
      
      // Log table structure for debugging
      const tables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);
      console.log('[DB] Available tables:', tables.rows.map(r => r.table_name));
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

// Function to store model prediction
async function storeModelPrediction(client, sequenceId, modelName, predictedSymbol, confidence) {
  const query = `
    INSERT INTO model_predictions 
    (sequence_id, model_name, predicted_symbol, confidence)
    VALUES ($1, $2, $3, $4)
    RETURNING id;
  `;
  const values = [sequenceId, modelName, predictedSymbol, confidence];
  const result = await client.query(query, values);
  return result.rows[0].id;
}

// Function to update prediction correctness
async function updatePredictionCorrectness(client, predictionId, wasCorrect) {
  const query = `
    UPDATE model_predictions 
    SET was_correct = $1
    WHERE id = $2;
  `;
  await client.query(query, [wasCorrect, predictionId]);
}

// Function to store model performance metrics
async function storeModelPerformance(client, modelName, metrics) {
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
}

// Function to get recent model performance
async function getModelPerformance(client, modelName, limit = 100) {
  const query = `
    SELECT *
    FROM model_performance
    WHERE model_name = $1
    ORDER BY created_at DESC
    LIMIT $2;
  `;
  const result = await client.query(query, [modelName, limit]);
  return result.rows;
}

// Function to get model predictions accuracy
async function getModelAccuracy(client, modelName, timeWindow = '24 hours') {
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
}

module.exports = {
  pool,
  storeModelPrediction,
  updatePredictionCorrectness,
  storeModelPerformance,
  getModelPerformance,
  getModelAccuracy
};
