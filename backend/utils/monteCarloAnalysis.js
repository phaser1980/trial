const AnalysisTool = require('./AnalysisTool');

class MonteCarloAnalysis extends AnalysisTool {
    constructor() {
        super('Monte Carlo Analysis');
        this.minSamples = 50;
        this.simulationCount = 1000;
        this.debugLog = [];
        this.seedCandidates = new Map(); // Track potential seed values
    }

    // Calculate transition probabilities from historical data
    calculateTransitionMatrix(symbols) {
        const matrix = {
            '♠': { '♠': 0, '♣': 0, '♥': 0, '♦': 0 },
            '♣': { '♠': 0, '♣': 0, '♥': 0, '♦': 0 },
            '♥': { '♠': 0, '♣': 0, '♥': 0, '♦': 0 },
            '♦': { '♠': 0, '♣': 0, '♥': 0, '♦': 0 }
        };

        let counts = {
            '♠': 0, '♣': 0, '♥': 0, '♦': 0
        };

        // Count transitions
        for (let i = 0; i < symbols.length - 1; i++) {
            const current = symbols[i];
            const next = symbols[i + 1];
            matrix[current][next]++;
            counts[current]++;
        }

        // Convert to probabilities
        for (const from in matrix) {
            for (const to in matrix[from]) {
                matrix[from][to] = counts[from] ? matrix[from][to] / counts[from] : 0.25;
            }
        }

        return matrix;
    }

    // Run a single simulation
    runSimulation(transitionMatrix, startSymbol, length) {
        let sequence = [startSymbol];
        for (let i = 0; i < length - 1; i++) {
            const current = sequence[sequence.length - 1];
            const rand = Math.random();
            let cumProb = 0;
            let nextSymbol = '♠';

            for (const symbol in transitionMatrix[current]) {
                cumProb += transitionMatrix[current][symbol];
                if (rand <= cumProb) {
                    nextSymbol = symbol;
                    break;
                }
            }
            sequence.push(nextSymbol);
        }
        return sequence;
    }

    // Calculate entropy of a sequence
    calculateEntropy(sequence) {
        const frequencies = {};
        sequence.forEach(symbol => {
            frequencies[symbol] = (frequencies[symbol] || 0) + 1;
        });

        let entropy = 0;
        const n = sequence.length;
        for (const symbol in frequencies) {
            const p = frequencies[symbol] / n;
            entropy -= p * Math.log2(p);
        }
        return entropy;
    }

    // Look for potential seed patterns
    analyzeSeedPatterns(symbols) {
        const patternLength = 4; // Look for 4-symbol patterns
        const patterns = new Map();

        for (let i = 0; i <= symbols.length - patternLength; i++) {
            const pattern = symbols.slice(i, i + patternLength).join('');
            if (!patterns.has(pattern)) {
                patterns.set(pattern, { count: 0, positions: [] });
            }
            patterns.get(pattern).count++;
            patterns.get(pattern).positions.push(i);
        }

        // Find patterns that appear more frequently than random chance
        const expectedFrequency = symbols.length / Math.pow(4, patternLength);
        const significantPatterns = Array.from(patterns.entries())
            .filter(([_, data]) => data.count > expectedFrequency * 1.5)
            .sort((a, b) => b[1].count - a[1].count);

        return significantPatterns;
    }

    async analyze(symbols) {
        try {
            this.debugLog = [];
            this.debugLog.push(`Starting Monte Carlo analysis with ${symbols.length} symbols`);

            if (symbols.length < this.minSamples) {
                this.debugLog.push(`Insufficient data: ${symbols.length} < ${this.minSamples}`);
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Calculate transition matrix
            const transitionMatrix = this.calculateTransitionMatrix(symbols);
            this.debugLog.push('Calculated transition matrix');

            // Run simulations
            const lastSymbol = symbols[symbols.length - 1];
            let predictions = {
                '♠': 0, '♣': 0, '♥': 0, '♦': 0
            };

            for (let i = 0; i < this.simulationCount; i++) {
                const simulation = this.runSimulation(transitionMatrix, lastSymbol, 2);
                predictions[simulation[1]]++;
            }

            // Find most likely next symbol
            let maxCount = 0;
            let prediction = null;
            for (const symbol in predictions) {
                if (predictions[symbol] > maxCount) {
                    maxCount = predictions[symbol];
                    prediction = symbol;
                }
            }

            // Calculate confidence based on simulation results and historical accuracy
            const confidence = maxCount / this.simulationCount;
            const adjustedConfidence = Math.min(0.95, confidence * (1 + this.getAccuracy()));

            // Analyze for potential seed patterns
            const seedPatterns = this.analyzeSeedPatterns(symbols);
            if (seedPatterns.length > 0) {
                this.debugLog.push(`Found ${seedPatterns.length} potential seed patterns`);
                this.seedCandidates.set(Date.now(), seedPatterns[0]);
            }

            // Update prediction history
            this.addPrediction(prediction);

            return {
                prediction,
                confidence: adjustedConfidence,
                debug: {
                    transitionMatrix,
                    simulationResults: predictions,
                    seedPatterns: seedPatterns.slice(0, 3),
                    log: this.debugLog
                }
            };

        } catch (error) {
            console.error('[Monte Carlo] Analysis error:', error);
            this.debugLog.push(`Error in analysis: ${error.message}`);
            return {
                prediction: null,
                confidence: 0,
                error: error.message,
                debug: this.debugLog
            };
        }
    }
}

module.exports = MonteCarloAnalysis;
