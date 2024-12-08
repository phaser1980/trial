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
                    session_id: this.sessionId,
                    is_test_data: true
                });

                // Get recent sequences for context
                const recentSequences = await Sequence.findAll({
                    where: { session_id: this.sessionId },
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
                        model_name: modelName,
                        predicted_symbol: prediction.symbol,
                        confidence: prediction.confidence,
                        debug_info: prediction.debug
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
