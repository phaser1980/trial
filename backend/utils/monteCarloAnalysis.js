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
            
            // Validate symbols
            if (current < 0 || current > 3 || next < 0 || next > 3) {
                console.error('[Monte Carlo] Invalid symbol in sequence:', { current, next });
                continue;
            }
            
            matrix[current][next]++;
            counts[current]++;
        }

        // Add Laplace smoothing (add-one smoothing)
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                matrix[i][j] += 1; // Add 1 to all counts
                counts[i] += 4;    // Add 4 to total (one for each possible next state)
            }
        }

        // Convert to probabilities with validation
        for (const from in matrix) {
            const totalCount = counts[from];
            if (totalCount === 0) {
                console.error('[Monte Carlo] Zero total count for symbol:', from);
                // Use uniform distribution
                for (const to in matrix[from]) {
                    matrix[from][to] = 0.25;
                }
            } else {
                for (const to in matrix[from]) {
                    matrix[from][to] = matrix[from][to] / totalCount;
                }
            }
            
            // Validate probabilities sum to 1
            const sum = Object.values(matrix[from]).reduce((a, b) => a + b, 0);
            if (Math.abs(sum - 1) > 0.0001) {
                console.error('[Monte Carlo] Probabilities do not sum to 1:', { from, sum, probabilities: matrix[from] });
            }
        }

        // Log transition matrix statistics
        console.log('[Monte Carlo] Transition Matrix Stats:', {
            totalTransitions: Object.values(counts).reduce((a, b) => a + b, 0),
            symbolCounts: counts,
            probabilityRanges: Object.entries(matrix).map(([from, tos]) => ({
                from,
                min: Math.min(...Object.values(tos)),
                max: Math.max(...Object.values(tos)),
                avg: Object.values(tos).reduce((a, b) => a + b, 0) / 4
            }))
        });

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
            
            for (let j = 0; j < 4; j++) {
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
        const expectedFrequency = symbols.length / Math.pow(4, patternLength);
        const significantPatterns = Array.from(patterns.entries())
            .filter(([_, data]) => data.count > expectedFrequency * 1.5)
            .sort((a, b) => b[1].count - a[1].count);

        return significantPatterns;
    }

    async analyze(symbols) {
        try {
            this.debugLog = [];
            console.log('[Monte Carlo] Starting analysis with symbols:', {
                total: symbols.length,
                last10: symbols.slice(-10),
                lastSymbol: symbols[symbols.length - 1]
            });

            if (symbols.length < this.minSamples) {
                console.log('[Monte Carlo] Insufficient data:', symbols.length);
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Calculate transition matrix
            const transitionMatrix = this.calculateTransitionMatrix(symbols);
            console.log('[Monte Carlo] Transition Matrix:', transitionMatrix);

            // Run simulations
            const lastSymbol = symbols[symbols.length - 1];
            const predictions = new Array(4).fill(0);
            let validSimulations = 0;

            console.log('[Monte Carlo] Starting simulations with last symbol:', lastSymbol);

            for (let i = 0; i < this.simulationCount; i++) {
                const simulation = this.runSimulation(transitionMatrix, lastSymbol, 2);
                if (simulation && simulation.length === 2) {
                    predictions[simulation[1]]++;
                    validSimulations++;
                }
            }

            if (validSimulations === 0) {
                console.log('[Monte Carlo] No valid simulations completed');
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'No valid simulations',
                    debug: this.debugLog
                };
            }

            console.log('[Monte Carlo] Simulation results:', {
                predictions,
                validSimulations,
                distributionPercentages: predictions.map(p => (p/validSimulations * 100).toFixed(2) + '%')
            });

            // Find most likely next symbol
            let maxCount = 0;
            let prediction = null;
            
            for (let i = 0; i < predictions.length; i++) {
                if (predictions[i] > maxCount) {
                    maxCount = predictions[i];
                    prediction = i;
                }
            }

            // Only make prediction if we have a clear winner
            if (maxCount < validSimulations * 0.25) {
                console.log('[Monte Carlo] No clear prediction pattern');
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'No clear pattern',
                    debug: {
                        transitionMatrix,
                        simulationResults: predictions,
                        validSimulations,
                        log: this.debugLog
                    }
                };
            }

            // Calculate confidence
            const confidence = maxCount / validSimulations;
            const adjustedConfidence = Math.min(0.95, confidence * (1 + this.getAccuracy()));

            console.log('[Monte Carlo] Final prediction:', {
                prediction,
                rawConfidence: confidence,
                adjustedConfidence,
                symbol: prediction !== null ? ['♠', '♣', '♥', '♦'][prediction] : 'None'
            });

            return {
                prediction,
                confidence: adjustedConfidence,
                debug: {
                    transitionMatrix,
                    simulationResults: predictions,
                    validSimulations,
                    log: this.debugLog
                }
            };

        } catch (error) {
            console.error('[Monte Carlo] Analysis error:', error);
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
