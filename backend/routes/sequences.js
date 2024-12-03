const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../utils/logger');
const PatternAnalyzer = require('../utils/patternAnalysis');
const RNGGenerator = require('../utils/rngGenerators');

// Check table structure (for debugging only)
router.get('/debug/schema', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'sequences'
      ORDER BY ordinal_position;
    `);
    logger.info('[DB] Retrieved schema information', { columns: result.rows });
    res.json(result.rows);
  } catch (err) {
    logger.error('[DB] Error checking schema:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all sequences
router.get('/', async (req, res) => {
  try {
    console.log('[DB] Fetching all sequences');
    const result = await db.query(
      'SELECT symbol, created_at FROM sequences ORDER BY created_at ASC'
    );
    
    const sequence = result.rows.map(row => ({
      symbol: row.symbol,
      created_at: row.created_at.toISOString()
    }));
    
    console.log('[DB] Retrieved sequences:', {
      count: sequence.length,
      first: sequence[0],
      last: sequence[sequence.length - 1]
    });
    
    res.json({ sequence });
  } catch (err) {
    console.error('[DB] Error fetching sequences:', err);
    res.json({ sequence: [] });
  }
});

// Get recent sequences with pattern analysis
router.get('/recent', async (req, res) => {
  const client = await db.getClient();
  try {
    const { limit = 100 } = req.query;
    const analyzer = new PatternAnalyzer();

    const result = await client.query(`
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

    // Analyze patterns in the retrieved sequences
    const analyzedSequences = await Promise.all(
      result.rows.map(async row => {
        if (row.symbol_window && row.symbol_window.length >= 3) {
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
      })
    );

    logger.info('[Sequences] Retrieved and analyzed recent sequences', {
      count: analyzedSequences.length
    });

    res.json({
      sequences: analyzedSequences,
      metadata: {
        analyzed_count: analyzedSequences.filter(s => s.pattern_analysis).length,
        total_count: analyzedSequences.length
      }
    });
  } catch (error) {
    logger.error('[Sequences] Error retrieving sequences:', error);
    res.status(500).json({ error: 'Failed to retrieve sequences' });
  } finally {
    client.release();
  }
});

// Add new sequence with immediate analysis
router.post('/', async (req, res) => {
  const client = await db.getClient();
  try {
    const { symbol } = req.body;
    if (typeof symbol !== 'number' || symbol < 0 || symbol > 3) {
      throw new Error('Invalid symbol: must be number between 0 and 3');
    }

    await client.query('BEGIN');

    // Insert new symbol
    const result = await client.query(`
      INSERT INTO sequences (symbol)
      VALUES ($1)
      RETURNING id, created_at
    `, [symbol]);

    // Get recent sequence window for analysis
    const windowResult = await client.query(`
      SELECT array_agg(symbol ORDER BY created_at) as symbols
      FROM sequences
      WHERE created_at > NOW() - interval '1 minute'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const sequence = windowResult.rows[0]?.symbols || [];
    if (sequence.length >= 3) {
      const analyzer = new PatternAnalyzer();
      const analysis = await analyzer.analyzeSequence(sequence);

      // Update the sequence with analysis results
      await client.query(`
        UPDATE sequences
        SET 
          entropy_value = $1,
          pattern_detected = $2,
          metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{pattern_analysis}',
            $3::jsonb
          )
        WHERE id = $4
      `, [
        analysis.entropy,
        analysis.patterns.length > 0,
        JSON.stringify({
          patterns: analysis.patterns,
          transitions: analysis.transitions,
          analyzed_at: new Date()
        }),
        result.rows[0].id
      ]);
    }

    await client.query('COMMIT');

    logger.info('[Sequences] Added new sequence with analysis', {
      id: result.rows[0].id,
      symbol,
      windowSize: sequence.length
    });

    res.json({
      message: 'Sequence added successfully',
      sequence: {
        id: result.rows[0].id,
        symbol,
        created_at: result.rows[0].created_at
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('[Sequences] Error adding sequence:', error);
    res.status(500).json({ error: 'Failed to add sequence' });
  } finally {
    client.release();
  }
});

// Undo last symbol
router.delete('/undo', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
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
    
    await client.query('COMMIT');
    res.json({ 
      success: true,
      removed: lastSymbol.rows[0],
      remaining: verification.rows[0].count
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB] Error undoing last symbol:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Generate test data
router.post('/generate-test-data', async (req, res) => {
  const client = await db.getClient();
  try {
    const { seedType = 'lcg', seedValue = Date.now(), length = 90 } = req.body;
    
    logger.info('[DB] Generating test data', { seedType, seedValue, length });
    await client.query('BEGIN');
    
    // Initialize RNG generator
    const generator = new RNGGenerator(parseInt(seedValue));
    const sequence = generator.generateSequence(seedType, length);
    
    // Calculate entropy for the sequence
    const entropy = sequence.reduce((acc, curr, idx, arr) => {
      if (idx === 0) return acc;
      const p = arr.filter(x => x === curr).length / arr.length;
      return acc - (p * Math.log2(p));
    }, 0);
    
    // Insert sequence with metadata
    const insertPromises = sequence.map((symbol, index) => {
      return client.query(`
        INSERT INTO sequences (
          symbol, 
          entropy_value, 
          pattern_detected,
          batch_id,
          metadata
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          parseInt(symbol),
          entropy,
          false, // Will be updated by pattern detection
          generator.uuid(), // Assuming UUID for batch tracking
          JSON.stringify({
            seedType,
            seedValue,
            position: index,
            generatedAt: new Date()
          })
        ]
      );
    });
    
    await Promise.all(insertPromises);
    await client.query('COMMIT');
    
    logger.info('[DB] Test data generated successfully', {
      sequenceLength: sequence.length,
      entropy,
      firstFewSymbols: sequence.slice(0, 5)
    });
    
    res.json({ 
      message: 'Test data generated successfully',
      metadata: {
        seedType,
        seedValue,
        length: sequence.length,
        entropy
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('[DB] Error generating test data:', error);
    res.status(500).json({ error: 'Failed to generate test data' });
  } finally {
    client.release();
  }
});

// Analyze sequence and store predictions
router.post('/analyze', async (req, res) => {
  const client = await db.getClient();
  try {
    const { sequence, metadata = {} } = req.body;
    if (!Array.isArray(sequence)) {
      throw new Error('Sequence must be an array of numbers');
    }

    const analyzer = new PatternAnalyzer();
    const analysis = await analyzer.analyzeSequence(sequence);
    
    // Store analysis results
    await client.query('BEGIN');
    
    // Store in model_predictions
    const predictionResult = await client.query(`
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
        predictionResult.rows[0].id,
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
    
    await client.query('COMMIT');
    
    logger.info('[Analysis] Sequence analyzed successfully', {
      predictionId: predictionResult.rows[0].id,
      patternCount: analysis.patterns.length
    });
    
    res.json({
      message: 'Analysis complete',
      results: analysis,
      predictionId: predictionResult.rows[0].id
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('[Analysis] Error analyzing sequence:', error);
    res.status(500).json({ error: 'Failed to analyze sequence' });
  } finally {
    client.release();
  }
});

// Analyze sequences for RNG seed discovery
router.post('/discover-seed', async (req, res) => {
  const client = await db.getClient();
  try {
    const { windowSize = 100, minConfidence = 0.7 } = req.body;
    const analyzer = new PatternAnalyzer();

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
      throw new Error('Insufficient sequence data for analysis');
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
    await client.query('BEGIN');

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

    await client.query('COMMIT');

    logger.info('[Seed Discovery] Completed analysis', {
      candidatesFound: topCandidates.length,
      topConfidence: topCandidates[0]?.confidence
    });

    res.json({
      message: 'Seed discovery complete',
      candidates: topCandidates,
      analysis: {
        entropy: analysis.entropy,
        patternCount: analysis.patterns.length,
        windowSize
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('[Seed Discovery] Error:', error);
    res.status(500).json({ error: 'Failed to discover RNG seed' });
  } finally {
    client.release();
  }
});

// Reset database
router.post('/reset', async (req, res) => {
  const client = await db.getClient();
  try {
    console.log('[DB] Starting database reset');
    
    // Get count before reset
    const beforeCount = await client.query('SELECT COUNT(*) FROM sequences');
    console.log('[DB] Sequences before reset:', beforeCount.rows[0].count);
    
    await client.query('BEGIN');
    await client.query('TRUNCATE sequences');
    
    // Verify reset
    const afterCount = await client.query('SELECT COUNT(*) FROM sequences');
    console.log('[DB] Sequences after reset:', afterCount.rows[0].count);
    
    await client.query('COMMIT');
    res.json({ message: 'Database reset successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error resetting database:', error);
    res.status(500).json({ error: 'Failed to reset database' });
  } finally {
    client.release();
  }
});

module.exports = router;
