const AnalysisTool = require('./AnalysisTool');

class MonteCarloAnalysis extends AnalysisTool {
    constructor() {
        super('Monte Carlo Analysis');
        this.minSamples = 50;
        this.simulationCount = 1000;
        this.debugLog = [];
        this.seedCandidates = new Map(); // Track potential seed values
        this.symbolMap = ['♠', '♣', '♥', '♦'];
    }

    // Calculate transition probabilities from historical data
    calculateTransitionMatrix(symbols) {
        const matrix = {};
        const counts = {};
        
        // Initialize matrices using numeric indices
        for (let i = 0; i < 4; i++) {
            matrix[i] = {};
            counts[i] = 0;
            for (let j = 0; j < 4; j++) {
                matrix[i][j] = 0;
            }
        }

        // Count transitions using numeric indices
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
            const probabilities = transitionMatrix[current];
            
            // Generate next symbol based on probabilities
            const rand = Math.random();
            let cumProb = 0;
            let nextSymbol = 0;
            
            for (let j = 0; j < 4; j++) {
                cumProb += probabilities[j];
                if (rand < cumProb) {
                    nextSymbol = j;
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
                    confidence: 0.25,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Calculate transition matrix
            const transitionMatrix = this.calculateTransitionMatrix(symbols);
            this.debugLog.push('Calculated transition matrix');

            // Run simulations
            const lastSymbol = symbols[symbols.length - 1];
            const predictions = new Array(4).fill(0);

            for (let i = 0; i < this.simulationCount; i++) {
                const simulation = this.runSimulation(transitionMatrix, lastSymbol, 2);
                predictions[simulation[1]]++;
            }

            // Find most likely next symbol
            let maxCount = 0;
            let prediction = null;
            
            for (let i = 0; i < predictions.length; i++) {
                if (predictions[i] > maxCount) {
                    maxCount = predictions[i];
                    prediction = i;
                }
            }

            // Calculate confidence based on simulation results
            const confidence = maxCount / this.simulationCount;
            const adjustedConfidence = Math.min(0.95, confidence * (1 + this.getAccuracy()));

            this.debugLog.push(`Prediction results:`, {
                predictions,
                maxCount,
                confidence,
                adjustedConfidence
            });

            // Update prediction history
            this.addPrediction(prediction);

            return {
                prediction,
                confidence: adjustedConfidence,
                debug: {
                    transitionMatrix,
                    simulationResults: predictions,
                    log: this.debugLog
                }
            };

        } catch (error) {
            console.error('[Monte Carlo] Analysis error:', error);
            this.debugLog.push(`Error in analysis: ${error.message}`);
            return {
                prediction: null,
                confidence: 0.25,
                error: error.message,
                debug: this.debugLog
            };
        }
    }
}

module.exports = MonteCarloAnalysis;
