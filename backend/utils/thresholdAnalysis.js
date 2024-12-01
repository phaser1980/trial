// Markov Chain Analysis (Threshold: 100 symbols)
const calculateMarkovChain = (symbols) => {
    const transitionMatrix = {};
    const transitionCounts = {};
    const patternWeights = new Map();
    const windowSize = 3;
    
    // Initialize matrices
    for (let i = 0; i < 4; i++) {
        transitionMatrix[i] = {};
        transitionCounts[i] = {};
        for (let j = 0; j < 4; j++) {
            transitionMatrix[i][j] = 0;
            transitionCounts[i][j] = 0;
        }
    }

    // Count transitions with sliding window
    for (let i = 0; i < symbols.length - windowSize; i++) {
        const pattern = symbols.slice(i, i + windowSize);
        const current = pattern[pattern.length - 2];
        const next = pattern[pattern.length - 1];
        
        transitionCounts[current][next]++;

        // Track pattern frequencies
        const patternKey = pattern.join(',');
        patternWeights.set(patternKey, (patternWeights.get(patternKey) || 0) + 1);
    }

    // Calculate probabilities with dynamic weighting
    for (let i = 0; i < 4; i++) {
        const totalTransitions = Object.values(transitionCounts[i]).reduce((a, b) => a + b, 0);
        if (totalTransitions > 0) {
            for (let j = 0; j < 4; j++) {
                // Apply recency bias
                const recentCount = transitionCounts[i][j];
                const recentWeight = Math.min(1, recentCount / 10); // More weight to frequently seen transitions
                transitionMatrix[i][j] = (recentCount / totalTransitions) * (1 + recentWeight);
            }
            
            // Normalize probabilities
            const sum = Object.values(transitionMatrix[i]).reduce((a, b) => a + b, 0);
            for (let j = 0; j < 4; j++) {
                transitionMatrix[i][j] /= sum;
            }
        } else {
            // Use uniform distribution if no transitions observed
            for (let j = 0; j < 4; j++) {
                transitionMatrix[i][j] = 0.25;
            }
        }
    }

    return {
        matrix: transitionMatrix,
        predictability: calculatePredictabilityScore(transitionMatrix, symbols, patternWeights)
    };
};

// Helper function for Markov Chain analysis
const calculatePredictabilityScore = (matrix, symbols, patternWeights) => {
    // Calculate base predictability from transition probabilities
    let maxProbabilities = [];
    for (let i = 0; i < 4; i++) {
        maxProbabilities.push(Math.max(...Object.values(matrix[i])));
    }
    
    const baseScore = maxProbabilities.reduce((a, b) => a + b, 0) / 4;
    
    // Calculate pattern strength
    const maxPatternCount = Math.max(...patternWeights.values());
    const patternStrength = Math.min(0.3, maxPatternCount / symbols.length);
    
    // Calculate sequence length factor
    const sequenceWeight = Math.min(1, symbols.length / 500);
    
    // Combine factors
    const confidence = (baseScore * 0.6) + (patternStrength * 0.3) + (sequenceWeight * 0.1);
    
    // Find most likely next symbol
    const lastSymbol = symbols[symbols.length - 1];
    const probabilities = matrix[lastSymbol];
    let prediction = 0;
    let maxProb = 0;
    
    for (let i = 0; i < 4; i++) {
        if (probabilities[i] > maxProb) {
            maxProb = probabilities[i];
            prediction = i;
        }
    }
    
    return {
        symbol: prediction,
        confidence: Math.min(0.95, confidence)
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

// Dynamic confidence adjustment based on sequence length
const adjustConfidence = (baseConfidence, sequenceLength, threshold) => {
    const scaleFactor = Math.min(2, Math.max(1, sequenceLength / threshold));
    return Math.min(0.95, baseConfidence * scaleFactor);
};

// Threshold-based analysis wrapper
const performThresholdAnalysis = (symbols) => {
    console.log(`[ThresholdAnalysis] Analyzing sequence of length ${symbols.length}`);

    const results = {
        markov: null,
        runs: null,
        autocorrelation: null,
        debug: {
            sequenceLength: symbols.length,
            thresholdsMet: []
        }
    };

    // Check sequence length requirements
    if (symbols.length < 50) {
        console.log('[ThresholdAnalysis] Sequence too short for any analysis');
        return {
            prediction: null,
            confidence: 0,
            debug: {
                error: 'Insufficient data',
                minimumRequired: 50,
                current: symbols.length
            }
        };
    }

    try {
        // Markov Chain Analysis (100+ symbols)
        if (symbols.length >= 100) {
            console.log('[ThresholdAnalysis] Performing Markov Chain analysis');
            results.markov = calculateMarkovChain(symbols);
            results.debug.thresholdsMet.push('markov');
        }

        // Runs Test (200+ symbols)
        if (symbols.length >= 200) {
            console.log('[ThresholdAnalysis] Performing Runs Test analysis');
            results.runs = performRunsTest(symbols);
            results.debug.thresholdsMet.push('runs');
        }

        // Autocorrelation (300+ symbols)
        if (symbols.length >= 300) {
            console.log('[ThresholdAnalysis] Performing Autocorrelation analysis');
            results.autocorrelation = calculateAutocorrelation(symbols);
            results.debug.thresholdsMet.push('autocorrelation');
        }

        // Determine prediction and confidence
        let prediction = null;
        let confidence = 0;

        console.log('[ThresholdAnalysis] Analysis results:', results);

        // Use available analyses to make prediction
        if (results.markov) {
            const markovPrediction = results.markov.predictability;
            confidence = Math.max(confidence, markovPrediction.confidence);
            prediction = markovPrediction.symbol;
            
            console.log('[ThresholdAnalysis] Markov prediction:', {
                symbol: prediction,
                confidence: markovPrediction.confidence
            });
        }

        if (results.runs && results.runs.isRandom === false) {
            confidence = Math.max(confidence, 0.7); // Strong non-randomness detected
            console.log('[ThresholdAnalysis] Non-random pattern detected in runs test');
        }

        if (results.autocorrelation && results.autocorrelation.hasPeriodicity) {
            confidence = Math.max(confidence, results.autocorrelation.strength);
            console.log('[ThresholdAnalysis] Periodicity detected:', {
                strength: results.autocorrelation.strength
            });
        }

        // Adjust confidence based on sequence length
        const adjustedConfidence = confidence > 0 ? 
            adjustConfidence(confidence, symbols.length, Math.max(...results.debug.thresholdsMet.map(t => 
                t === 'markov' ? 100 : t === 'runs' ? 200 : 300
            ))) : 0;

        console.log('[ThresholdAnalysis] Final prediction:', {
            symbol: prediction,
            rawConfidence: confidence,
            adjustedConfidence
        });

        return {
            prediction,
            confidence: adjustedConfidence,
            debug: {
                ...results.debug,
                analyses: {
                    markov: results.markov,
                    runs: results.runs,
                    autocorrelation: results.autocorrelation
                }
            }
        };

    } catch (error) {
        console.error('[ThresholdAnalysis] Error during analysis:', error);
        return {
            prediction: null,
            confidence: 0,
            debug: {
                error: error.message,
                stack: error.stack
            }
        };
    }
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
