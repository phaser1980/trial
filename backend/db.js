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

// PostgreSQL error codes and handlers
const PG_ERROR_CODES = {
  '23505': 'Unique constraint violation',
  '23503': 'Foreign key violation',
  '42P01': 'Table does not exist',
  '42703': 'Column does not exist',
  '25P02': 'Transaction aborted',
  '40001': 'Serialization failure',
  '40P01': 'Deadlock detected',
  '08006': 'Connection failure',
  '08003': 'Connection does not exist'
};

// Enhanced error handler with specific PostgreSQL error handling
function handleDatabaseError(error, context) {
  const errorInfo = {
    code: error.code,
    message: error.message,
    detail: error.detail,
    hint: error.hint,
    where: error.where,
    schema: error.schema,
    table: error.table,
    column: error.column,
    dataType: error.dataType,
    constraint: error.constraint
  };

  // Add specific error handling based on PostgreSQL error codes
  if (error.code in PG_ERROR_CODES) {
    errorInfo.type = PG_ERROR_CODES[error.code];
    errorInfo.suggestion = getSuggestionForError(error.code, context);
  }

  return errorInfo;
}

// Get specific suggestions for different error types
function getSuggestionForError(code, context) {
  switch (code) {
    case '23505':
      return `Check for duplicate entries in ${context.table || 'table'} for ${context.constraint || 'constraint'}`;
    case '23503':
      return `Ensure referenced record exists in parent table for ${context.constraint || 'foreign key'}`;
    case '42P01':
      return 'Verify table name and ensure it exists in the database schema';
    case '42703':
      return 'Verify column name and ensure it exists in the table schema';
    case '25P02':
      return 'Previous error caused transaction to abort. Check previous errors in transaction';
    case '40001':
      return 'Retry transaction due to serialization failure';
    case '40P01':
      return 'Retry transaction due to deadlock';
    default:
      return 'Check database logs for more details';
  }
}

// Schema inspection utility
async function inspectTableSchema(client, tableName) {
  logger.info(`[DB] Inspecting table schema: ${tableName}`);
  
  try {
    // First check if table exists and get its OID
    const tableExistsQuery = `
      SELECT c.oid, c.relname, n.nspname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      AND c.relname = $1
      AND c.relkind = 'r';
    `;
    
    const tableInfo = await client.query(tableExistsQuery, [tableName]);
    if (tableInfo.rows.length === 0) {
      logger.error(`[DB] Table ${tableName} not found`);
      return null;
    }

    // Get column information using the table's OID
    const schemaQuery = `
      SELECT 
        a.attname as column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
        CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END as is_nullable,
        pg_get_expr(d.adbin, d.adrelid) as column_default
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON (a.attrelid, a.attnum) = (d.adrelid, d.adnum)
      WHERE a.attrelid = $1
      AND a.attnum > 0
      AND NOT a.attisdropped
      ORDER BY a.attnum;
    `;

    const result = await client.query(schemaQuery, [tableInfo.rows[0].oid]);
    
    logger.info(`[DB] Schema inspection complete for ${tableName}`, {
      tableFound: true,
      columnCount: result.rows.length,
      columns: result.rows.map(col => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable,
        default: col.column_default
      }))
    });

    return result.rows;
  } catch (error) {
    logger.error(`[DB] Schema inspection failed for ${tableName}`, {
      error: {
        message: error.message,
        code: error.code,
        detail: error.detail
      }
    });
    throw error;
  }
}

// Startup validation routine
async function validateDatabaseSchema() {
  const client = await pool.connect();
  logger.info('[DB] Starting database schema validation');
  
  try {
    // Check database connection
    await client.query('SELECT NOW()');
    logger.info('[DB] Database connection successful');

    // Required tables for the application
    const requiredTables = [
      'model_performance',
      'model_predictions',
      'sequences'
    ];

    // Required columns for each table
    const requiredColumns = {
      model_performance: [
        { name: 'id', type: 'integer' },
        { name: 'prediction_id', type: 'integer' },
        { name: 'model_type', type: 'character varying' },
        { name: 'actual_value', type: 'text' },
        { name: 'predicted_value', type: 'text' },
        { name: 'error_metrics', type: 'jsonb' },
        { name: 'created_at', type: 'timestamp with time zone' },
        { name: 'metadata', type: 'jsonb' },
        { name: 'correct_predictions', type: 'integer' },
        { name: 'total_predictions', type: 'integer' },
        { name: 'last_updated', type: 'timestamp with time zone' }
      ],
      model_predictions: [
        { name: 'id', type: 'integer' },
        { name: 'sequence_id', type: 'integer' },
        { name: 'model_type', type: 'character varying' },
        { name: 'prediction_data', type: 'jsonb' },
        { name: 'confidence_score', type: 'double precision' },
        { name: 'created_at', type: 'timestamp with time zone' }
      ],
      sequences: [
        { name: 'id', type: 'integer' },
        { name: 'symbol', type: 'integer' },
        { name: 'created_at', type: 'timestamp with time zone' },
        { name: 'batch_id', type: 'uuid' }
      ]
    };

    // Validate each table and its columns
    for (const table of requiredTables) {
      logger.info(`[DB] Validating table: ${table}`);
      
      const tableSchema = await inspectTableSchema(client, table);
      
      if (!tableSchema) {
        throw new Error(`Required table '${table}' does not exist`);
      }

      // Create a map of existing columns with normalized types
      const existingColumns = new Map(
        tableSchema.map(col => [
          col.column_name, 
          col.data_type.replace(/\(\d+\)/, '') // Remove size specifications
        ])
      );

      // Check required columns
      for (const requiredCol of requiredColumns[table]) {
        const existingType = existingColumns.get(requiredCol.name);
        
        if (!existingType) {
          throw new Error(`Required column '${requiredCol.name}' missing in table '${table}'`);
        }
        
        // Normalize the required type for comparison
        const normalizedRequiredType = requiredCol.type.replace(/\(\d+\)/, '');
        
        if (existingType !== normalizedRequiredType) {
          throw new Error(
            `Column '${requiredCol.name}' in table '${table}' has incorrect type. ` +
            `Expected: ${normalizedRequiredType}, Found: ${existingType}`
          );
        }
      }

      logger.info(`[DB] Table '${table}' validation successful`, {
        columnCount: tableSchema.length,
        validatedColumns: requiredColumns[table].map(col => col.name)
      });
    }

    // Validate indexes
    const indexQuery = `
      SELECT 
        tablename, 
        indexname, 
        indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND tablename = ANY($1);
    `;

    const indexResult = await client.query(indexQuery, [requiredTables]);
    
    logger.info('[DB] Index validation complete', {
      indexCount: indexResult.rowCount,
      indexes: indexResult.rows.map(idx => ({
        table: idx.tablename,
        name: idx.indexname,
        definition: idx.indexdef
      }))
    });

    logger.info('[DB] Database schema validation completed successfully');
    return true;
  } catch (error) {
    const errorInfo = handleDatabaseError(error, { operation: 'schema_validation' });
    logger.error('[DB] Schema validation failed', errorInfo);
    throw error;
  } finally {
    client.release();
  }
}

// Initialize database and validate schema
async function initializeAndValidate() {
  try {
    await initializeDatabase();
    await validateDatabaseSchema();
    logger.info('[DB] Database initialization and validation completed successfully');
  } catch (error) {
    logger.error('[DB] Database initialization or validation failed', {
      error: handleDatabaseError(error, { operation: 'init_and_validate' })
    });
    throw error;
  }
}

// Run initialization and validation
initializeAndValidate().catch(error => {
  logger.error('[DB] Fatal database error during startup', {
    error: handleDatabaseError(error, { operation: 'startup' })
  });
  process.exit(1);
});

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
    const client = await pool.connect();
    try {
      logger.debug('Executing database query', { query: text, params });
      const result = await client.query(text, params);
      logger.debug('Query executed successfully', { rowCount: result.rowCount });
      return result;
    } catch (error) {
      logger.error('Query execution failed', { error, query: text, params });
      throw error;
    } finally {
      client.release();
    }
  },
  
  // Function to store model prediction with enhanced validation and retry logic
  async storeModelPrediction(client, sequenceId, modelName, predictedSymbol, confidence) {
    const startTime = Date.now();
    const context = {
      operation: 'storeModelPrediction',
      modelName,
      sequenceId
    };

    logger.info('[DB] Attempting to store model prediction', {
      ...context,
      predictedSymbol,
      confidence
    });

    // Validate input data
    try {
      validateData({
        modelName,
        sequenceId,
        symbol: predictedSymbol,
        confidence: confidence || 0
      }, ValidationRules);
    } catch (error) {
      logger.error('[DB] Validation failed for model prediction', {
        ...context,
        error: error.message
      });
      throw error;
    }

    return withTransaction(client, async (txClient) => {
      // Create savepoint for sequence validation
      await txClient.query('SAVEPOINT sequence_check');

      try {
        // Validate sequence exists with retry
        const sequenceExists = await withRetry(async () => {
          const result = await txClient.query(
            'SELECT id FROM sequences WHERE id = $1 FOR SHARE',
            [sequenceId]
          );
          return result.rows.length > 0;
        }, { ...context, operation: 'validate_sequence' });

        if (!sequenceExists) {
          await txClient.query('ROLLBACK TO SAVEPOINT sequence_check');
          throw new Error(`Sequence with ID ${sequenceId} does not exist`);
        }

        // Create savepoint for prediction insertion
        await txClient.query('SAVEPOINT prediction_insert');

        // Check for duplicate prediction
        const duplicateCheck = await txClient.query(`
          SELECT id FROM model_predictions 
          WHERE sequence_id = $1 AND model_type = $2
          FOR UPDATE SKIP LOCKED
        `, [sequenceId, modelName]);

        if (duplicateCheck.rows.length > 0) {
          logger.warn('[DB] Duplicate prediction detected', {
            ...context,
            existingPredictionId: duplicateCheck.rows[0].id
          });
          await txClient.query('ROLLBACK TO SAVEPOINT prediction_insert');
          throw new Error('Duplicate prediction detected');
        }

        const query = `
          INSERT INTO model_predictions (
            sequence_id,
            model_type,
            predicted_symbol,
            confidence,
            created_at,
            processing_time_ms
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
          RETURNING id, created_at;
        `;

        const processingTime = Date.now() - startTime;
        const values = [
          sequenceId,
          modelName,
          predictedSymbol,
          confidence || 0,
          processingTime
        ];

        logger.debug('[DB] Executing prediction storage query', {
          ...context,
          query,
          values: values.map((v, i) => `$${i + 1}: ${v}`),
          processingTimeMs: processingTime
        });

        const result = await txClient.query(query, values);

        if (result.rows.length === 0) {
          throw new Error('Failed to store prediction - no row returned');
        }

        logger.info('[DB] Model prediction stored successfully', {
          ...context,
          predictionId: result.rows[0].id,
          timestamp: result.rows[0].created_at,
          processingTimeMs: processingTime
        });

        // Update performance metrics asynchronously
        setImmediate(async () => {
          try {
            await withRetry(
              () => this.updateModelPerformanceMetrics(client, modelName),
              { ...context, operation: 'update_metrics' }
            );
          } catch (error) {
            logger.error('[DB] Failed to update performance metrics after prediction', {
              error: handleDatabaseError(error, context)
            });
          }
        });

        return result.rows[0];
      } catch (error) {
        const errorInfo = handleDatabaseError(error, context);
        logger.error('[DB] Failed to store model prediction', {
          ...errorInfo,
          processingTimeMs: Date.now() - startTime
        });

        // Handle specific error cases
        switch (error.code) {
          case '23503': // Foreign key violation
            logger.warn('[DB] Referenced sequence may have been deleted', context);
            break;
          case '23505': // Unique violation
            logger.warn('[DB] Duplicate prediction detected', context);
            break;
          case '40001': // Serialization failure
          case '40P01': // Deadlock detected
            logger.warn('[DB] Concurrency conflict detected', {
              ...context,
              errorCode: error.code
            });
            // Let the retry logic handle these cases
            break;
          default:
            // For other errors, add additional context if available
            if (error.detail) {
              logger.error('[DB] Additional error details', {
                ...context,
                detail: error.detail
              });
            }
        }
        
        throw error;
      }
    }, context);
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
    logger.info('[DB] Attempting to update model performance metrics', {
      modelName,
      timestamp: new Date().toISOString()
    });

    return withTransaction(client, async (txClient) => {
      try {
        // Validate model name
        if (!modelName) {
          throw new Error('Model name is required for updating performance metrics');
        }

        // First, check if we have predictions for this model
        const checkQuery = `
          SELECT COUNT(*) 
          FROM model_predictions 
          WHERE model_type = $1 
          AND created_at > NOW() - INTERVAL '24 hours'
        `;

        const checkResult = await txClient.query(checkQuery, [modelName]);
        
        logger.debug('[DB] Checked recent predictions', {
          modelName,
          recentPredictionCount: checkResult.rows[0].count
        });

        if (parseInt(checkResult.rows[0].count) === 0) {
          logger.warn('[DB] No recent predictions found for model', { modelName });
          return null;
        }

        // Calculate performance metrics
        const metricsQuery = `
          WITH recent_predictions AS (
            SELECT 
              correct_prediction,
              confidence,
              created_at
            FROM model_predictions
            WHERE model_type = $1
            AND created_at > NOW() - INTERVAL '24 hours'
            AND actual_symbol IS NOT NULL
          )
          SELECT 
            COUNT(*) as total_predictions,
            SUM(CASE WHEN correct_prediction THEN 1 ELSE 0 END)::float / COUNT(*) as accuracy,
            AVG(confidence) as avg_confidence,
            CORR(
              CASE WHEN correct_prediction THEN 1 ELSE 0 END, 
              confidence
            ) as confidence_correlation
          FROM recent_predictions;
        `;

        logger.debug('[DB] Executing metrics calculation query', {
          query: metricsQuery,
          modelName
        });

        const metricsResult = await txClient.query(metricsQuery, [modelName]);
        
        if (metricsResult.rows.length === 0 || !metricsResult.rows[0].total_predictions) {
          logger.warn('[DB] No valid predictions found for metrics calculation', { modelName });
          return null;
        }

        const metrics = metricsResult.rows[0];
        
        logger.info('[DB] Calculated performance metrics', {
          modelName,
          metrics: {
            totalPredictions: metrics.total_predictions,
            accuracy: metrics.accuracy,
            avgConfidence: metrics.avg_confidence,
            confidenceCorrelation: metrics.confidence_correlation
          }
        });

        // Store the calculated metrics
        const storeQuery = `
          INSERT INTO model_performance (
            model_type,
            accuracy,
            avg_confidence,
            confidence_correlation,
            sample_size,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
          RETURNING *;
        `;

        const storeValues = [
          modelName,
          metrics.accuracy || 0,
          metrics.avg_confidence || 0,
          metrics.confidence_correlation || 0,
          metrics.total_predictions
        ];

        logger.debug('[DB] Storing calculated metrics', {
          query: storeQuery,
          values: storeValues.map((v, i) => `$${i + 1}: ${v}`)
        });

        const storeResult = await txClient.query(storeQuery, storeValues);

        logger.info('[DB] Performance metrics stored successfully', {
          modelName,
          storedMetrics: storeResult.rows[0]
        });

        return storeResult.rows[0];
      } catch (error) {
        logger.error('[DB] Failed to update model performance metrics', {
          error: {
            message: error.message,
            code: error.code,
            detail: error.detail,
            hint: error.hint,
            where: error.where
          },
          modelName
        });
        throw error;
      }
    }, { operation: 'updateModelPerformanceMetrics', modelName });
  },

  // Function to store model performance metrics
  async storeModelPerformance(client, modelName, metrics) {
    logger.info('[DB] Attempting to store model performance', {
      modelName,
      metricsKeys: Object.keys(metrics)
    });

    return withTransaction(client, async (txClient) => {
      try {
        // Validate input parameters
        if (!modelName || !metrics) {
          throw new Error('Missing required parameters: modelName and metrics are required');
        }

        const query = `
          INSERT INTO model_performance (
            model_type,
            accuracy,
            precision,
            recall,
            f1_score,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
          RETURNING *;
        `;

        const values = [
          modelName,
          metrics.accuracy || 0,
          metrics.precision || 0,
          metrics.recall || 0,
          metrics.f1_score || 0
        ];

        logger.debug('[DB] Executing store performance query', {
          query,
          values: values.map((v, i) => `$${i + 1}: ${v}`),
          modelName
        });

        const result = await txClient.query(query, values);

        logger.info('[DB] Model performance stored successfully', {
          modelName,
          insertedRow: result.rows[0]
        });

        return result.rows[0];
      } catch (error) {
        logger.error('[DB] Failed to store model performance', {
          error: {
            message: error.message,
            code: error.code,
            detail: error.detail,
            hint: error.hint
          },
          modelName,
          metrics
        });
        throw error;
      }
    }, { operation: 'storeModelPerformance', modelName });
  },

  // Function to get recent model performance
  async getModelPerformance(client, modelName, limit = 100) {
    logger.info('[DB] Attempting to get model performance', {
      modelName,
      limit,
      transactionActive: client.transactionStatus,
      connectionStatus: client.connectionParameters
    });

    try {
      // Validate table existence first
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'model_performance'
        );
      `);

      if (!tableCheck.rows[0].exists) {
        const error = new Error('Table model_performance does not exist');
        logger.error('[DB] Table validation failed', { error });
        throw error;
      }

      // Validate column existence
      const columnCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public'
          AND table_name = 'model_performance'
          AND column_name = 'model_type'
        );
      `);

      if (!columnCheck.rows[0].exists) {
        const error = new Error('Column model_type does not exist in model_performance table');
        logger.error('[DB] Schema validation failed', { error });
        throw error;
      }

      const query = modelName ? `
        SELECT *
        FROM model_performance
        WHERE model_type = $1
        ORDER BY created_at DESC
        LIMIT $2;
      ` : `
        SELECT *
        FROM model_performance
        ORDER BY created_at DESC
        LIMIT $1;
      `;
      
      const values = modelName ? [modelName, limit] : [limit];
      
      logger.debug('[DB] Executing query', { 
        query,
        values,
        transactionId: client.processID
      });

      const result = await client.query(query, values);
      
      logger.info('[DB] Retrieved model performance', { 
        modelName,
        rowCount: result.rowCount,
        firstRow: result.rows[0] ? { 
          id: result.rows[0].id,
          model_type: result.rows[0].model_type,
          created_at: result.rows[0].created_at 
        } : null
      });

      return result.rows;
    } catch (error) {
      logger.error('[DB] Failed to get model performance', { 
        error: {
          message: error.message,
          code: error.code,
          position: error.position,
          detail: error.detail,
          hint: error.hint,
          where: error.where
        },
        modelName,
        transactionStatus: client.transactionStatus
      });
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

// Data validation utility
const validateData = (data, schema) => {
  if (!data) throw new Error('Data is required');
  
  for (const [field, rules] of Object.entries(schema)) {
    // Check required fields
    if (rules.required && !data[field]) {
      throw new Error(`${field} is required`);
    }
    
    // Check data types
    if (rules.type && data[field] !== undefined) {
      if (rules.type === 'number' && typeof data[field] !== 'number') {
        throw new Error(`${field} must be a number`);
      }
      if (rules.type === 'string' && typeof data[field] !== 'string') {
        throw new Error(`${field} must be a string`);
      }
      if (rules.type === 'array' && !Array.isArray(data[field])) {
        throw new Error(`${field} must be an array`);
      }
    }
    
    // Check ranges for numbers
    if (rules.min !== undefined && data[field] < rules.min) {
      throw new Error(`${field} must be at least ${rules.min}`);
    }
    if (rules.max !== undefined && data[field] > rules.max) {
      throw new Error(`${field} must be at most ${rules.max}`);
    }
  }
  
  return true;
};

module.exports = {
  ...dbUtils,
  validateData
};
