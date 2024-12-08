const express = require('express');
const router = express.Router();
const { Sequence, ModelPrediction } = require('../models');
const logger = require('../utils/logger');
const { errorBoundary } = require('../middleware/errorBoundary');
const SequenceBatchProcessor = require('../utils/sequenceBatchProcessor');
const { v4: uuidv4 } = require('uuid');

// Store active batch processors
const activeBatches = new Map();

// Generate test data with batched processing
router.post('/generate', errorBoundary(async (req, res) => {
    const { batchId, algorithm, seed, count, batchSize = 5, delayMs = 2000 } = req.body;
    
    // Create new batch processor
    const processor = new SequenceBatchProcessor({
        batchSize,
        delayBetweenBatches: delayMs,
        sessionId: batchId,
        debugMode: true
    });

    // Store processor for status checks
    activeBatches.set(batchId, processor);

    // Generate symbols
    const symbols = Array.from({ length: count }, () => Math.floor(Math.random() * 4));

    // Start processing in background
    processor.addItems(symbols);

    // Return immediately with batch ID
    res.json({ 
        batchId,
        message: 'Test data generation started',
        total: count
    });
}));

// Get batch processing status
router.get('/batch-status', errorBoundary(async (req, res) => {
    const { batchId } = req.query;
    const processor = activeBatches.get(batchId);

    if (!processor) {
        return res.json({
            status: 'complete',
            processed: 0,
            total: 0,
            remaining: 0
        });
    }

    const status = {
        status: processor.isProcessing ? 'processing' : 'complete',
        processed: processor.processed,
        total: processor.queueLength + processor.processed,
        remaining: processor.queueLength
    };

    // Clean up completed processors
    if (!processor.isProcessing && processor.queueLength === 0) {
        activeBatches.delete(batchId);
    }

    res.json(status);
}));

// Get recent sequences with model predictions
router.get('/recent', errorBoundary(async (req, res) => {
    try {
        const sequences = await Sequence.findAll({
            order: [['created_at', 'DESC']],
            limit: 100,
            include: [{
                model: ModelPrediction,
                as: 'predictions',
                required: false,
                attributes: [
                    'id',
                    'model_type',
                    'prediction_data',
                    'confidence_score',
                    'model_name'
                ]
            }]
        });

        const response = {
            sequences: sequences.map(seq => ({
                id: seq.id,
                symbol: seq.symbol,
                created_at: seq.created_at,
                entropy_value: seq.entropy_value || 0,
                pattern_detected: seq.pattern_detected || false,
                model_predictions: (seq.predictions || []).map(pred => ({
                    model: pred.model_name,
                    prediction: pred.prediction_data?.predicted_symbol || 0,
                    confidence: pred.confidence_score || 0,
                    model_type: pred.model_type
                }))
            }))
        };

        res.json(response);
    } catch (error) {
        logger.error('Error fetching sequences:', error);
        res.status(500).json({ error: 'Failed to fetch sequences' });
    }
}));

// Get sequence analytics
router.get('/analytics', errorBoundary(async (req, res) => {
    try {
        const sequences = await Sequence.findAll({
            order: [['created_at', 'DESC']],
            limit: 1000,
            include: [{
                model: ModelPrediction,
                as: 'predictions',
                required: false,
                attributes: ['model_type', 'model_name', 'prediction_data', 'confidence_score']
            }]
        });

        // Calculate analytics
        const analytics = {
            total_sequences: sequences.length,
            pattern_detection: {
                patterns_detected: sequences.filter(s => s.pattern_detected).length,
                average_strength: sequences.reduce((acc, s) => acc + (s.pattern_strength || 0), 0) / sequences.length
            },
            model_performance: {},
            recent_accuracy: 0
        };

        // Calculate model performance
        sequences.forEach(seq => {
            if (seq.predictions) {
                seq.predictions.forEach(pred => {
                    const modelName = pred.model_name;
                    if (!analytics.model_performance[modelName]) {
                        analytics.model_performance[modelName] = {
                            total_predictions: 0,
                            average_confidence: 0
                        };
                    }
                    
                    analytics.model_performance[modelName].total_predictions++;
                    analytics.model_performance[modelName].average_confidence += pred.confidence_score || 0;
                });
            }
        });

        // Calculate averages
        Object.values(analytics.model_performance).forEach(perf => {
            perf.average_confidence = perf.average_confidence / perf.total_predictions;
        });

        res.json(analytics);
    } catch (error) {
        logger.error('Error fetching analytics:', error);
        res.status(500).json({ 
            error: 'Failed to fetch analytics',
            details: error.message 
        });
    }
}));

// Add a single symbol
router.post('/', errorBoundary(async (req, res) => {
    try {
        const { symbol, batchId } = req.body;
        
        if (typeof symbol !== 'number' || symbol < 0 || symbol > 3) {
            return res.status(400).json({ 
                error: 'Invalid symbol. Must be a number between 0 and 3.' 
            });
        }

        if (!batchId) {
            return res.status(400).json({ 
                error: 'batchId is required' 
            });
        }

        const sequence = await Sequence.create({
            symbol,
            batch_id: batchId,
            metadata: { is_manual: true }
        });

        res.json({ id: sequence.id });
    } catch (error) {
        logger.error('Error creating sequence:', error);
        res.status(500).json({ 
            error: 'Failed to create sequence',
            details: error.message 
        });
    }
}));

// Undo last symbol
router.delete('/undo', errorBoundary(async (req, res) => {
    const lastSequence = await Sequence.findOne({
        order: [['created_at', 'DESC']]
    });

    if (lastSequence) {
        await lastSequence.destroy();
    }

    res.json({ success: true });
}));

// Reset database (for testing)
router.post('/reset', errorBoundary(async (req, res) => {
    try {
        // Delete all sequences (this will cascade to model_predictions due to foreign key constraint)
        await Sequence.destroy({
            where: {},
            force: true
        });

        res.json({ message: 'Database reset successfully' });
    } catch (error) {
        logger.error('Error resetting database:', error);
        res.status(500).json({ 
            error: 'Failed to reset database',
            details: error.message 
        });
    }
}));

module.exports = router;
