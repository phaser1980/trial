const BatchProcessor = require('./batchProcessor');
const ModelEnsemble = require('./modelEnsemble');
const logger = require('./logger');
const { Sequence, ModelPrediction } = require('../models');
const cache = require('./cache');
const { v4: uuidv4 } = require('uuid');
const { validateSequence, validateModelPrediction, validatePredictionData, VALID_SYMBOLS } = require('./validation');

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
    this.currentBatchId = options.batch_id || uuidv4();
    this.totalBatches = 0;
    this.batchSize = options.batchSize || 5;
  }

  async processBatchItems(sequences) {
    try {
      if (!global.modelEnsemble) {
        console.error('[BatchProcessor] ModelEnsemble not initialized');
        return;
      }

      // Update sequences with current batch ID if not set
      for (const sequence of sequences) {
        if (!sequence.batch_id) {
          await sequence.update({ batch_id: this.currentBatchId });
        }

        try {
          // Get predictions for this sequence
          const prediction = await global.modelEnsemble.predict(sequence);
          
          if (!prediction) {
            console.log(`[BatchProcessor] No valid prediction for sequence ${sequence.id}`);
            continue;
          }

          // Store prediction
          await ModelPrediction.create({
            sequence_id: sequence.id,
            predicted_symbol: prediction.symbol,
            confidence: prediction.confidence,
            metadata: {
              modelCount: prediction.modelCount,
              predictions: prediction.debug?.predictions || [],
              batch_id: sequence.batch_id
            }
          });

          logger.info(`[BatchProcessor] Stored prediction for sequence ${sequence.id}: ${prediction.symbol} (${prediction.confidence}) in batch ${sequence.batch_id}`);
        } catch (error) {
          logger.error(`[BatchProcessor] Error processing sequence ${sequence.id}:`, error);
        }
      }
    } catch (error) {
      logger.error('[BatchProcessor] Error in batch processing:', error);
      throw error;
    }
  }

  async processBatchItemsNew(sequences) {
    try {
      if (!this.modelEnsemble) {
        console.error('[BatchProcessor] ModelEnsemble not initialized');
        return;
      }

      for (const sequence of sequences) {
        try {
          // Get predictions for this sequence
          const prediction = await this.modelEnsemble.predict(sequence);
          
          if (!prediction) {
            console.log(`[BatchProcessor] No valid prediction for sequence ${sequence.id}`);
            continue;
          }

          // Store prediction
          await ModelPrediction.create({
            sequence_id: sequence.id,
            predicted_symbol: prediction.symbol,
            confidence: prediction.confidence,
            metadata: {
              modelCount: prediction.modelCount,
              predictions: prediction.debug?.predictions || []
            }
          });

          console.log(`[BatchProcessor] Stored prediction for sequence ${sequence.id}: ${prediction.symbol} (${prediction.confidence})`);
        } catch (error) {
          console.error(`[BatchProcessor] Error processing sequence ${sequence.id}:`, error);
        }
      }
    } catch (error) {
      console.error('[BatchProcessor] Error in batch processing:', error);
      throw error;
    }
  }

  getDebugLog() {
    return this.debugLog;
  }
}

module.exports = SequenceBatchProcessor;
