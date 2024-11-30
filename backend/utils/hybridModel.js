const tf = require('@tensorflow/tfjs');

class ErrorCorrection {
    constructor() {
        this.errorHistory = new Map();
        this.transitionErrors = new Map();
        this.windowSize = 50;
        this.correctionThreshold = 0.6;
    }

    // Track prediction errors
    recordError(modelName, context, prediction, actual) {
        if (!this.errorHistory.has(modelName)) {
            this.errorHistory.set(modelName, new Map());
        }
        
        const modelErrors = this.errorHistory.get(modelName);
        const key = `${context}_${prediction}`;
        
        if (!modelErrors.has(key)) {
            modelErrors.set(key, { total: 0, errors: 0, corrections: new Map() });
        }
        
        const stats = modelErrors.get(key);
        stats.total++;
        
        if (prediction !== actual) {
            stats.errors++;
            const correctKey = `${context}_${actual}`;
            stats.corrections.set(actual, (stats.corrections.get(actual) || 0) + 1);
        }
    }

    // Get error correction for a prediction
    getCorrection(modelName, context, prediction, confidence) {
        if (!this.errorHistory.has(modelName)) return { prediction, confidence };
        
        const modelErrors = this.errorHistory.get(modelName);
        const key = `${context}_${prediction}`;
        const stats = modelErrors.get(key);
        
        if (!stats || stats.total < 10) return { prediction, confidence };
        
        const errorRate = stats.errors / stats.total;
        if (errorRate > this.correctionThreshold) {
            // Find most common correct symbol
            let bestCorrection = prediction;
            let maxCount = 0;
            
            stats.corrections.forEach((count, symbol) => {
                if (count > maxCount) {
                    maxCount = count;
                    bestCorrection = symbol;
                }
            });
            
            // Adjust confidence based on correction reliability
            const correctionConfidence = maxCount / stats.errors;
            const adjustedConfidence = confidence * (1 - errorRate) * correctionConfidence;
            
            return {
                prediction: bestCorrection,
                confidence: Math.min(0.95, adjustedConfidence)
            };
        }
        
        return { prediction, confidence };
    }
}

class HybridModel {
    constructor() {
        this.models = new Map();
        this.weights = new Map();
        this.errorCorrection = new ErrorCorrection();
        this.recentPerformance = new Map();
        this.decayFactor = 0.95;
    }

    // Add a model to the ensemble
    addModel(name, model) {
        this.models.set(name, model);
        this.weights.set(name, 1.0);
        this.recentPerformance.set(name, []);
    }

    // Update model weights based on performance
    updateWeights(modelName, correct, confidence) {
        const performance = this.recentPerformance.get(modelName);
        performance.push({ correct, confidence });
        
        // Keep only recent performance
        if (performance.length > 50) {
            performance.shift();
        }
        
        // Calculate new weight
        const recentAccuracy = performance.reduce((acc, p) => 
            acc + (p.correct ? p.confidence : -p.confidence), 0) / performance.length;
        
        // Update weight with decay
        const currentWeight = this.weights.get(modelName);
        const newWeight = (currentWeight * this.decayFactor) + 
            (recentAccuracy * (1 - this.decayFactor));
        
        this.weights.set(modelName, Math.max(0.1, Math.min(2.0, newWeight)));
    }

    // Get weighted prediction from all models
    async getPrediction(symbols) {
        const predictions = new Map();
        const context = symbols.slice(-2).join('');
        
        // Get predictions from all models
        for (const [name, model] of this.models.entries()) {
            try {
                const result = await model.analyze(symbols);
                if (result.prediction !== null) {
                    // Apply error correction
                    const corrected = this.errorCorrection.getCorrection(
                        name, context, result.prediction, result.confidence
                    );
                    
                    predictions.set(name, {
                        prediction: corrected.prediction,
                        confidence: corrected.confidence * this.weights.get(name)
                    });
                }
            } catch (error) {
                console.error(`Error in ${name} prediction:`, error);
            }
        }
        
        // Combine predictions
        const combinedPredictions = new Map();
        let totalWeight = 0;
        
        predictions.forEach((pred, modelName) => {
            const weight = this.weights.get(modelName) * pred.confidence;
            totalWeight += weight;
            
            if (!combinedPredictions.has(pred.prediction)) {
                combinedPredictions.set(pred.prediction, 0);
            }
            combinedPredictions.set(
                pred.prediction,
                combinedPredictions.get(pred.prediction) + weight
            );
        });
        
        // Normalize and find best prediction
        let bestPrediction = null;
        let maxWeight = 0;
        
        combinedPredictions.forEach((weight, prediction) => {
            const normalizedWeight = weight / totalWeight;
            if (normalizedWeight > maxWeight) {
                maxWeight = normalizedWeight;
                bestPrediction = prediction;
            }
        });
        
        return {
            prediction: bestPrediction,
            confidence: maxWeight,
            modelPredictions: Object.fromEntries(predictions),
            weights: Object.fromEntries(this.weights)
        };
    }

    // Update model after seeing actual result
    updateModels(actual) {
        this.models.forEach((model, name) => {
            if (model.lastPrediction !== null) {
                const correct = model.lastPrediction === actual;
                this.updateWeights(name, correct, model.lastConfidence || 0.5);
                
                // Record error for correction
                if (model.lastContext) {
                    this.errorCorrection.recordError(
                        name,
                        model.lastContext,
                        model.lastPrediction,
                        actual
                    );
                }
            }
        });
    }
}

module.exports = { HybridModel, ErrorCorrection };
