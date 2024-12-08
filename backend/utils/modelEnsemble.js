const tf = require('@tensorflow/tfjs');
const ErrorCorrection = require('./errorCorrection');
const modelRegistry = require('./modelRegistry');

class ModelEnsemble {
    constructor() {
        this.models = new Map();
        this.weights = new Map();
        this.errorCorrection = new ErrorCorrection();
        this.minConfidence = 0.3;  // Lowered from 0.6
        this.debugLog = [];
        this.performanceHistory = [];
        this.maxHistorySize = 1000;
        this.minModelPredictions = 1;  // Lowered from 2
        
        // Initialize models from registry
        this.initializeModels();
    }

    initializeModels() {
        const registeredModels = modelRegistry.getAllModels();
        for (const model of registeredModels) {
            this.addModel(model.name, model);
        }
        console.log(`[ModelEnsemble] Initialized ${registeredModels.length} models:`, 
            registeredModels.map(m => m.name).join(', '));
    }

    // Add a model to the ensemble
    addModel(modelName, model, initialWeight = 1.0) {
        this.models.set(modelName, model);
        this.weights.set(modelName, initialWeight);
        this.debugLog.push(`Added model: ${modelName} with weight ${initialWeight}`);
    }

    // Update model weights using Q-learning approach
    updateWeights(modelName, wasCorrect, confidence) {
        const currentWeight = this.weights.get(modelName) || 1.0;
        const learningRate = 0.1;
        const reward = wasCorrect ? confidence : -confidence;
        
        // Q-learning update rule with momentum
        const momentum = 0.9;
        const targetWeight = currentWeight + learningRate * reward;
        const newWeight = (momentum * currentWeight + (1 - momentum) * targetWeight);
        
        // Ensure weight stays within reasonable bounds
        const boundedWeight = Math.max(0.1, Math.min(2.0, newWeight));
        this.weights.set(modelName, boundedWeight);
        
        this.debugLog.push(
            `Updated ${modelName} weight: ${currentWeight.toFixed(3)} -> ${boundedWeight.toFixed(3)}`
        );
    }

    // Get weighted predictions from all models with enhanced error handling
    async getWeightedPredictions(sequence) {
        this.debugLog = [];
        const predictions = new Map();
        let validPredictions = 0;
        let totalModels = this.models.size;

        console.log(`[ModelEnsemble] Getting predictions for sequence of length ${sequence.length}`);
        console.log(`[ModelEnsemble] Active models: ${Array.from(this.models.keys()).join(', ')}`);

        for (const [modelName, model] of this.models.entries()) {
            try {
                console.log(`[ModelEnsemble] Requesting prediction from ${modelName}`);
                const result = await model.analyze(sequence);
                
                if (!result) {
                    console.log(`[ModelEnsemble] ${modelName} returned null result`);
                    continue;
                }

                console.log(`[ModelEnsemble] ${modelName} prediction:`, {
                    prediction: result.prediction,
                    confidence: result.confidence,
                    debug: result.debug
                });

                if (result && result.prediction && result.confidence > 0) {
                    validPredictions++;
                    const weight = this.weights.get(modelName) || 1.0;
                    predictions.set(modelName, {
                        symbol: result.prediction,
                        confidence: result.confidence,
                        weight: weight,
                        debug: result.debug || {}
                    });
                    this.debugLog.push(
                        `${modelName}: ${result.prediction} (conf: ${result.confidence?.toFixed(3)}, weight: ${weight?.toFixed(3)})`
                    );
                } else {
                    console.log(`[ModelEnsemble] Invalid prediction from ${modelName}:`, result);
                    this.debugLog.push(`${modelName}: No valid prediction`);
                }
            } catch (error) {
                console.error(`[ModelEnsemble] Error in ${modelName}:`, error);
                this.debugLog.push(`${modelName} error: ${error.message}`);
            }
        }

        console.log(`[ModelEnsemble] Prediction summary:`, {
            totalModels,
            validPredictions,
            minRequired: this.minModelPredictions
        });

        // Check if we have enough valid predictions
        if (validPredictions < this.minModelPredictions) {
            console.log(`[ModelEnsemble] Insufficient valid predictions: ${validPredictions} < ${this.minModelPredictions}`);
            this.debugLog.push(`Insufficient valid predictions: ${validPredictions} < ${this.minModelPredictions}`);
            return new Map();
        }

        return predictions;
    }

    // Combine weighted predictions with enhanced logging
    combineWeightedPredictions(predictions) {
        console.log(`[ModelEnsemble] Combining ${predictions.size} predictions`);
        
        const combinedPredictions = new Map();
        let totalWeight = 0;

        // First pass: calculate weights and collect predictions
        for (const [modelName, pred] of predictions.entries()) {
            const weight = pred.weight * pred.confidence;
            totalWeight += weight;

            console.log(`[ModelEnsemble] Processing ${modelName}:`, {
                symbol: pred.symbol,
                confidence: pred.confidence,
                weight: pred.weight,
                effectiveWeight: weight
            });

            if (!combinedPredictions.has(pred.symbol)) {
                combinedPredictions.set(pred.symbol, 0);
            }
            combinedPredictions.set(
                pred.symbol,
                combinedPredictions.get(pred.symbol) + weight
            );
        }

        // Second pass: find best prediction
        let bestPrediction = null;
        let maxWeight = 0;
        let confidence = 0;

        console.log(`[ModelEnsemble] Total weight: ${totalWeight}`);
        
        combinedPredictions.forEach((weight, symbol) => {
            const normalizedWeight = totalWeight > 0 ? weight / totalWeight : 0;
            console.log(`[ModelEnsemble] Symbol ${symbol}:`, {
                rawWeight: weight,
                normalizedWeight
            });

            if (normalizedWeight > maxWeight) {
                maxWeight = normalizedWeight;
                bestPrediction = symbol;
                confidence = Math.min(0.95, normalizedWeight);
            }
        });

        console.log(`[ModelEnsemble] Final prediction:`, {
            symbol: bestPrediction,
            confidence,
            totalPredictions: predictions.size
        });

        return {
            symbol: bestPrediction,
            confidence: confidence
        };
    }

    // Make ensemble prediction
    async predict(sequence) {
        if (!Array.isArray(sequence)) {
            console.error('[ModelEnsemble] Invalid sequence format');
            return null;
        }

        // Validate sequence values
        if (!sequence.every(val => [0, 1, 2, 3].includes(val))) {
            console.error('[ModelEnsemble] Invalid values in sequence');
            return null;
        }

        try {
            const predictions = await this.getWeightedPredictions(sequence);
            if (predictions.size === 0) {
                console.log('[ModelEnsemble] No valid predictions received');
                return null;
            }

            const result = this.combineWeightedPredictions(predictions);
            if (!result || result.confidence < this.minConfidence) {
                console.log(`[ModelEnsemble] Prediction confidence too low: ${result?.confidence}`);
                return null;
            }

            // Track this prediction for performance analysis
            this.trackPrediction(result, sequence);

            return {
                symbol: result.symbol,
                confidence: result.confidence,
                modelCount: predictions.size,
                debug: {
                    predictions: Array.from(predictions.entries()).map(([model, pred]) => ({
                        model,
                        symbol: pred.symbol,
                        confidence: pred.confidence,
                        weight: pred.weight
                    }))
                }
            };
        } catch (error) {
            console.error('[ModelEnsemble] Error during prediction:', error);
            return null;
        }
    }

    // Track prediction for performance analysis
    trackPrediction(prediction, sequence) {
        this.performanceHistory.push({
            timestamp: Date.now(),
            prediction: prediction.symbol,
            confidence: prediction.confidence,
            context: sequence.slice(-5)
        });

        // Maintain history size
        if (this.performanceHistory.length > this.maxHistorySize) {
            this.performanceHistory.shift();
        }
    }

    // Update ensemble with actual outcome
    updatePerformance(actualSymbol) {
        if (this.performanceHistory.length === 0) return;

        const lastPrediction = this.performanceHistory[this.performanceHistory.length - 1];
        const wasCorrect = lastPrediction.prediction === actualSymbol;

        // Update error correction
        this.errorCorrection.addError(
            actualSymbol,
            lastPrediction.prediction,
            lastPrediction.context,
            lastPrediction.confidence
        );

        // Update model weights
        for (const [modelName, prediction] of this.models.entries()) {
            if (prediction && prediction.symbol) {
                this.updateWeights(
                    modelName,
                    prediction.symbol === actualSymbol,
                    prediction.confidence
                );
            }
        }
    }

    // Get ensemble performance statistics
    getStatistics() {
        const stats = {
            totalPredictions: this.performanceHistory.length,
            modelWeights: Object.fromEntries(this.weights),
            errorStats: this.errorCorrection.getStatistics(),
            debug: this.debugLog
        };

        // Calculate recent accuracy
        const recentPredictions = this.performanceHistory.slice(-100);
        if (recentPredictions.length > 0) {
            const correct = recentPredictions.filter(p => 
                p.prediction === p.actual
            ).length;
            stats.recentAccuracy = correct / recentPredictions.length;
        }

        return stats;
    }
}

module.exports = ModelEnsemble;
