const express = require('express');
const router = express.Router();
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { errorBoundary } = require('../middleware/errorBoundary');
const Redis = require('ioredis');
const logger = require('../utils/logger');

// Initialize Redis client
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const CACHE_TTL = 300; // 5 minutes

// Get transition matrix for a specific batch
router.get('/transitions/:batchId', errorBoundary(async (req, res) => {
    const { batchId } = req.params;
    
    // Try to get from cache first
    const cacheKey = `transitions:${batchId}`;
    const cachedResult = await redis.get(cacheKey);
    
    if (cachedResult) {
        logger.debug('Returning cached transition matrix', { batchId });
        return res.json(JSON.parse(cachedResult));
    }

    // Calculate fresh results
    const [result] = await sequelize.query(
        'SELECT analyze_transition_patterns(:batchId) as analysis',
        {
            replacements: { batchId },
            type: QueryTypes.SELECT
        }
    );

    if (!result) {
        throw new Error('No data found for batch');
    }

    // Cache the result
    await redis.set(cacheKey, JSON.stringify(result.analysis), 'EX', CACHE_TTL);
    
    res.json(result.analysis);
}));

// Get enhanced analytics for all batches
router.get('/enhanced', errorBoundary(async (req, res) => {
    const cacheKey = 'enhanced_analytics';
    const cachedResult = await redis.get(cacheKey);
    
    if (cachedResult) {
        logger.debug('Returning cached enhanced analytics');
        return res.json(JSON.parse(cachedResult));
    }

    const results = await sequelize.query(
        'SELECT * FROM mv_enhanced_sequence_analytics ORDER BY calculated_at DESC LIMIT 100',
        { type: QueryTypes.SELECT }
    );

    // Cache the results
    await redis.set(cacheKey, JSON.stringify(results), 'EX', CACHE_TTL);
    
    res.json(results);
}));

// Get pattern strength timeline
router.get('/pattern-strength', errorBoundary(async (req, res) => {
    const results = await sequelize.query(`
        WITH timeline AS (
            SELECT 
                date_trunc('hour', calculated_at) as time_bucket,
                AVG((pattern_analysis->'pattern_strength')::text::float) as avg_pattern_strength,
                COUNT(DISTINCT batch_id) as batch_count
            FROM mv_enhanced_sequence_analytics
            WHERE calculated_at >= NOW() - INTERVAL '24 hours'
            GROUP BY date_trunc('hour', calculated_at)
            ORDER BY time_bucket DESC
        )
        SELECT 
            time_bucket,
            avg_pattern_strength,
            batch_count
        FROM timeline
    `, { type: QueryTypes.SELECT });
    
    res.json(results);
}));

// Compare sequences with different seeds
router.post('/compare-seeds', errorBoundary(async (req, res) => {
    const { batchId, testSeeds, algorithm = 'LCG' } = req.body;
    
    if (!Array.isArray(testSeeds)) {
        throw new Error('testSeeds must be an array');
    }

    // Compare each seed
    const comparisons = await Promise.all(
        testSeeds.map(async (seed) => {
            const [result] = await sequelize.query(
                'SELECT compare_seed_sequences(:batchId, :seed, :length, :algorithm) as comparison',
                {
                    replacements: {
                        batchId,
                        seed,
                        length: 100,
                        algorithm
                    },
                    type: QueryTypes.SELECT
                }
            );
            return result.comparison;
        })
    );

    res.json({
        batchId,
        comparisons,
        bestMatch: comparisons.reduce((best, current) => 
            (current.confidence_score > best.confidence_score) ? current : best
        )
    });
}));

// Run Monte Carlo simulation for seed discovery
router.post('/monte-carlo', errorBoundary(async (req, res) => {
    const { batchId, numSimulations = 1000, algorithm = 'LCG' } = req.body;
    
    // Use Redis to track long-running simulations
    const simulationKey = `simulation:${batchId}`;
    const running = await redis.get(simulationKey);
    
    if (running) {
        return res.json({
            status: 'running',
            message: 'Simulation already in progress'
        });
    }

    // Set simulation status
    await redis.set(simulationKey, 'running', 'EX', 300); // 5-minute timeout

    try {
        const [result] = await sequelize.query(
            'SELECT monte_carlo_seed_search(:batchId, :numSimulations, :algorithm) as simulation',
            {
                replacements: { batchId, numSimulations, algorithm },
                type: QueryTypes.SELECT
            }
        );

        // Cache results for 5 minutes
        await redis.set(
            `simulation_result:${batchId}`,
            JSON.stringify(result.simulation),
            'EX',
            300
        );

        res.json(result.simulation);
    } finally {
        // Clear simulation status
        await redis.del(simulationKey);
    }
}));

// Get Monte Carlo simulation results
router.get('/monte-carlo/:batchId', errorBoundary(async (req, res) => {
    const { batchId } = req.params;
    
    // Check if simulation is running
    const running = await redis.get(`simulation:${batchId}`);
    if (running) {
        return res.json({
            status: 'running',
            message: 'Simulation in progress'
        });
    }

    // Get cached results
    const cached = await redis.get(`simulation_result:${batchId}`);
    if (cached) {
        return res.json(JSON.parse(cached));
    }

    res.json({
        status: 'not_found',
        message: 'No simulation results found'
    });
}));

// Get real-time pattern strength timeline
router.get('/pattern-strength/:batchId', errorBoundary(async (req, res) => {
    const { batchId } = req.params;
    const { window = '1 hour' } = req.query;

    const results = await sequelize.query(`
        WITH timeline AS (
            SELECT 
                date_trunc('minute', sp.created_at) as time_bucket,
                (analyze_transition_patterns(:batchId)->>'pattern_strength')::float as strength,
                COUNT(*) as sample_size
            FROM sequences_partitioned sp
            WHERE sp.batch_id = :batchId
                AND sp.created_at >= NOW() - :window::interval
            GROUP BY date_trunc('minute', sp.created_at)
            ORDER BY time_bucket DESC
        )
        SELECT 
            time_bucket,
            strength as pattern_strength,
            sample_size,
            AVG(strength) OVER (
                ORDER BY time_bucket
                ROWS BETWEEN 5 PRECEDING AND CURRENT ROW
            ) as moving_average
        FROM timeline
    `, {
        replacements: { batchId, window },
        type: QueryTypes.SELECT
    });

    res.json(results);
}));

module.exports = router;
