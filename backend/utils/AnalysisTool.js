class AnalysisTool {
    constructor(name) {
        this.name = name;
        this.internalName = name.toLowerCase().replace(/\s+/g, '');
        this.maxRecentData = 100;
        this.recentData = [];
        this.lastPrediction = null;
        this.predictionHistory = [];
        this.accuracy = 0;
        this.predictionCount = 0;
        this.correctPredictions = 0;
    }

    updateAccuracy(wasCorrect) {
        this.predictionCount++;
        if (wasCorrect) {
            this.correctPredictions++;
        }
        this.accuracy = this.correctPredictions / this.predictionCount;
        return this.accuracy;
    }

    getAccuracy() {
        return this.accuracy;
    }

    getModelState() {
        return {
            name: this.name,
            accuracy: this.accuracy,
            predictionCount: this.predictionCount,
            lastPrediction: this.lastPrediction
        };
    }

    addPrediction(prediction, actual = null) {
        this.lastPrediction = {
            prediction,
            timestamp: Date.now(),
            actual
        };

        this.predictionHistory.push(this.lastPrediction);
        if (this.predictionHistory.length > 50) {
            this.predictionHistory = this.predictionHistory.slice(-50);
        }

        if (actual !== null) {
            this.updateAccuracy(prediction === actual);
        }
    }
}

module.exports = AnalysisTool;
