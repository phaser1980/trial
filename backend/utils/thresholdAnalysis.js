// Markov Chain Analysis (Threshold: 100 symbols)
const calculateMarkovChain = (symbols) => {
    const transitionMatrix = {};
    const transitionCounts = {};
    
    // Initialize matrices
    for (let i = 0; i < 4; i++) {
        transitionMatrix[i] = {};
        transitionCounts[i] = {};
        for (let j = 0; j < 4; j++) {
            transitionMatrix[i][j] = 0;
            transitionCounts[i][j] = 0;
        }
    }

    // Count transitions
    for (let i = 0; i < symbols.length - 1; i++) {
        const current = symbols[i];
        const next = symbols[i + 1];
        transitionCounts[current][next]++;
    }

    // Calculate probabilities
    for (let i = 0; i < 4; i++) {
        const totalTransitions = Object.values(transitionCounts[i]).reduce((a, b) => a + b, 0);
        for (let j = 0; j < 4; j++) {
            transitionMatrix[i][j] = totalTransitions ? 
                transitionCounts[i][j] / totalTransitions : 0;
        }
    }

    return {
        matrix: transitionMatrix,
        predictability: calculatePredictabilityScore(transitionMatrix, symbols)
    };
};

// Runs Test Analysis (Threshold: 200 symbols)
const performRunsTest = (symbols) => {
    let runs = 1;
    let positiveRuns = [];
    let currentRun = 1;

    // Count runs
    for (let i = 1; i < symbols.length; i++) {
        if (symbols[i] === symbols[i - 1]) {
            currentRun++;
        } else {
            positiveRuns.push(currentRun);
            currentRun = 1;
            runs++;
        }
    }
    positiveRuns.push(currentRun);

    // Calculate statistics
    const expectedRuns = ((2 * symbols.length) - 1) / 3;
    const runsVariance = (16 * symbols.length - 29) / 90;
    const zScore = (runs - expectedRuns) / Math.sqrt(runsVariance);

    return {
        totalRuns: runs,
        longestRun: Math.max(...positiveRuns),
        zScore: zScore,
        isRandom: Math.abs(zScore) < 1.96 // 95% confidence level
    };
};

// Autocorrelation Analysis (Threshold: 300 symbols)
const calculateAutocorrelation = (symbols, lag = 1) => {
    const n = symbols.length;
    const mean = symbols.reduce((a, b) => a + b, 0) / n;
    let numerator = 0;
    let denominator = 0;

    // Calculate autocorrelation
    for (let i = 0; i < n - lag; i++) {
        numerator += (symbols[i] - mean) * (symbols[i + lag] - mean);
    }
    
    for (let i = 0; i < n; i++) {
        denominator += Math.pow(symbols[i] - mean, 2);
    }

    const correlation = numerator / denominator;

    return {
        correlation,
        lag,
        hasPeriodicity: Math.abs(correlation) > 0.2,
        strength: Math.abs(correlation)
    };
};

// Helper function for Markov Chain analysis
const calculatePredictabilityScore = (matrix, symbols) => {
    let maxProbabilities = [];
    for (let i = 0; i < 4; i++) {
        maxProbabilities.push(Math.max(...Object.values(matrix[i])));
    }
    
    // Improved confidence calculation for longer sequences
    const baseScore = maxProbabilities.reduce((a, b) => a + b, 0) / 4;
    const sequenceWeight = Math.min(1, symbols.length / 500); // Scale with sequence length up to 500
    return baseScore * (1 + sequenceWeight);
};

// Dynamic confidence adjustment based on sequence length
const adjustConfidence = (baseConfidence, sequenceLength, threshold) => {
    const scaleFactor = Math.min(2, Math.max(1, sequenceLength / threshold));
    return Math.min(0.95, baseConfidence * scaleFactor);
};

// Threshold-based analysis wrapper
const performThresholdAnalysis = (symbols) => {
    const sequenceLength = symbols.length;
    let analysis = {};

    // Markov Chain Analysis (Threshold: 100 symbols)
    if (sequenceLength >= 100) {
        const markovResult = calculateMarkovChain(symbols);
        const baseConfidence = markovResult.predictability;
        analysis.markovChain = {
            ...markovResult,
            confidence: adjustConfidence(baseConfidence, sequenceLength, 100)
        };
    }

    // Runs Test Analysis (Threshold: 200 symbols)
    if (sequenceLength >= 200) {
        const runsResult = performRunsTest(symbols);
        const baseConfidence = runsResult.isRandom ? 0.8 : 0.6;
        analysis.runsTest = {
            ...runsResult,
            confidence: adjustConfidence(baseConfidence, sequenceLength, 200)
        };
    }

    // Autocorrelation Analysis (Threshold: 300 symbols)
    if (sequenceLength >= 300) {
        const autoCorr = calculateAutocorrelation(symbols);
        const baseConfidence = 0.7 + (autoCorr.strength * 0.3);
        analysis.autocorrelation = {
            ...autoCorr,
            confidence: adjustConfidence(baseConfidence, sequenceLength, 300)
        };
    }

    return analysis;
};

const AnalysisTool = require('./AnalysisTool');

class ThresholdAnalysis extends AnalysisTool {
    constructor() {
        super('Threshold Analysis');
        this.thresholds = {
            '♠': 0.25,
            '♣': 0.5,
            '♥': 0.75,
            '♦': 1.0
        };
        this.windowSize = 10;
    }

    // Calculate running average
    calculateRunningAverage(values) {
        if (values.length === 0) return 0;
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    // Convert symbol to numerical value
    symbolToValue(symbol) {
        return this.thresholds[symbol] || 0;
    }

    // Convert numerical value to symbol
    valueToSymbol(value) {
        let result = '♠';
        for (const [symbol, threshold] of Object.entries(this.thresholds)) {
            if (value <= threshold) {
                result = symbol;
                break;
            }
        }
        return result;
    }

    async analyze(symbols) {
        try {
            if (!symbols || symbols.length < this.windowSize) {
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient data'
                };
            }

            // Convert recent symbols to values
            const values = symbols.slice(-this.windowSize).map(s => this.symbolToValue(s));
            const average = this.calculateRunningAverage(values);

            // Calculate trend
            const trend = values[values.length - 1] - values[values.length - 2];
            
            // Predict next value
            let predictedValue = average + (trend * 0.5);
            predictedValue = Math.max(0, Math.min(1, predictedValue));

            // Convert to symbol
            const prediction = this.valueToSymbol(predictedValue);

            // Calculate confidence based on consistency
            const variance = values.reduce((sum, val) => 
                sum + Math.pow(val - average, 2), 0) / values.length;
            const confidence = Math.max(0.1, Math.min(0.9, 1 - Math.sqrt(variance)));

            // Update prediction history
            this.addPrediction(prediction);

            return {
                prediction,
                confidence,
                debug: {
                    average,
                    trend,
                    variance,
                    windowSize: this.windowSize
                }
            };

        } catch (error) {
            console.error('[Threshold] Analysis error:', error);
            return {
                prediction: null,
                confidence: 0,
                error: error.message
            };
        }
    }
}

module.exports = {
    performThresholdAnalysis,
    calculateMarkovChain,
    performRunsTest,
    calculateAutocorrelation,
    ThresholdAnalysis
};
