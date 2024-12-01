const AnalysisTool = require('./AnalysisTool');
const logger = require('./logger');

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
        this.symbolMap = ['♠', '♥', '♦', '♣']; // Map numeric indices to symbols
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
            
            if (current < 0 || current >= this.numSymbols || next < 0 || next >= this.numSymbols) {
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
        const normalizedMatrix = {};
        for (const from in matrix) {
            normalizedMatrix[from] = {};
            const totalCount = counts[from];
            const smoothingFactor = Math.max(0.1, Math.min(1, totalCount / 100));
            
            for (const to in matrix[from]) {
                if (totalCount === 0) {
                    normalizedMatrix[from][to] = 1 / this.numSymbols;
                } else {
                    // Apply adaptive smoothing
                    const rawProb = matrix[from][to] / totalCount;
                    normalizedMatrix[from][to] = (rawProb * smoothingFactor) + ((1 / this.numSymbols) * (1 - smoothingFactor));
                }
            }
        }

        // Log transition matrix for debugging
        this.debugLog.push({
            type: 'transition_matrix',
            raw: matrix,
            normalized: normalizedMatrix,
            counts
        });

        return normalizedMatrix;
    }

    // Run a single simulation
    runSimulation(transitionMatrix, startSymbol, length) {
        let sequence = [startSymbol];
        let debug = { steps: [] };
        
        for (let i = 0; i < length - 1; i++) {
            const current = sequence[sequence.length - 1];
            const probabilities = transitionMatrix[current];
            
            if (!probabilities) {
                logger.error('[Monte Carlo] No probabilities for symbol:', current);
                return { sequence: null, debug };
            }
            
            // Generate next symbol based on probabilities
            const rand = Math.random();
            let cumProb = 0;
            let nextSymbol = null;
            
            for (let j = 0; j < this.numSymbols; j++) {
                cumProb += probabilities[j];
                if (rand < cumProb && nextSymbol === null) {
                    nextSymbol = j;
                }
            }
            
            if (nextSymbol === null) {
                nextSymbol = this.numSymbols - 1; // Default to last symbol if something goes wrong
            }
            
            sequence.push(nextSymbol);
            debug.steps.push({
                current: this.symbolMap[current],
                next: this.symbolMap[nextSymbol],
                probabilities: Object.fromEntries(
                    Object.entries(probabilities).map(([k, v]) => [this.symbolMap[k], v])
                ),
                random: rand
            });
        }
        
        return { sequence, debug };
    }

    // Calculate entropy of a sequence
    calculateEntropy(probabilities) {
        let entropy = 0;
        for (const p of probabilities) {
            if (p > 0) {
                entropy -= p * Math.log2(p);
            }
        }
        return entropy;
    }

    // Look for potential seed patterns
    analyzeSeedPatterns(symbols) {
        const patternLength = 4; // Look for 4-symbol patterns
        const patterns = new Map();

        for (let i = 0; i <= symbols.length - patternLength; i++) {
            const pattern = symbols.slice(i, i + patternLength);
            const patternKey = pattern.join(',');
            const displayPattern = pattern.map(s => this.symbolMap[s]).join('');
            
            if (!patterns.has(patternKey)) {
                patterns.set(patternKey, { 
                    pattern: displayPattern,
                    count: 0, 
                    positions: [] 
                });
            }
            patterns.get(patternKey).count++;
            patterns.get(patternKey).positions.push(i);
        }

        // Find patterns that appear more frequently than random chance
        const expectedFrequency = symbols.length / Math.pow(this.numSymbols, patternLength);
        const significantPatterns = Array.from(patterns.entries())
            .filter(([_, data]) => data.count > expectedFrequency * 1.5)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([key, data]) => ({
                pattern: data.pattern,
                count: data.count,
                positions: data.positions,
                frequency: data.count / symbols.length
            }));

        this.debugLog.push({
            type: 'patterns',
            significant: significantPatterns,
            expectedFrequency
        });

        return significantPatterns;
    }

    async analyze(symbols) {
        try {
            this.debugLog = [];
            logger.debug('[Monte Carlo] Starting analysis', { symbolCount: symbols.length });
            
            if (symbols.length < this.minSamples) {
                logger.warn('[Monte Carlo] Insufficient data length:', symbols.length);
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
            const significantPatterns = this.analyzeSeedPatterns(symbols);
            
            // Run simulations
            const predictions = new Array(this.numSymbols).fill(0);
            let validSimulations = 0;
            let maxPatternMatch = 0;
            const simulationDebug = [];

            logger.debug('[Monte Carlo] Starting simulations', {
                total: this.simulationCount,
                startSymbol: this.symbolMap[recentPattern[recentPattern.length - 1]]
            });

            for (let i = 0; i < this.simulationCount; i++) {
                const { sequence, debug } = this.runSimulation(
                    transitionMatrix, 
                    recentPattern[recentPattern.length - 1], 
                    2
                );

                if (!sequence) {
                    logger.warn('[Monte Carlo] Invalid simulation result at iteration:', i);
                    continue;
                }

                if (sequence.length === 2) {
                    const predictedSymbol = sequence[1];
                    if (predictedSymbol >= 0 && predictedSymbol < this.numSymbols) {
                        predictions[predictedSymbol]++;
                        validSimulations++;
                        
                        // Check if this matches a known pattern
                        const simPattern = [...recentPattern.slice(1), sequence[1]].join(',');
                        const patternCount = this.seedCandidates.get(simPattern) || 0;
                        maxPatternMatch = Math.max(maxPatternMatch, patternCount);

                        if (i < 10) { // Store first 10 simulations for debugging
                            simulationDebug.push({
                                simulation: i + 1,
                                sequence: sequence.map(s => this.symbolMap[s]),
                                ...debug
                            });
                        }
                    } else {
                        logger.warn('[Monte Carlo] Invalid predicted symbol:', predictedSymbol);
                    }
                } else {
                    logger.warn('[Monte Carlo] Unexpected sequence length:', sequence.length);
                }
            }

            this.debugLog.push({
                type: 'simulations',
                total: this.simulationCount,
                valid: validSimulations,
                examples: simulationDebug
            });

            if (validSimulations === 0) {
                logger.warn('[Monte Carlo] No valid simulations');
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'No valid simulations',
                    debug: this.debugLog
                };
            }

            // Calculate prediction probabilities
            const probabilities = predictions.map(count => count / validSimulations);
            const maxProb = Math.max(...probabilities);
            const prediction = probabilities.indexOf(maxProb);

            // Handle NaN values
            if (isNaN(maxProb) || isNaN(prediction)) {
                logger.error('[Monte Carlo] NaN values detected in prediction', {
                    maxProb,
                    prediction,
                    probabilities
                });
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Invalid prediction values',
                    debug: this.debugLog
                };
            }

            // Calculate entropy-based confidence
            const entropy = this.calculateEntropy(probabilities);
            const normalizedEntropy = entropy / Math.log2(this.numSymbols);
            const entropyConfidence = 1 - normalizedEntropy;

            // Calculate pattern confidence
            const patternConfidence = Math.min(0.95, maxPatternMatch / (symbols.length / 10));

            // Combine confidence metrics with weighted average
            const confidence = Math.min(0.95, Math.max(0.25,
                (maxProb * 0.4) + (entropyConfidence * 0.4) + (patternConfidence * 0.2)
            ));

            // Add final prediction details to debug log
            const predictionDebug = {
                type: 'prediction',
                probabilities: Object.fromEntries(
                    probabilities.map((p, i) => [this.symbolMap[i], p])
                ),
                entropy: {
                    raw: entropy,
                    normalized: normalizedEntropy,
                    confidence: entropyConfidence
                },
                pattern: {
                    maxMatch: maxPatternMatch,
                    confidence: patternConfidence
                },
                final: {
                    prediction: this.symbolMap[prediction],
                    confidence,
                    components: {
                        probability: maxProb,
                        entropy: entropyConfidence,
                        pattern: patternConfidence
                    }
                }
            };

            this.debugLog.push(predictionDebug);

            logger.info('[Monte Carlo] Analysis complete', {
                prediction: this.symbolMap[prediction],
                confidence,
                validSimulations,
                probabilities: predictionDebug.probabilities
            });

            return {
                prediction,
                confidence,
                probabilities: predictionDebug.probabilities,
                debug: this.debugLog
            };

        } catch (error) {
            logger.error('[Monte Carlo] Analysis Error:', error);
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
