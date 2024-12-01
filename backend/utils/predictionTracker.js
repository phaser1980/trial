const tf = require('@tensorflow/tfjs');

class PredictionTracker {
    constructor() {
        this.historyWindow = 50; // Number of predictions to track
        this.modelHistory = new Map();
        this.confidenceCalibration = new Map();
        this.accuracyThreshold = 0.6; // Minimum accuracy threshold
    }

    // Initialize tracking for a model
    initializeModel(modelName) {
        if (!this.modelHistory.has(modelName)) {
            this.modelHistory.set(modelName, {
                predictions: [],
                actuals: [],
                confidences: [],
                accuracyOverTime: [],
                calibrationFactor: 1.0
            });
        }
    }

    // Record a new prediction
    recordPrediction(modelName, prediction, confidence, actual) {
        console.log(`[PredictionTracker] Recording prediction for ${modelName}:`, {
            prediction,
            confidence,
            actual
        });

        this.initializeModel(modelName);
        const history = this.modelHistory.get(modelName);

        // Validate inputs
        if (prediction === null || prediction === undefined) {
            console.log(`[PredictionTracker] Skipping null/undefined prediction for ${modelName}`);
            return;
        }

        // Convert prediction and actual to numbers for comparison
        const predictionNum = Number(prediction);
        const actualNum = Number(actual);

        if (isNaN(predictionNum) || isNaN(actualNum)) {
            console.log(`[PredictionTracker] Invalid prediction or actual value for ${modelName}:`, {
                prediction,
                actual,
                predictionNum,
                actualNum
            });
            return;
        }

        if (confidence < 0 || confidence > 1) {
            console.log(`[PredictionTracker] Invalid confidence value for ${modelName}: ${confidence}`);
            confidence = Math.max(0, Math.min(1, confidence));
        }

        // Add new prediction
        history.predictions.push(predictionNum);
        history.actuals.push(actualNum);
        history.confidences.push(confidence);

        // Maintain window size
        if (history.predictions.length > this.historyWindow) {
            history.predictions.shift();
            history.actuals.shift();
            history.confidences.shift();
        }

        // Update accuracy and log results
        const newAccuracy = this.updateAccuracy(modelName);
        console.log(`[PredictionTracker] Updated ${modelName} accuracy:`, {
            newAccuracy,
            totalPredictions: history.predictions.length,
            lastPrediction: predictionNum,
            lastActual: actualNum,
            wasCorrect: predictionNum === actualNum
        });
        
        // Update calibration
        this.updateCalibration(modelName);
    }

    // Update accuracy metrics
    updateAccuracy(modelName) {
        const history = this.modelHistory.get(modelName);
        const correct = history.predictions.reduce((sum, pred, i) => 
            sum + (pred === history.actuals[i] ? 1 : 0), 0);
        
        const accuracy = history.predictions.length > 0 ? correct / history.predictions.length : 0;
        history.accuracyOverTime.push(accuracy);

        // Maintain window size for accuracy history
        if (history.accuracyOverTime.length > this.historyWindow) {
            history.accuracyOverTime.shift();
        }

        console.log(`[PredictionTracker] ${modelName} accuracy details:`, {
            correct,
            total: history.predictions.length,
            accuracy,
            recentPredictions: history.predictions.slice(-5),
            recentActuals: history.actuals.slice(-5)
        });

        return accuracy;
    }

    // Update confidence calibration
    updateCalibration(modelName) {
        const history = this.modelHistory.get(modelName);
        const recentWindow = 10; // Look at last 10 predictions for quick adaptation

        // Calculate recent accuracy
        const recentPredictions = history.predictions.slice(-recentWindow);
        const recentActuals = history.actuals.slice(-recentWindow);
        const recentConfidences = history.confidences.slice(-recentWindow);

        if (recentPredictions.length < recentWindow) return;

        // Calculate actual accuracy vs average confidence
        const recentCorrect = recentPredictions.reduce((sum, pred, i) => 
            sum + (pred === recentActuals[i] ? 1 : 0), 0);
        const recentAccuracy = recentCorrect / recentWindow;
        const avgConfidence = recentConfidences.reduce((sum, conf) => sum + conf, 0) / recentWindow;

        // Calculate overconfidence penalty
        const overconfidencePenalty = Math.max(0, avgConfidence - recentAccuracy);
        
        // Adjust calibration factor more aggressively for overconfident models
        const newCalibration = recentAccuracy / (avgConfidence + overconfidencePenalty);
        history.calibrationFactor = 0.7 * history.calibrationFactor + 0.3 * newCalibration;

        console.log(`[PredictionTracker] ${modelName} calibration update:`, {
            recentAccuracy,
            avgConfidence,
            overconfidencePenalty,
            newCalibration,
            finalCalibrationFactor: history.calibrationFactor
        });
    }

    // Get calibrated confidence for a model
    getCalibratedConfidence(modelName, rawConfidence) {
        console.log(`[PredictionTracker] Calibrating confidence for ${modelName}:`, {
            rawConfidence
        });

        const history = this.modelHistory.get(modelName);
        if (!history) {
            console.log(`[PredictionTracker] No history for ${modelName}, using raw confidence`);
            return rawConfidence;
        }

        // Apply calibration factor
        let calibratedConfidence = rawConfidence * history.calibrationFactor;

        // If accuracy is consistently low, reduce confidence more aggressively
        const recentAccuracy = history.accuracyOverTime.slice(-5).reduce((sum, acc) => sum + acc, 0) / 5;
        
        console.log(`[PredictionTracker] Calibration metrics for ${modelName}:`, {
            calibrationFactor: history.calibrationFactor,
            recentAccuracy,
            accuracyThreshold: this.accuracyThreshold
        });

        if (recentAccuracy < this.accuracyThreshold) {
            calibratedConfidence *= (recentAccuracy / this.accuracyThreshold);
            console.log(`[PredictionTracker] Applying accuracy penalty for ${modelName}`);
        }

        const finalConfidence = Math.min(0.95, Math.max(0.05, calibratedConfidence));
        console.log(`[PredictionTracker] Final calibrated confidence for ${modelName}:`, finalConfidence);

        return finalConfidence;
    }

    // Get model performance metrics
    getModelMetrics(modelName) {
        const history = this.modelHistory.get(modelName);
        if (!history) return null;

        const recentAccuracy = history.accuracyOverTime.slice(-5).reduce((sum, acc) => sum + acc, 0) / 5;
        return {
            recentAccuracy,
            calibrationFactor: history.calibrationFactor,
            predictionCount: history.predictions.length,
            confidenceTrend: this.calculateConfidenceTrend(history.confidences)
        };
    }

    // Calculate confidence trend
    calculateConfidenceTrend(confidences) {
        if (confidences.length < 2) return 0;
        
        const recent = confidences.slice(-5);
        const slope = tf.linearRegression(
            recent.map((_, i) => i),
            recent
        );
        return slope;
    }
}

module.exports = PredictionTracker;
