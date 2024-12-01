const AnalysisTool = require('./AnalysisTool');

class MonteCarloAnalysis extends AnalysisTool {
    constructor() {
        super('Monte Carlo Analysis');
        this.minSamples = 50;
        this.simulationCount = 1000;
        this.debugLog = [];
        this.seedCandidates = new Map(); // Track potential seed values
        this.numSymbols = 4; // Number of possible symbols (0-3)
        this.confidenceThreshold = 0.25; // Minimum confidence threshold
        this.patternLength = 3; // Length of patterns to analyze
    }

    // Calculate transition probabilities from historical data
    calculateTransitionMatrix(symbols) {
        const matrix = {};
        const counts = {};
        
        // Initialize matrices using numeric indices
        for (let i = 0; i < this.numSymbols; i++) {
            matrix[i] = {};
            counts[i] = 0;
            for (let j = 0; j < this.numSymbols; j++) {
                matrix[i][j] = 0;
            }
        }

        // Count transitions with pattern analysis
        for (let i = 0; i < symbols.length - this.patternLength; i++) {
            const pattern = symbols.slice(i, i + this.patternLength);
            const current = pattern[pattern.length - 2];
            const next = pattern[pattern.length - 1];
            
            if (current < 0 || current > this.numSymbols - 1 || next < 0 || next > this.numSymbols - 1) {
                continue;
            }
            
            matrix[current][next]++;
            counts[current]++;
            
            // Track potential seed patterns
            const patternKey = pattern.join(',');
            if (!this.seedCandidates.has(patternKey)) {
                this.seedCandidates.set(patternKey, 1);
            } else {
                this.seedCandidates.set(patternKey, this.seedCandidates.get(patternKey) + 1);
            }
        }

        // Convert to probabilities with adaptive smoothing
        for (const from in matrix) {
            const totalCount = counts[from];
            const smoothingFactor = Math.max(0.1, Math.min(1, totalCount / 100));
            
            if (totalCount === 0) {
                for (const to in matrix[from]) {
                    matrix[from][to] = 1 / this.numSymbols;
                }
            } else {
                for (const to in matrix[from]) {
                    // Apply adaptive smoothing
                    const rawProb = matrix[from][to] / totalCount;
                    matrix[from][to] = (rawProb * smoothingFactor) + ((1 / this.numSymbols) * (1 - smoothingFactor));
                }
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
            
            if (!probabilities) {
                console.error('[Monte Carlo] No probabilities for symbol:', current);
                return null;
            }
            
            // Validate probabilities
            const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
            if (Math.abs(sum - 1) > 0.0001) {
                console.error('[Monte Carlo] Invalid probability distribution:', { current, sum, probabilities });
                return null;
            }
            
            // Generate next symbol based on probabilities
            const rand = Math.random();
            let cumProb = 0;
            let nextSymbol = null;
            
            for (let j = 0; j < this.numSymbols; j++) {
                cumProb += probabilities[j];
                if (rand < cumProb) {
                    nextSymbol = j;
                    break;
                }
            }
            
            if (nextSymbol === null) {
                console.error('[Monte Carlo] Failed to select next symbol:', { rand, cumProb, probabilities });
                return null;
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
        const expectedFrequency = symbols.length / Math.pow(this.numSymbols, patternLength);
        const significantPatterns = Array.from(patterns.entries())
            .filter(([_, data]) => data.count > expectedFrequency * 1.5)
            .sort((a, b) => b[1].count - a[1].count);

        return significantPatterns;
    }

    async analyze(symbols) {
        try {
            this.debugLog = [];
            
            if (symbols.length < this.minSamples) {
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Calculate transition matrix with pattern analysis
            const transitionMatrix = this.calculateTransitionMatrix(symbols);
            const recentPattern = symbols.slice(-this.patternLength);
            
            // Run simulations with pattern matching
            const predictions = new Array(this.numSymbols).fill(0);
            let validSimulations = 0;
            let maxPatternMatch = 0;

            for (let i = 0; i < this.simulationCount; i++) {
                const simulation = this.runSimulation(transitionMatrix, recentPattern[recentPattern.length - 1], 2);
                if (simulation && simulation.length === 2) {
                    predictions[simulation[1]]++;
                    validSimulations++;
                    
                    // Check if this matches a known pattern
                    const simPattern = [...recentPattern.slice(1), simulation[1]].join(',');
                    const patternCount = this.seedCandidates.get(simPattern) || 0;
                    maxPatternMatch = Math.max(maxPatternMatch, patternCount);
                }
            }

            if (validSimulations === 0) {
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'No valid simulations',
                    debug: this.debugLog
                };
            }

            // Find most likely prediction
            let maxCount = 0;
            let prediction = null;
            let secondMaxCount = 0;

            predictions.forEach((count, symbol) => {
                if (count > maxCount) {
                    secondMaxCount = maxCount;
                    maxCount = count;
                    prediction = symbol;
                } else if (count > secondMaxCount) {
                    secondMaxCount = count;
                }
            });

            // Calculate confidence based on simulation distribution and pattern matches
            const distributionConfidence = (maxCount - secondMaxCount) / validSimulations;
            const patternConfidence = maxPatternMatch / this.minSamples;
            const confidence = Math.min(1, Math.max(0, 
                (distributionConfidence * 0.6) + (patternConfidence * 0.4)
            ));

            return {
                prediction: prediction,
                confidence: confidence,
                debug: this.debugLog
            };

        } catch (error) {
            console.error('Monte Carlo Analysis Error:', error);
            return {
                prediction: null,
                confidence: 0,
                message: error.message,
                debug: this.debugLog
            };
        }
    }
}

module.exports = MonteCarloAnalysis;
