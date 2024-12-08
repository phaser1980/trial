const BatchProcessor = require('./batchProcessor');
const ModelEnsemble = require('./modelEnsemble');
const logger = require('./logger');
const { Sequence, ModelPrediction } = require('../models');

class SequenceBatchProcessor extends BatchProcessor {
    constructor(options = {}) {
        super({
            batchSize: options.batchSize || 5,
            delayBetweenBatches: options.delayBetweenBatches || 2000,
            debugMode: options.debugMode || false
        });
        
        this.modelEnsemble = new ModelEnsemble();
        this.sessionId = options.sessionId;
        this.debugLog = [];
    }

    async processBatchItems(batch) {
        logger.debug(`Processing sequence batch of ${batch.length} items`);
        this.debugLog = [];

        for (const symbol of batch) {
            try {
                // Store sequence in database
                const sequence = await Sequence.create({
                    symbol,
                    batch_id: this.sessionId, // Use sessionId as batch_id
                    is_test_data: true
                });

                // Get recent sequences for context
                const recentSequences = await Sequence.findAll({
                    where: { batch_id: this.sessionId }, // Update where clause to use batch_id
                    order: [['created_at', 'DESC']],
                    limit: 50,
                    raw: true
                });

                // Get model predictions
                const predictions = await this.modelEnsemble.getWeightedPredictions(
                    recentSequences.map(s => s.symbol)
                );

                // Store predictions
                for (const [modelName, prediction] of predictions.entries()) {
                    await ModelPrediction.create({
                        sequence_id: sequence.id,
                        model_type: 'ensemble',
                        model_name: modelName,
                        prediction_data: {
                            predicted_symbol: prediction.symbol,
                            details: prediction.details || {}
                        },
                        confidence_score: prediction.confidence,
                        metadata: {
                            is_test_data: true,
                            batch_id: this.sessionId
                        }
                    });
                }

                this.debugLog.push({
                    symbol,
                    predictions: Array.from(predictions.entries()).map(([model, pred]) => ({
                        model,
                        prediction: pred.symbol,
                        confidence: pred.confidence
                    }))
                });

            } catch (error) {
                logger.error('Error processing sequence:', error);
                this.debugLog.push({
                    symbol,
                    error: error.message
                });
            }
        }

        return this.debugLog;
    }

    getDebugLog() {
        return this.debugLog;
    }
}

module.exports = SequenceBatchProcessor;
