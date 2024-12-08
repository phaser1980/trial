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
    const sequences = await Sequence.findAll({
        order: [['created_at', 'DESC']],
        limit: 100,
        include: [{
            model: ModelPrediction,
            as: 'predictions'
        }]
    });

    const response = {
        sequences: sequences.map(seq => ({
            id: seq.id,
            symbol: seq.symbol,
            created_at: seq.created_at,
            entropy_value: seq.entropy_value,
            pattern_detected: seq.pattern_detected,
            model_predictions: seq.predictions?.map(pred => ({
                model: pred.model_name,
                prediction: pred.predicted_symbol,
                confidence: pred.confidence
            }))
        }))
    };

    res.json(response);
}));

// Add a single symbol
router.post('/', errorBoundary(async (req, res) => {
    const { symbol, batchId } = req.body;
    
    const sequence = await Sequence.create({
        symbol,
        session_id: batchId
    });

    res.json({ id: sequence.id });
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

// Reset all data
router.post('/reset', errorBoundary(async (req, res) => {
    await Sequence.destroy({ where: {} });
    await ModelPrediction.destroy({ where: {} });
    
    // Clear any active batch processors
    activeBatches.clear();

    res.json({ success: true });
}));

module.exports = router;
