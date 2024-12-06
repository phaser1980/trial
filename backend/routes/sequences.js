const express = require('express');
const router = express.Router();
const { Sequence, SequenceAnalytics } = require('../models');
const logger = require('../utils/logger');
const Redis = require('ioredis');
const { errorBoundary, validateSequence, AppError } = require('../middleware/errorBoundary');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const RNGGenerator = require('../utils/RNGGenerator');

// Initialize Redis client
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const CACHE_TTL = 300; // 5 minutes

// Check table structure (for debugging only)
router.get('/debug/schema', errorBoundary(async (req, res) => {
  const result = await Sequence.sequelize.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'sequences'
    ORDER BY ordinal_position;
  `);
  logger.info('[DB] Retrieved schema information', { columns: result[0] });
  res.json(result[0]);
}));

// Get analytics from materialized view with Redis caching
router.get('/analytics', errorBoundary(async (req, res) => {
  try {
    // Always return an array, even if empty
    let analytics = [];
    
    try {
      const rawAnalytics = await SequenceAnalytics.findAll({
        order: [['time_bucket', 'DESC']],
        limit: 24,
        raw: true
      });

      if (Array.isArray(rawAnalytics)) {
        analytics = rawAnalytics.map(row => ({
          id: row?.id || '',
          time_bucket: row?.time_bucket || new Date().toISOString(),
          sequence_count: row?.sequence_count ? Number(row.sequence_count) : null,
          avg_entropy: row?.avg_entropy ? Number(row.avg_entropy) : null,
          pattern_distribution: {
            detected: row?.pattern_distribution?.detected ? Number(row.pattern_distribution.detected) : null,
            not_detected: row?.pattern_distribution?.not_detected ? Number(row.pattern_distribution.not_detected) : null
          },
          unique_batches: row?.unique_batches ? Number(row.unique_batches) : null,
          avg_confidence: row?.avg_confidence ? Number(row.avg_confidence) : null,
          unique_seeds: row?.unique_seeds ? Number(row.unique_seeds) : null
        }));
      }
    } catch (dbError) {
      logger.error('[Analytics] Database error:', dbError);
    }

    return res.json({ 
      sequences: analytics.map(row => ({
        ...row,
        // Only convert to number if value exists, otherwise keep as null
        avg_entropy: row.avg_entropy !== null ? Number(row.avg_entropy) : null,
        avg_confidence: row.avg_confidence !== null ? Number(row.avg_confidence) : null
      }))
    });
    
  } catch (error) {
    logger.error('[Analytics] Error:', error);
    return res.json({ sequences: [] });
  }
}));

// Get all sequences
router.get('/', errorBoundary(async (req, res) => {
  try {
    const result = await Sequence.findAll({
      attributes: ['symbol', 'created_at'],
      order: [['created_at', 'ASC']]
    }) || [];

    res.json({ 
      sequences: result.map(row => ({
        symbol: row.symbol,
        created_at: row.created_at.toISOString()
      }))
    });
  } catch (error) {
    logger.error('[Sequences] Error:', error);
    res.json({ sequences: [] });
  }
}));

// Get recent sequences with pattern analysis
router.get('/recent', errorBoundary(async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const sequences = await Sequence.findAll({
      where: {
        created_at: {
          [Op.gt]: new Date(Date.now() - 60 * 60 * 1000)
        }
      },
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      attributes: [
        'id', 'symbol', 'created_at', 'entropy_value',
        'pattern_detected', 'pattern_strength', 'metadata'
      ]
    }) || [];

    res.json({ sequences });
  } catch (error) {
    logger.error('[Recent Sequences] Error:', error);
    res.json({ sequences: [] });
  }
}));

// Create new sequence
router.post('/', validateSequence, errorBoundary(async (req, res) => {
  const { symbol, metadata = {} } = req.body;
  const batchId = req.body.batch_id || uuidv4();

  const sequence = await Sequence.create({
    symbol,
    batch_id: batchId,
    metadata
  });

  // Trigger materialized view refresh if needed
  await SequenceAnalytics.sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sequence_analytics');
  
  res.status(201).json({ sequences: [sequence] });
}));

// Batch create sequences
router.post('/batch', errorBoundary(async (req, res) => {
  const { sequences } = req.body;
  if (!Array.isArray(sequences)) {
    throw new AppError('Sequences must be an array', 400);
  }

  const batchId = uuidv4();
  const sequenceRecords = sequences.map(seq => ({
    ...seq,
    batch_id: batchId
  }));

  const created = await Sequence.bulkCreate(sequenceRecords);

  // Trigger materialized view refresh
  await SequenceAnalytics.sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sequence_analytics');

  res.status(201).json({
    count: created.length,
    batch_id: batchId,
    sequences: created
  });
}));

// Delete last sequence (for undo functionality)
router.delete('/undo', errorBoundary(async (req, res) => {
  const lastSequence = await Sequence.findOne({
    order: [['created_at', 'DESC']]
  });

  if (!lastSequence) {
    throw new AppError('No sequences to undo', 404);
  }

  await lastSequence.destroy();
  
  // Trigger materialized view refresh
  await SequenceAnalytics.sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sequence_analytics');

  res.json({ sequences: [] });
}));

// Generate test data
router.post('/generate', errorBoundary(async (req, res) => {
  const { count = 100, seed = Date.now(), algorithm = 'LCG' } = req.body;
  const batchId = req.body.batchId || uuidv4();
  
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new AppError('INVALID_COUNT', 'Count must be between 1 and 10000', 400);
  }

  try {
    const rng = new RNGGenerator(seed, algorithm);
    const sequence = rng.generateSequence(count);

    const sequenceRecords = sequence.map(symbol => ({
      symbol,
      batch_id: batchId,
      metadata: {
        seed,
        algorithm,
        timestamp: new Date().toISOString()
      }
    }));

    const created = await Sequence.bulkCreate(sequenceRecords);

    // Trigger materialized view refresh
    await SequenceAnalytics.sequelize.query('SELECT refresh_sequence_analytics()');

    res.status(201).json({
      sequences: created,
      metadata: {
        batch_id: batchId,
        seed,
        algorithm,
        count: created.length
      }
    });

  } catch (error) {
    logger.error('[Generate] Error:', error);
    throw new AppError('GENERATION_ERROR', 'Failed to generate sequence: ' + error.message, 500);
  }
}));

// Analyze patterns in a sequence batch
router.post('/analyze', errorBoundary(async (req, res) => {
  const { batchId } = req.body;
  if (!batchId) {
    throw new AppError('Batch ID is required', 400);
  }

  const result = await Sequence.findAll({
    where: {
      batch_id: batchId
    },
    attributes: ['symbol', 'created_at']
  });

  // Use database functions for analysis
  const analysis = await Sequence.sequelize.query(`
    WITH batch_symbols AS (
      SELECT array_agg(symbol ORDER BY created_at) as symbols
      FROM sequences
      WHERE batch_id = $1
    )
    SELECT 
      match_rng_pattern(symbols, 'LCG') as lcg_analysis,
      match_rng_pattern(symbols, 'XORShift') as xorshift_analysis,
      match_rng_pattern(symbols, 'MSWS') as msws_analysis
    FROM batch_symbols
  `, [batchId]);

  return res.json({ 
    sequences: result,
    analysis: analysis[0][0],
    timestamp: new Date()
  });
}));

// Analyze sequence and store predictions
router.post('/analyze-sequence', errorBoundary(async (req, res) => {
  const { sequence, metadata = {} } = req.body;
  if (!Array.isArray(sequence)) {
    throw new AppError('Sequence must be an array of numbers', 400);
  }

  const analyzer = new PatternAnalyzer();
  const analysis = await analyzer.analyzeSequence(sequence);
  
  // Store analysis results
  // Store in model_predictions
  const predictionResult = await Sequence.sequelize.transaction(async (transaction) => {
    const result = await Sequence.create({
      symbol: sequence[0],
      metadata: {
        ...metadata,
        transitions: analysis.transitions,
        uniqueSymbols: analysis.metadata.uniqueSymbols,
        timestamp: analysis.metadata.timestamp
      }
    }, { transaction });

    // Update model_performance if we have ground truth
    if (metadata.actual_seed) {
      await Sequence.sequelize.query(`
        INSERT INTO model_performance (
          prediction_id,
          actual_value,
          predicted_value,
          error_metrics,
          metadata
        ) VALUES ($1, $2, $3, $4, $5)
      `, [
        result.id,
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
      ], { transaction });
    }

    return {
      message: 'Analysis complete',
      results: analysis,
      predictionId: result.id
    };
  });
  res.json({ sequences: [predictionResult] });
}));

// Analyze sequences for RNG seed discovery
router.post('/discover-seed', errorBoundary(async (req, res) => {
  const { windowSize = 100, minConfidence = 0.7 } = req.body;
  const analyzer = new PatternAnalyzer();

  const result = await Sequence.sequelize.transaction(async (transaction) => {
    // Get recent sequences for analysis
    const sequencesResult = await Sequence.findAll({
      where: {
        created_at: {
          [Op.gt]: new Date(Date.now() - 60 * 60 * 1000) // last hour
        }
      },
      order: [['created_at', 'DESC']],
      limit: windowSize,
      attributes: ['symbol']
    }, { transaction });

    const sequence = sequencesResult.map(row => row.symbol);
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
      await Sequence.create({
        symbol: sequence[0],
        metadata: {
          seed: candidate.seed,
          rngType: candidate.rngType,
          confidence: candidate.confidence,
          matchedPatterns: candidate.matchedPatterns,
          analysisTimestamp: new Date(),
          windowSize,
          entropy: analysis.entropy,
          sequencePatterns: analysis.patterns
        }
      }, { transaction });
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
  res.json({ sequences: [] });
}));

// Reset game state
router.post('/reset', errorBoundary(async (req, res) => {
  const lockKey = 'reset_lock';
  try {
    // Check if reset is already in progress
    const lockExists = await redis.get(lockKey);
    if (lockExists) {
      logger.warn('[Reset] Reset already in progress, skipping');
      return res.status(409).json({ message: 'Reset already in progress' });
    }

    // Set lock with 30s timeout
    await redis.set(lockKey, '1', 'EX', 30);

    await Sequence.sequelize.transaction(async (transaction) => {
      // Clear sequences in batches
      let deleted;
      do {
        deleted = await Sequence.destroy({
          where: {},
          limit: 1000,
          cascade: true,
          transaction
        });
        logger.info(`[Reset] Deleted ${deleted} sequences`);
      } while (deleted > 0);

      // Refresh analytics once after all deletions
      await SequenceAnalytics.sequelize.query('SELECT refresh_sequence_analytics()');
    });

    // Clear Redis cache with timeout protection
    const redisFlushPromise = redis.flushall();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Redis flush timed out")), 5000)
    );
    await Promise.race([redisFlushPromise, timeoutPromise]);

    logger.info('[Reset] Game state reset successfully');
    res.json({ message: 'Game state reset successfully', sequences: [] });
  } catch (error) {
    logger.error('[Reset] Error:', error);
    throw new AppError('RESET_ERROR', 'Failed to reset game state: ' + error.message, 500);
  } finally {
    // Always clear the lock
    await redis.del(lockKey);
  }
}));

module.exports = router;
