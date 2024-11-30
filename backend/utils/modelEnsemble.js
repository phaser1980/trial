const tf = require('@tensorflow/tfjs');
const ErrorCorrection = require('./errorCorrection');

class ModelEnsemble {
    constructor() {
        this.models = new Map();
        this.weights = new Map();
        this.errorCorrection = new ErrorCorrection();
        this.minConfidence = 0.6;
        this.debugLog = [];
        this.performanceHistory = [];
        this.maxHistorySize = 1000;
        this.minModelPredictions = 2; // Require at least 2 models to make a prediction
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
        const predictions = new Map();
        this.debugLog = [];
        let validPredictions = 0;

        for (const [modelName, model] of this.models.entries()) {
            try {
                const result = await model.analyze(sequence);
                if (result && result.prediction && result.confidence > 0) {
                    validPredictions++;
                    const weight = this.weights.get(modelName);
                    predictions.set(modelName, {
                        symbol: result.prediction,
                        confidence: result.confidence,
                        weight: weight || 1.0,
                        debug: result.debug || {}
                    });
                    this.debugLog.push(
                        `${modelName}: ${result.prediction} (conf: ${result.confidence?.toFixed(3)}, weight: ${weight?.toFixed(3)})`
                    );
                } else {
                    this.debugLog.push(`${modelName}: No valid prediction`);
                }
            } catch (error) {
                console.error(`Error in ${modelName}:`, error);
                this.debugLog.push(`${modelName} error: ${error.message}`);
            }
        }

        // Check if we have enough valid predictions
        if (validPredictions < this.minModelPredictions) {
            this.debugLog.push(`Insufficient valid predictions: ${validPredictions} < ${this.minModelPredictions}`);
            return new Map();
        }

        return predictions;
    }

    // Combine predictions using weighted voting with confidence thresholds
    combineWeightedPredictions(predictions) {
        const votes = new Map();
        let totalWeight = 0;
        let maxConfidence = 0;

        // Collect weighted votes
        for (const [modelName, pred] of predictions.entries()) {
            if (pred.confidence < this.minConfidence) {
                this.debugLog.push(`Skipping ${modelName} due to low confidence: ${pred.confidence}`);
                continue;
            }

            const weight = pred.weight * pred.confidence;
            totalWeight += weight;
            maxConfidence = Math.max(maxConfidence, pred.confidence);

            if (!votes.has(pred.symbol)) {
                votes.set(pred.symbol, { weight: 0, models: [] });
            }
            const vote = votes.get(pred.symbol);
            vote.weight += weight;
            vote.models.push(modelName);
        }

        if (totalWeight === 0) {
            this.debugLog.push('No predictions met confidence threshold');
            return { symbol: null, confidence: 0 };
        }

        // Find symbol with highest weighted votes
        let bestSymbol = null;
        let maxVotes = 0;
        let consensusModels = [];

        for (const [symbol, vote] of votes.entries()) {
            if (vote.weight > maxVotes) {
                maxVotes = vote.weight;
                bestSymbol = symbol;
                consensusModels = vote.models;
            }
        }

        // Calculate ensemble confidence
        const voteRatio = maxVotes / totalWeight;
        const modelConsensus = consensusModels.length / predictions.size;
        const confidence = Math.min(0.95, voteRatio * modelConsensus * maxConfidence);
        
        this.debugLog.push(
            `Combined prediction: ${bestSymbol} (conf: ${confidence.toFixed(3)}, ` +
            `consensus: ${(modelConsensus * 100).toFixed(1)}%, models: ${consensusModels.join(', ')})`
        );
        
        return { symbol: bestSymbol, confidence };
    }

    // Make ensemble prediction
    async predict(sequence) {
        try {
            // Get predictions from all models
            const predictions = await this.getWeightedPredictions(sequence);
            
            // Skip if no valid predictions
            if (predictions.size === 0) {
                this.debugLog.push('No valid predictions from models');
                return null;
            }

            // Combine predictions
            let prediction = this.combineWeightedPredictions(predictions);
            
            // Apply error correction
            prediction = this.errorCorrection.correctPrediction(prediction, sequence);
            
            // Store prediction for performance tracking
            this.trackPrediction(prediction, sequence);

            return {
                ...prediction,
                modelPredictions: Object.fromEntries(predictions),
                debug: this.debugLog
            };

        } catch (error) {
            console.error('Ensemble prediction error:', error);
            this.debugLog.push(`Ensemble error: ${error.message}`);
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
