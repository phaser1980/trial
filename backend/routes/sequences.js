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

    // Queue analysis jobs for sequences
    const jobPromises = sequences.rows.map(async (row) => {
      if (row.symbol_window?.length >= 3) {
        const jobId = `analysis_${row.id}_${Date.now()}`;
        await global.analysisQueue.queue.add('patternAnalysis', {
          sequenceId: row.id,
          symbols: row.symbol_window,
          timestamp: row.created_at
        }, {
          jobId,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        });
        
        return {
          ...row,
          analysis_job_id: jobId,
          status: 'queued'
        };
      }
      return row;
    });

    const analyzedSequences = await Promise.all(jobPromises);

    return {
      sequences: analyzedSequences,
      metadata: {
        queued_count: analyzedSequences.filter(s => s.analysis_job_id).length,
        total_count: analyzedSequences.length
      }
    };
  }, { 
    timeout: 30000,
    isolationLevel: 'READ COMMITTED'
  });

  // Set up WebSocket subscription for analysis updates
  if (global.wsManager) {
    const channel = `analysis_updates_${uuidv4()}`;
    global.wsManager.broadcast('analysis_subscription', {
      channel,
      sequences: result.sequences.map(s => s.analysis_job_id).filter(Boolean)
    });
  }

  res.json(result);
}));

// Create new sequence
router.post('/', validateSequence, errorBoundary(async (req, res) => {
  const { symbol } = req.body;
  
  const result = await DatabaseManager.withTransaction(async (client) => {
    const insertResult = await client.query(
      'INSERT INTO sequences (symbol, created_at) VALUES ($1, NOW()) RETURNING *',
      [symbol]
    );
    
    const newSequence = insertResult.rows[0];
    
    // Notify connected clients about new sequence
    if (global.wsManager) {
      global.wsManager.broadcast('new_sequence', {
        id: newSequence.id,
        symbol: newSequence.symbol,
        created_at: newSequence.created_at
      });
    }

    // Queue immediate analysis if we have enough recent sequences
    const recentSequences = await client.query(`
      SELECT symbol 
      FROM sequences 
      WHERE created_at > NOW() - interval '1 minute'
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    if (recentSequences.rows.length >= 3) {
      const symbols = recentSequences.rows.map(row => row.symbol);
      const jobId = `analysis_${newSequence.id}_${Date.now()}`;
      
      if (global.analysisQueue) {
        await global.analysisQueue.addJob({
          sequenceId: newSequence.id,
          symbols,
          timestamp: newSequence.created_at
        }, {
          jobId,
          priority: 1,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000
          }
        });

        newSequence.analysis_job_id = jobId;
      }
    }

    return newSequence;
  });

  res.status(201).json(result);
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
  const { count = 100, seed = Date.now() } = req.body;
  
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new AppError('INVALID_COUNT', 'Count must be between 1 and 10000', 400);
  }

  const generator = new RNGGenerator(seed);
  const symbols = Array.from({ length: count }, () => Math.floor(generator.next() % 4));

  const result = await DatabaseManager.withTransaction(async (client) => {
    const values = symbols.map((symbol, index) => 
      `($${index + 1}, NOW() + interval '${index} milliseconds')`
    ).join(',');

    const query = `
      INSERT INTO sequences (symbol, created_at)
      VALUES ${values}
      RETURNING id, symbol, created_at
    `;

    const insertResult = await client.query(query, symbols);
    return insertResult.rows;
  });

  // Notify clients about new sequences
  if (global.wsManager) {
    result.forEach(sequence => {
      global.wsManager.broadcast('new_sequence', {
        id: sequence.id,
        symbol: sequence.symbol,
        created_at: sequence.created_at
      });
    });
  }

  // Queue analysis for the new batch
  if (global.analysisQueue && result.length >= 3) {
    const symbols = result.map(row => row.symbol);
    const jobId = `analysis_batch_${Date.now()}`;
    
    try {
      await global.analysisQueue.addJob({
        sequenceId: result[0].id,
        symbols,
        timestamp: result[0].created_at,
        metadata: {
          batchSize: result.length,
          seed
        }
      }, {
        jobId,
        priority: 2,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      });
    } catch (error) {
      logger.warn('Failed to queue analysis job:', error);
      // Continue without analysis
    }
  }

  res.status(201).json({
    message: `Generated ${result.length} sequences`,
    sequences: result
  });
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
