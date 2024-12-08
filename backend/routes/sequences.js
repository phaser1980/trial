const express = require('express');
const router = express.Router();
const { Sequence, ModelPrediction, SequenceAnalytics } = require('../models');
const logger = require('../utils/logger');
const { errorBoundary } = require('../middleware/errorBoundary');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');

// Reset database
router.delete('/reset', errorBoundary(async (req, res) => {
    try {
        await Sequence.sequelize.transaction(async (transaction) => {
            await Sequence.destroy({ where: {}, transaction });
            await ModelPrediction.destroy({ where: {}, transaction });
        });
        
        logger.info('[Sequences] Database reset successful');
        res.json({ message: 'Database reset successful' });
    } catch (error) {
        logger.error('[Sequences] Error resetting database:', error);
        res.status(500).json({ 
            error: 'Failed to reset database',
            details: error.message 
        });
    }
}));

// Add a single symbol
router.post('/', errorBoundary(async (req, res) => {
    try {
        const { symbol, batch_id } = req.body;
        
        // Validate symbol
        if (typeof symbol !== 'number' || ![0, 1, 2, 3].includes(symbol)) {
            return res.status(400).json({
                error: 'Invalid Input',
                message: 'Symbol must be a number between 0 and 3',
                receivedValue: symbol
            });
        }

        // Generate UUID for batch_id if not provided
        const currentBatchId = batch_id || uuidv4();

        // Create sequence
        const sequence = await Sequence.create({
            symbol,
            batch_id: currentBatchId,
            metadata: {},
            pattern_detected: false,
            pattern_strength: 0
        });

        logger.info(`[Sequences] Added symbol ${symbol} to batch ${currentBatchId}`);
        res.json({ 
            message: 'Symbol added successfully',
            sequence
        });
    } catch (error) {
        logger.error('[Sequences] Error adding symbol:', error);
        res.status(500).json({ 
            error: 'Failed to Add Symbol',
            message: 'An error occurred while adding the symbol',
            details: error.message
        });
    }
}));

// Get recent sequences
router.get('/recent', errorBoundary(async (req, res) => {
    try {
        const sequences = await Sequence.findAll({
            order: [['created_at', 'DESC']],
            limit: 10
        });
        
        logger.info('Fetched 10 recent sequences');
        res.json(sequences);
    } catch (error) {
        logger.error('Error fetching recent sequences:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: 'Failed to fetch recent sequences',
            details: error.message
        });
    }
}));

// Undo last symbol
router.delete('/undo', errorBoundary(async (req, res) => {
    try {
        const lastSequence = await Sequence.findOne({
            order: [['created_at', 'DESC']]
        });

        if (lastSequence) {
            await lastSequence.destroy();
            logger.info('Last sequence deleted successfully');
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('Error undoing last sequence:', error);
        res.status(500).json({
            error: 'Failed to Undo',
            message: 'Failed to undo last sequence',
            details: error.message
        });
    }
}));

// Generate test data
router.post('/generate', errorBoundary(async (req, res) => {
    try {
        const { algorithm, seed, count } = req.body;
        
        // Validate input
        if (!algorithm || typeof seed !== 'number' || typeof count !== 'number') {
            return res.status(400).json({
                error: 'Invalid Input',
                message: 'Missing or invalid parameters',
                required: { algorithm: 'string', seed: 'number', count: 'number' }
            });
        }

        // Generate symbols
        const symbols = [];
        for (let i = 0; i < count; i++) {
            const symbol = Math.floor(Math.random() * 4);  // 0-3
            symbols.push(symbol);
        }

        // Create sequences
        const sequences = await Promise.all(
            symbols.map(symbol => 
                Sequence.create({
                    symbol,
                    metadata: { algorithm, seed },
                    pattern_detected: false,
                    pattern_strength: 0
                })
            )
        );

        logger.info(`[Sequences] Generated ${count} test sequences with ${algorithm}`);
        res.json({ 
            message: 'Test data generated successfully',
            count: sequences.length
        });
    } catch (error) {
        logger.error('[Sequences] Error generating test data:', error);
        res.status(500).json({ 
            error: 'Failed to Generate',
            message: 'Failed to generate test data',
            details: error.message
        });
    }
}));

// Get analytics data
router.get('/analytics', errorBoundary(async (req, res) => {
    try {
        // Get overall statistics
        const totalSequences = await Sequence.count();
        const uniqueBatches = await Sequence.count({
            distinct: true,
            col: 'batch_id'
        });

        // Get pattern detection stats
        const patternStats = await Sequence.findAll({
            attributes: [
                'pattern_detected',
                [Sequence.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['pattern_detected']
        });

        // Get recent batch performance
        const recentBatchStats = await Sequence.findAll({
            attributes: [
                'batch_id',
                [Sequence.sequelize.fn('COUNT', '*'), 'sequence_count'],
                [Sequence.sequelize.fn('AVG', Sequence.sequelize.col('pattern_strength')), 'avg_pattern_strength']
            ],
            where: {
                created_at: {
                    [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                }
            },
            group: ['batch_id'],
            order: [[Sequence.sequelize.col('created_at'), 'DESC']],
            limit: 5
        });

        const analytics = {
            totalSequences,
            uniqueBatches,
            patternStats: patternStats.reduce((acc, curr) => {
                acc[curr.pattern_detected ? 'detected' : 'not_detected'] = parseInt(curr.get('count'));
                return acc;
            }, { detected: 0, not_detected: 0 }),
            recentBatchStats
        };

        res.json(analytics);
    } catch (error) {
        logger.error('[Sequences] Error fetching analytics:', error);
        res.status(500).json({
            error: 'Failed to fetch analytics',
            details: error.message
        });
    }
}));

// Get batch status
router.get('/batch-status', errorBoundary(async (req, res) => {
    try {
        const { batchId } = req.query;

        if (!batchId) {
            return res.status(400).json({
                error: 'Missing batch ID',
                message: 'Batch ID is required'
            });
        }

        const batchSequences = await Sequence.findAll({
            where: { batch_id: batchId },
            include: [{
                model: ModelPrediction,
                as: 'predictions'
            }]
        });

        const total = batchSequences.length;
        const processed = batchSequences.filter(seq => seq.predictions && seq.predictions.length > 0).length;
        const status = processed === total ? 'complete' : 'processing';

        res.json({
            status,
            current: processed,
            total,
            progress: total > 0 ? (processed / total) * 100 : 0,
            batch_id: batchId
        });
    } catch (error) {
        logger.error('[Sequences] Error fetching batch status:', error);
        res.status(500).json({
            error: 'Failed to fetch batch status',
            details: error.message
        });
    }
}));

module.exports = router;
