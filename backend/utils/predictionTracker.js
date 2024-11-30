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
        this.initializeModel(modelName);
        const history = this.modelHistory.get(modelName);

        // Add new prediction
        history.predictions.push(prediction);
        history.actuals.push(actual);
        history.confidences.push(confidence);

        // Maintain window size
        if (history.predictions.length > this.historyWindow) {
            history.predictions.shift();
            history.actuals.shift();
            history.confidences.shift();
        }

        // Update accuracy
        this.updateAccuracy(modelName);
        
        // Update calibration
        this.updateCalibration(modelName);
    }

    // Update accuracy metrics
    updateAccuracy(modelName) {
        const history = this.modelHistory.get(modelName);
        const correct = history.predictions.reduce((sum, pred, i) => 
            sum + (pred === history.actuals[i] ? 1 : 0), 0);
        
        const accuracy = correct / history.predictions.length;
        history.accuracyOverTime.push(accuracy);

        // Maintain window size for accuracy history
        if (history.accuracyOverTime.length > this.historyWindow) {
            history.accuracyOverTime.shift();
        }
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
        const recentAccuracy = recentPredictions.reduce((sum, pred, i) => 
            sum + (pred === recentActuals[i] ? 1 : 0), 0) / recentWindow;
        const avgConfidence = recentConfidences.reduce((sum, conf) => sum + conf, 0) / recentWindow;

        // Adjust calibration factor
        if (avgConfidence > 0) {
            const newCalibration = recentAccuracy / avgConfidence;
            history.calibrationFactor = 0.7 * history.calibrationFactor + 0.3 * newCalibration;
        }
    }

    // Get calibrated confidence for a model
    getCalibratedConfidence(modelName, rawConfidence) {
        const history = this.modelHistory.get(modelName);
        if (!history) return rawConfidence;

        // Apply calibration factor
        let calibratedConfidence = rawConfidence * history.calibrationFactor;

        // If accuracy is consistently low, reduce confidence more aggressively
        const recentAccuracy = history.accuracyOverTime.slice(-5).reduce((sum, acc) => sum + acc, 0) / 5;
        if (recentAccuracy < this.accuracyThreshold) {
            calibratedConfidence *= (recentAccuracy / this.accuracyThreshold);
        }

        return Math.min(0.95, Math.max(0.05, calibratedConfidence));
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
