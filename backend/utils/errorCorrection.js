class ErrorCorrection {
    constructor() {
        this.errorHistory = [];
        this.maxHistorySize = 1000;
        this.patternLength = 5;
        this.minConfidence = 0.6;
        this.debugLog = [];
    }

    // Add a prediction error to history
    addError(actualSymbol, predictedSymbol, context, confidence) {
        this.errorHistory.push({
            actual: actualSymbol,
            predicted: predictedSymbol,
            context: context.slice(-this.patternLength),
            confidence,
            timestamp: Date.now()
        });

        // Maintain history size
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }

        this.debugLog.push(`Added error: ${predictedSymbol} -> ${actualSymbol} (conf: ${confidence})`);
    }

    // Find similar contexts in error history
    findSimilarContexts(currentContext) {
        const context = currentContext.slice(-this.patternLength);
        return this.errorHistory.filter(error => 
            this.arraysEqual(error.context, context)
        );
    }

    // Helper to compare arrays
    arraysEqual(a, b) {
        if (a.length !== b.length) return false;
        return a.every((val, idx) => val === b[idx]);
    }

    // Calculate error patterns
    calculateErrorPatterns(similarErrors) {
        const patterns = {};
        
        similarErrors.forEach(error => {
            const key = `${error.predicted}->${error.actual}`;
            if (!patterns[key]) {
                patterns[key] = {
                    count: 0,
                    totalConfidence: 0,
                    predicted: error.predicted,
                    actual: error.actual
                };
            }
            patterns[key].count++;
            patterns[key].totalConfidence += error.confidence;
        });

        return patterns;
    }

    // Correct a prediction based on error history
    correctPrediction(prediction, context) {
        this.debugLog = [];
        this.debugLog.push(`Starting prediction correction for ${prediction.symbol}`);

        // If confidence is high enough, don't correct
        if (prediction.confidence > 0.9) {
            this.debugLog.push('High confidence prediction, no correction needed');
            return prediction;
        }

        const similarErrors = this.findSimilarContexts(context);
        this.debugLog.push(`Found ${similarErrors.length} similar contexts`);

        if (similarErrors.length < 3) {
            this.debugLog.push('Insufficient similar contexts for correction');
            return prediction;
        }

        const patterns = this.calculateErrorPatterns(similarErrors);
        this.debugLog.push(`Calculated ${Object.keys(patterns).length} error patterns`);

        // Find the most common error pattern
        let maxCount = 0;
        let bestPattern = null;

        for (const key in patterns) {
            const pattern = patterns[key];
            if (pattern.count > maxCount && 
                pattern.predicted === prediction.symbol) {
                maxCount = pattern.count;
                bestPattern = pattern;
            }
        }

        // Apply correction if pattern is strong enough
        if (bestPattern && 
            (bestPattern.count / similarErrors.length) > 0.3) {
            
            const avgConfidence = bestPattern.totalConfidence / bestPattern.count;
            const correctedConfidence = Math.min(
                0.95,
                prediction.confidence * (1 + avgConfidence) / 2
            );

            this.debugLog.push(`Applied correction: ${prediction.symbol} -> ${bestPattern.actual}`);
            
            return {
                symbol: bestPattern.actual,
                confidence: correctedConfidence,
                original: prediction,
                correction: {
                    pattern: bestPattern,
                    similarContexts: similarErrors.length
                }
            };
        }

        this.debugLog.push('No strong correction pattern found');
        return prediction;
    }

    // Get error statistics
    getStatistics() {
        const stats = {
            totalErrors: this.errorHistory.length,
            recentErrors: this.errorHistory.filter(e => 
                Date.now() - e.timestamp < 3600000
            ).length,
            patterns: {},
            debug: this.debugLog
        };

        // Calculate pattern frequencies
        this.errorHistory.forEach(error => {
            const key = `${error.predicted}->${error.actual}`;
            if (!stats.patterns[key]) {
                stats.patterns[key] = 0;
            }
            stats.patterns[key]++;
        });

        return stats;
    }

    // Clear old error history
    clearOldErrors(maxAge = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        this.errorHistory = this.errorHistory.filter(error =>
            now - error.timestamp < maxAge
        );
        this.debugLog.push(`Cleared errors older than ${maxAge}ms`);
    }
}

module.exports = ErrorCorrection;
