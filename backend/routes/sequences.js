const express = require('express');
const router = express.Router();
const DatabaseManager = require('../utils/dbManager');
const logger = require('../utils/logger');
const PatternAnalyzer = require('../utils/patternAnalysis');
const RNGGenerator = require('../utils/rngGenerators');
const { errorBoundary, validateSequence, AppError } = require('../middleware/errorBoundary');
const { v4: uuidv4 } = require('uuid');

// Check table structure (for debugging only)
router.get('/debug/schema', errorBoundary(async (req, res) => {
  const result = await DatabaseManager.withTransaction(async (client) => {
    const result = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'sequences'
      ORDER BY ordinal_position;
    `);
    logger.info('[DB] Retrieved schema information', { columns: result.rows });
    return result.rows;
  });
  res.json(result);
}));

// Get all sequences
router.get('/', errorBoundary(async (req, res) => {
  const result = await DatabaseManager.withTransaction(async (client) => {
    logger.info('[DB] Fetching all sequences');
    const queryResult = await client.query(
      'SELECT symbol, created_at FROM sequences ORDER BY created_at ASC'
    );
    
    return queryResult.rows.map(row => ({
      symbol: row.symbol,
      created_at: row.created_at.toISOString()
    }));
  }, { timeout: 15000 }); // 15s timeout for large queries
  
  res.json({ sequence: result });
}));

// Get recent sequences with pattern analysis
router.get('/recent', errorBoundary(async (req, res) => {
  const { limit = 100 } = req.query;
  
  const result = await DatabaseManager.withTransaction(async (client) => {
    const analyzer = new PatternAnalyzer();

    const sequences = await client.query(`
      SELECT s.*, 
             array_agg(s2.symbol) OVER (
               PARTITION BY (s.created_at::date) 
               ORDER BY s.created_at 
               ROWS BETWEEN 9 PRECEDING AND CURRENT ROW
             ) as symbol_window
      FROM sequences s
      LEFT JOIN sequences s2 
        ON s2.created_at <= s.created_at 
        AND s2.created_at > s.created_at - interval '1 minute'
      WHERE s.created_at > NOW() - interval '1 hour'
      ORDER BY s.created_at DESC
      LIMIT $1
    `, [limit]);

    // Process sequences in batches to prevent memory issues
    const analyzedSequences = await DatabaseManager.withBatch(
      sequences.rows,
      10, // Process 10 sequences at a time
      async (_, batch) => {
        return Promise.all(batch.map(async row => {
          if (row.symbol_window?.length >= 3) {
            const analysis = await analyzer.analyzeSequence(row.symbol_window);
            return {
              ...row,
              pattern_analysis: {
                entropy: analysis.entropy,
                patterns: analysis.patterns,
                transitions: analysis.transitions
              }
            };
          }
          return row;
        }));
      }
    );

    return {
      sequences: analyzedSequences,
      metadata: {
        analyzed_count: analyzedSequences.filter(s => s.pattern_analysis).length,
        total_count: analyzedSequences.length
      }
    };
  }, { 
    timeout: 30000, // 30s timeout for analysis
    isolationLevel: 'READ COMMITTED' // Use lower isolation for read-only
  });

  res.json(result);
}));

// Add new sequence with immediate analysis
router.post('/', errorBoundary(async (req, res) => {
  const { symbol } = req.body;
  if (typeof symbol !== 'number' || symbol < 0 || symbol > 3) {
    throw new AppError('Invalid symbol: must be number between 0 and 3', 400);
  }

  const result = await DatabaseManager.withTransaction(async (client) => {
    // Insert new symbol
    const result = await client.query(`
      INSERT INTO sequences (symbol, created_at)
      VALUES ($1, CURRENT_TIMESTAMP)
      RETURNING id, symbol, created_at
    `, [symbol]);

    // Send immediate response
    res.json({
      message: 'Sequence added successfully',
      sequence: {
        id: result.rows[0].id,
        symbol,
        created_at: result.rows[0].created_at
      }
    });

    // Perform analysis asynchronously
    const analyzeSequence = async () => {
      const analysisClient = await DatabaseManager.getClient();
      try {
        // Get recent sequence window for analysis (increased to 1 hour)
        const windowResult = await analysisClient.query(`
          SELECT 
            array_agg(symbol ORDER BY created_at) as symbols,
            COUNT(*) as symbol_count,
            MAX(created_at) as latest_created_at
          FROM sequences
          WHERE created_at > NOW() - interval '1 hour'
          GROUP BY DATE_TRUNC('hour', created_at)
          ORDER BY MAX(created_at) DESC
        `);

        if (!windowResult.rows[0]?.symbols || windowResult.rows[0].symbol_count < 2) {
          logger.info('Not enough symbols for analysis yet');
          return;
        }

        const symbols = windowResult.rows[0].symbols;
        const analyzer = new PatternAnalyzer();
        
        // Initialize performance metrics if needed
        await analysisClient.query(`
          INSERT INTO model_performance (model_name, correct_predictions, total_predictions, last_updated)
          SELECT m.name, 0, 0, CURRENT_TIMESTAMP
          FROM (
            VALUES ('markovChain'), ('entropy'), ('chiSquare'), ('monteCarlo'),
                   ('arima'), ('lstm'), ('hmm'), ('rng')
          ) AS m(name)
          WHERE NOT EXISTS (
            SELECT 1 FROM model_performance WHERE model_name = m.name
          )
        `);

        const predictions = await analyzer.analyzeSequence(symbols);
        
        // Update model performance metrics
        for (const [model, prediction] of Object.entries(predictions)) {
          if (prediction && typeof prediction.confidence === 'number') {
            await analysisClient.query(`
              UPDATE model_performance 
              SET 
                total_predictions = total_predictions + 1,
                correct_predictions = CASE 
                  WHEN $1 = $2 THEN correct_predictions + 1 
                  ELSE correct_predictions 
                END,
                last_updated = CURRENT_TIMESTAMP
              WHERE model_name = $3
            `, [prediction.prediction, symbol, model]);
          }
        }

        logger.info('Sequence analysis completed successfully', {
          symbolCount: symbols.length,
          models: Object.keys(predictions)
        });
      } catch (error) {
        logger.error('Error in async sequence analysis:', error);
      } finally {
        analysisClient.release();
      }
    };

    // Start analysis in background
    analyzeSequence().catch(err => {
      logger.error('Failed to start sequence analysis:', err);
    });
  });
}));

// Undo last symbol
router.delete('/undo', errorBoundary(async (req, res) => {
  const result = await DatabaseManager.withTransaction(async (client) => {
    // Get the last symbol before deleting
    const lastSymbol = await client.query(
      'SELECT * FROM sequences ORDER BY created_at DESC LIMIT 1'
    );
    
    console.log('[DB] Attempting to undo last symbol:', lastSymbol.rows[0]);
    
    await client.query(
      'DELETE FROM sequences WHERE id = (SELECT id FROM sequences ORDER BY created_at DESC LIMIT 1)'
    );
    
    // Verify deletion
    const verification = await client.query(
      'SELECT COUNT(*) FROM sequences'
    );
    
    console.log('[DB] Sequences after undo:', verification.rows[0].count);
    
    return { 
      success: true,
      removed: lastSymbol.rows[0],
      remaining: verification.rows[0].count
    };
  });
  res.json(result);
}));

// Generate test data
router.post('/generate', errorBoundary(async (req, res) => {
  const { seedType = 'lcg', seedValue = Date.now(), length = 90 } = req.body;
  
  if (!seedValue) {
    throw new AppError('Missing required parameter: seedValue', 400);
  }

  logger.info('[DB] Generating test data', { seedType, seedValue, length });

  // Generate test data
  const generator = new RNGGenerator(parseInt(seedValue));
  generator.setType(seedType);
  
  const symbols = [];
  for (let i = 0; i < length; i++) {
    // Map the generated number to 0-3 range for symbols
    symbols.push(generator.next() % 4);
  }

  // Batch insert all symbols
  const values = symbols.map((symbol, index) => 
    `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3}::jsonb)`
  ).join(',');
  
  const params = symbols.reduce((params, val, index) => [
    ...params,
    val,
    generator.uuid(),
    JSON.stringify({
      position: index + 1,
      seedType,
      seedValue,
      generatedAt: new Date().toISOString()
    })
  ], []);

  const result = await DatabaseManager.withTransaction(async (client) => {
    const result = await client.query(`
      INSERT INTO sequences (symbol, batch_id, metadata)
      VALUES ${values}
      RETURNING id
    `, params);

    logger.info('[DB] Successfully inserted test data sequences', {
      count: result.rowCount,
      batchId: generator.uuid()
    });

    return {
      message: 'Test data generated successfully',
      count: result.rowCount,
      batchId: generator.uuid(),
      expectedLength: length
    };
  });
  res.json(result);
}));

// Analyze sequence and store predictions
router.post('/analyze', errorBoundary(async (req, res) => {
  const { sequence, metadata = {} } = req.body;
  if (!Array.isArray(sequence)) {
    throw new AppError('Sequence must be an array of numbers', 400);
  }

  const analyzer = new PatternAnalyzer();
  const analysis = await analyzer.analyzeSequence(sequence);
  
  // Store analysis results
  // Store in model_predictions
  const predictionResult = await DatabaseManager.withTransaction(async (client) => {
    const result = await client.query(`
      INSERT INTO model_predictions (
        sequence_id,
        model_type,
        prediction_data,
        confidence_score,
        metadata
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      metadata.sequence_id || null,
      'pattern_analysis',
      JSON.stringify(analysis.patterns),
      analysis.entropy, // Using entropy as confidence score
      JSON.stringify({
        ...metadata,
        transitions: analysis.transitions,
        uniqueSymbols: analysis.metadata.uniqueSymbols,
        timestamp: analysis.metadata.timestamp
      })
    ]);

    // Update model_performance if we have ground truth
    if (metadata.actual_seed) {
      await client.query(`
        INSERT INTO model_performance (
          prediction_id,
          actual_value,
          predicted_value,
          error_metrics,
          metadata
        ) VALUES ($1, $2, $3, $4, $5)
      `, [
        result.rows[0].id,
        metadata.actual_seed,
        analysis.patterns[0]?.[0] || null, // Most significant pattern
        JSON.stringify({
          entropy: analysis.entropy,
          patternCount: analysis.patterns.length
        }),
        JSON.stringify({
          analysisTimestamp: new Date(),
          modelType: 'pattern_analysis',
          sequenceLength: sequence.length
        })
      ]);
    }

    return {
      message: 'Analysis complete',
      results: analysis,
      predictionId: result.rows[0].id
    };
  });
  res.json(predictionResult);
}));

// Analyze sequences for RNG seed discovery
router.post('/discover-seed', errorBoundary(async (req, res) => {
  const { windowSize = 100, minConfidence = 0.7 } = req.body;
  const analyzer = new PatternAnalyzer();

  const result = await DatabaseManager.withTransaction(async (client) => {
    // Get recent sequences for analysis
    const sequencesResult = await client.query(`
      SELECT array_agg(symbol ORDER BY created_at) as symbols,
             MAX(entropy_value) as max_entropy,
             bool_or(pattern_detected) as has_patterns
      FROM (
        SELECT *
        FROM sequences
        WHERE created_at > NOW() - interval '1 hour'
        ORDER BY created_at DESC
        LIMIT $1
      ) recent
    `, [windowSize]);

    const sequence = sequencesResult.rows[0]?.symbols || [];
    if (sequence.length < windowSize) {
      throw new AppError('Insufficient sequence data for analysis', 400);
    }

    // Analyze sequence patterns
    const analysis = await analyzer.analyzeSequence(sequence);
    
    // Look for potential RNG seeds based on patterns
    const potentialSeeds = [];
    const rngTypes = ['lcg', 'xorshift', 'msws'];
    
    for (const rngType of rngTypes) {
      // Try different seed values
      for (let seed = 1; seed <= 100; seed++) {
        const generator = new RNGGenerator(seed);
        const testSequence = generator.generateSequence(rngType, windowSize);
        
        // Calculate similarity with observed sequence
        const similarity = analyzer.calculateSimilarity(sequence, testSequence);
        
        if (similarity > minConfidence) {
          potentialSeeds.push({
            seed,
            rngType,
            confidence: similarity,
            matchedPatterns: analysis.patterns.filter(p => 
              testSequence.join('').includes(p[0])
            ).length
          });
        }
      }
    }

    // Sort by confidence and filter top candidates
    const topCandidates = potentialSeeds
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    // Store predictions in model_predictions table
    for (const candidate of topCandidates) {
      await client.query(`
        INSERT INTO model_predictions (
          model_type,
          prediction_data,
          confidence_score,
          metadata
        ) VALUES ($1, $2, $3, $4)
      `, [
        'rng_seed_discovery',
        JSON.stringify({
          seed: candidate.seed,
          rngType: candidate.rngType
        }),
        candidate.confidence,
        JSON.stringify({
          analysis_timestamp: new Date(),
          window_size: windowSize,
          matched_patterns: candidate.matchedPatterns,
          entropy: analysis.entropy,
          sequence_patterns: analysis.patterns
        })
      ]);
    }

    return {
      message: 'Seed discovery complete',
      candidates: topCandidates,
      analysis: {
        entropy: analysis.entropy,
        patternCount: analysis.patterns.length,
        windowSize
      }
    };
  });
  res.json(result);
}));

// Reset database
router.post('/reset', errorBoundary(async (req, res) => {
  const result = await DatabaseManager.withTransaction(async (client) => {
    logger.info('[DB] Starting database reset');
    
    // Get counts before reset
    const beforeCounts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM sequences) as sequences_count,
        (SELECT COUNT(*) FROM model_predictions) as predictions_count,
        (SELECT COUNT(*) FROM model_performance) as performance_count
    `);
    
    logger.info('[DB] Counts before reset:', beforeCounts.rows[0]);
    
    // Truncate all related tables in the correct order
    await client.query(`
      TRUNCATE TABLE 
        model_predictions,
        model_performance,
        sequences
      CASCADE
    `);
    
    // Verify reset
    const afterCounts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM sequences) as sequences_count,
        (SELECT COUNT(*) FROM model_predictions) as predictions_count,
        (SELECT COUNT(*) FROM model_performance) as performance_count
    `);
    
    logger.info('[DB] Counts after reset:', afterCounts.rows[0]);
    
    return { 
      message: 'Database reset successfully',
      before: beforeCounts.rows[0],
      after: afterCounts.rows[0]
    };
  });
  res.json(result);
}));

module.exports = router;
