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
    }

    // Add a model to the ensemble
    addModel(modelName, model, initialWeight = 1.0) {
        this.models.set(modelName, model);
        this.weights.set(modelName, initialWeight);
        this.debugLog.push(`Added model: ${modelName} with weight ${initialWeight}`);
    }

    // Update model weights based on performance
    updateWeights(modelName, wasCorrect, confidence) {
        const currentWeight = this.weights.get(modelName) || 1.0;
        const learningRate = 0.1;
        
        // Adjust weight based on prediction accuracy and confidence
        const adjustment = wasCorrect ? 
            learningRate * confidence : 
            -learningRate * confidence;
        
        const newWeight = Math.max(0.1, Math.min(2.0, currentWeight + adjustment));
        this.weights.set(modelName, newWeight);
        
        this.debugLog.push(
            `Updated ${modelName} weight: ${currentWeight.toFixed(3)} -> ${newWeight.toFixed(3)}`
        );
    }

    // Get weighted predictions from all models
    async getWeightedPredictions(sequence) {
        const predictions = new Map();
        this.debugLog = [];

        for (const [modelName, model] of this.models.entries()) {
            try {
                const prediction = await model.analyze(sequence);
                if (prediction && prediction.prediction) {
                    const weight = this.weights.get(modelName);
                    predictions.set(modelName, {
                        symbol: prediction.prediction,
                        confidence: prediction.confidence,
                        weight
                    });
                    this.debugLog.push(
                        `${modelName}: ${prediction.prediction} (conf: ${prediction.confidence.toFixed(3)}, weight: ${weight.toFixed(3)})`
                    );
                }
            } catch (error) {
                console.error(`Error in ${modelName}:`, error);
                this.debugLog.push(`${modelName} error: ${error.message}`);
            }
        }

        return predictions;
    }

    // Combine predictions using weighted voting
    combineWeightedPredictions(predictions) {
        const votes = new Map();
        let totalWeight = 0;

        // Collect weighted votes
        for (const [modelName, pred] of predictions.entries()) {
            const weight = this.weights.get(modelName) * pred.confidence;
            totalWeight += weight;

            if (!votes.has(pred.symbol)) {
                votes.set(pred.symbol, 0);
            }
            votes.set(pred.symbol, votes.get(pred.symbol) + weight);
        }

        // Find symbol with highest weighted votes
        let bestSymbol = null;
        let maxVotes = 0;
        for (const [symbol, voteCount] of votes.entries()) {
            if (voteCount > maxVotes) {
                maxVotes = voteCount;
                bestSymbol = symbol;
            }
        }

        // Calculate confidence based on vote distribution
        const confidence = totalWeight > 0 ? maxVotes / totalWeight : 0;

        this.debugLog.push(`Combined prediction: ${bestSymbol} (conf: ${confidence.toFixed(3)})`);
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
