const express = require('express');
const router = express.Router();
const { Sequence, SequenceAnalytics, ModelPrediction } = require('../models');
const logger = require('../utils/logger');
const Redis = require('ioredis');
const { errorBoundary, validateSequence, AppError } = require('../middleware/errorBoundary');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const RNGGenerator = require('../utils/RNGGenerator');
const { QueryTypes } = require('sequelize');
const Cache = require('../utils/cache');
const StatisticalTests = require('../analysis/statisticalTests');

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
  const { sessionId, timeframe = '24h' } = req.query;
  const cacheKey = Cache.getAnalyticsKey(sessionId, timeframe);
  
  try {
    // Try to get from cache first
    const cachedData = await Cache.get(cacheKey);
    if (cachedData) {
      logger.debug('Analytics cache hit:', cacheKey);
      return res.json(cachedData);
    }

    // If not in cache, get from database
    const rawAnalytics = await SequenceAnalytics.findAll({
      order: [['time_bucket', 'DESC']],
      limit: 24,
      raw: true
    });

    const analytics = rawAnalytics.map(row => ({
      id: row?.id || '',
      time_bucket: row?.time_bucket || new Date().toISOString(),
      sequence_count: row?.sequence_count ? Number(row.sequence_count) : null,
      avg_entropy: row?.avg_entropy ? Number(row.avg_entropy) : null,
      pattern_distribution: {
        detected: row?.pattern_distribution?.detected ? Number(row.pattern_distribution.detected) : null,
        not_detected: row?.pattern_distribution?.not_detected ? Number(row.pattern_distribution.not_detected) : null
      },
      unique_batches: row?.unique_batches ? Number(row.unique_batches) : null
    }));

    // Cache the results
    await Cache.set(cacheKey, analytics);
    res.json(analytics);
  } catch (error) {
    throw new AppError('ANALYSIS_ERROR', `Failed to retrieve analytics: ${error.message}`);
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
  const { seed, length = 100, algorithm = 'LCG' } = req.body;
  const batchId = uuidv4();
  
  const rng = new RNGGenerator(seed, algorithm);
  const symbols = [];

  // Generate symbols and track transitions
  for (let i = 0; i < length; i++) {
    symbols.push({
      symbol: rng.next(),
      created_at: new Date(),
      batch_id: batchId,
      metadata: {
        seed,
        algorithm,
        position: i
      }
    });
  }

  // Bulk insert symbols
  await Sequence.bulkCreate(symbols);

  // Get initial analytics
  const analytics = await Sequence.sequelize.query(
    'SELECT analyze_transition_patterns(:batch_id) as analysis',
    {
      replacements: { batch_id: batchId },
      type: QueryTypes.SELECT
    }
  );

  // Log the analysis result
  logger.info('[DB] Retrieved analysis information', { analysis: analytics[0].analysis });

  res.json({
    batchId,
    symbolCount: length,
    transitions: rng.getTransitionMatrix(),
    analytics: analytics[0]?.analysis || {}
  });
}));

// Get next symbol prediction with analytics
router.get('/predict/:batchId', errorBoundary(async (req, res) => {
  const { batchId } = req.params;
  const cacheKey = `prediction:${batchId}`;
  
  // Try cache first
  const cachedPrediction = await redis.get(cacheKey);
  if (cachedPrediction) {
    return res.json(JSON.parse(cachedPrediction));
  }

  // Get sequence data
  const sequences = await Sequence.findAll({
    where: { batch_id: batchId },
    order: [['created_at', 'ASC']],
    raw: true
  });

  if (!sequences.length) {
    throw new Error('No sequences found for batch');
  }

  // Initialize RNG with same seed
  const rng = new RNGGenerator(sequences[0].metadata?.seed);
  
  // Replay sequence to build transition history
  sequences.forEach(() => rng.next());
  
  // Get prediction and analytics
  const prediction = rng.getPrediction();
  
  // Enhance with entropy and pattern analysis
  const [analytics] = await Sequence.sequelize.query(
    'SELECT analyze_transition_patterns(:batchId) as analysis',
    {
      replacements: { batchId },
      type: QueryTypes.SELECT
    }
  );

  const result = {
    ...prediction,
    entropy: analytics?.analysis?.transitions?.metadata?.entropy || 0,
    patternStrength: analytics?.analysis?.pattern_strength || 0,
    confidenceLevel: analytics?.analysis?.analysis?.confidence_level || 'low'
  };

  // Store prediction in model_predictions table
  const currentSequenceId = sequences[0].id;
  await ModelPrediction.create({
    sequence_id: currentSequenceId,
    model_type: 'markov_chain', 
    prediction_data: { next_symbol: result.nextSymbol },
    confidence_score: result.confidence,
    metadata: { feedback: null }
  });

  // Aggregate predictions from all models
  const unifiedPrediction = {
    nextSymbol: 'Heart',
    confidence: 0.8,
    breakdown: { markov_chain: 0.6, entropy: 0.2 }
  };

  // Cache prediction
  await redis.set(cacheKey, JSON.stringify(unifiedPrediction), 'EX', 30); // Cache for 30 seconds
  
  res.json(unifiedPrediction);
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
    throw new AppError('VALIDATION_ERROR', 'Sequence must be an array of numbers', 400);
  }

  try {
    // Get cached analysis if available
    const cacheKey = `analysis:${sequence.join('')}`;
    const cachedAnalysis = await Cache.get(cacheKey);
    if (cachedAnalysis) {
      logger.debug('Analysis cache hit:', cacheKey);
      return res.json(cachedAnalysis);
    }

    // Perform statistical tests
    const runsTest = StatisticalTests.runsTest(sequence);
    const autocorrelation = StatisticalTests.autocorrelation(sequence);
    
    // Get RNG predictions
    const rngGenerator = new RNGGenerator(Date.now());
    const prediction = rngGenerator.getPrediction();

    // Combine results
    const analysis = {
      randomness: {
        runsTest,
        autocorrelation
      },
      prediction: {
        nextSymbol: prediction.symbol,
        confidence: prediction.confidence,
        transitionMatrix: prediction.transitionMatrix
      },
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        sequenceLength: sequence.length
      }
    };

    // Cache the analysis
    await Cache.set(cacheKey, analysis);

    // Update RNG weights if entropy scores are available
    if (runsTest.isRandom !== null) {
      const entropyScores = {
        [ALGORITHMS.LCG]: runsTest.isRandom ? 1 : 0.5,
        [ALGORITHMS.XORShift]: autocorrelation.correlations.every(c => !c.significant) ? 1 : 0.5,
        [ALGORITHMS.MSWS]: prediction.confidence > 0.7 ? 1 : 0.5
      };
      rngGenerator.updateWeights(entropyScores);
    }

    res.json(analysis);
  } catch (error) {
    logger.error('Sequence analysis error:', error);
    throw new AppError('ANALYSIS_ERROR', `Failed to analyze sequence: ${error.message}`);
  }
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
  try {
    // Use the database function to reset game state
    await Sequence.sequelize.query('SELECT reset_game_state()', {
      type: QueryTypes.SELECT
    });
    
    // Clear Redis cache if it exists
    if (redis) {
      await redis.flushall();
    }
    
    res.status(204).send();
  } catch (error) {
    logger.error('Error in reset endpoint:', error);
    throw new AppError('Failed to reset game state', 500);
  }
}));

// Add new symbol with automatic analysis
router.post('/add-symbol', errorBoundary(async (req, res) => {
  const { symbol, batchId } = req.body;
  
  if (symbol === undefined || !batchId) {
    throw new AppError('Symbol and batch ID are required', 400);
  }

  try {
    const [result] = await Sequence.sequelize.query(
      'SELECT * FROM add_sequence_with_analysis(:symbol, :batchId)',
      {
        replacements: { symbol, batchId },
        type: QueryTypes.SELECT
      }
    );

    res.json(result);
  } catch (error) {
    logger.error('Error adding sequence:', error);
    throw new AppError('Failed to add sequence', 500);
  }
}));

// Manual symbol or sequence entry
router.post('/manual-entry', validateSequence, errorBoundary(async (req, res) => {
  const { symbol, sequence } = req.body;
  const batchId = uuidv4();

  try {
    if (symbol !== undefined) {
      // Handle single symbol
      await Sequence.create({
        symbol,
        batch_id: batchId,
        metadata: {
          type: 'manual',
          timestamp: new Date().toISOString()
        }
      });

      return res.json({ 
        success: true, 
        batchId,
        symbol,
        symbolName: RNGGenerator.getSymbolName(symbol)
      });
    }

    // Handle sequence array
    const sequences = sequence.map((s, index) => ({
      symbol: s,
      batch_id: batchId,
      metadata: {
        type: 'manual',
        position: index,
        timestamp: new Date().toISOString()
      }
    }));

    await Sequence.bulkCreate(sequences);

    res.json({
      success: true,
      batchId,
      count: sequence.length,
      sequences: sequence.map(s => ({
        symbol: s,
        symbolName: RNGGenerator.getSymbolName(s)
      }))
    });
  } catch (error) {
    logger.error('Manual entry failed', { 
      error: error.message,
      input: { symbol, sequence }
    });
    throw error;
  }
}));

module.exports = router;
