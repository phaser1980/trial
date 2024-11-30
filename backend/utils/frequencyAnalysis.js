const AnalysisTool = require('./AnalysisTool');

class FrequencyAnalysis extends AnalysisTool {
    constructor() {
        super('Frequency Analysis');
        this.windowSize = 5;
        this.minSamples = 20;
        this.debugLog = [];
    }

    // Find patterns of given length
    findPatterns(sequence, length) {
        const patterns = new Map();
        
        for (let i = 0; i <= sequence.length - length; i++) {
            const pattern = sequence.slice(i, i + length).join(',');
            const next = sequence[i + length];
            
            if (next !== undefined) {
                if (!patterns.has(pattern)) {
                    patterns.set(pattern, new Map());
                }
                const nextCounts = patterns.get(pattern);
                nextCounts.set(next, (nextCounts.get(next) || 0) + 1);
            }
        }
        
        return patterns;
    }

    // Calculate symbol frequencies
    calculateFrequencies(sequence) {
        const frequencies = new Map();
        let total = 0;
        
        sequence.forEach(symbol => {
            frequencies.set(symbol, (frequencies.get(symbol) || 0) + 1);
            total++;
        });
        
        // Convert to probabilities
        frequencies.forEach((count, symbol) => {
            frequencies.set(symbol, count / total);
        });
        
        return frequencies;
    }

    // Find the most likely next symbol
    findMostLikely(patterns, frequencies) {
        const lastPattern = patterns[patterns.length - 1];
        const candidates = new Map();
        
        // Initialize with base frequencies
        frequencies.forEach((prob, symbol) => {
            candidates.set(symbol, prob);
        });
        
        // Adjust based on pattern matches
        for (let i = Math.min(this.windowSize, patterns.length); i > 0; i--) {
            const subPattern = patterns.slice(-i).join(',');
            const matches = this.patternMap.get(subPattern);
            
            if (matches) {
                let total = 0;
                matches.forEach(count => total += count);
                
                matches.forEach((count, symbol) => {
                    const weight = i / this.windowSize; // More weight to longer patterns
                    const oldProb = candidates.get(symbol) || 0;
                    const patternProb = count / total;
                    candidates.set(symbol, oldProb * (1 - weight) + patternProb * weight);
                });
            }
        }
        
        // Find symbol with highest probability
        let maxProb = 0;
        let prediction = null;
        
        candidates.forEach((prob, symbol) => {
            if (prob > maxProb) {
                maxProb = prob;
                prediction = symbol;
            }
        });
        
        return { prediction, confidence: maxProb };
    }

    async analyze(symbols) {
        try {
            this.debugLog = [];
            this.debugLog.push(`Starting Frequency Analysis with ${symbols.length} symbols`);

            if (symbols.length < this.minSamples) {
                this.debugLog.push(`Insufficient data: ${symbols.length} < ${this.minSamples}`);
                return {
                    prediction: null,
                    confidence: 0.25,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Calculate base frequencies
            const frequencies = this.calculateFrequencies(symbols);
            this.debugLog.push('Calculated base frequencies');

            // Find patterns of different lengths
            this.patternMap = this.findPatterns(symbols, this.windowSize);
            this.debugLog.push(`Found ${this.patternMap.size} unique patterns`);

            // Get prediction
            const { prediction, confidence } = this.findMostLikely(symbols, frequencies);
            const adjustedConfidence = Math.min(0.95, confidence * (1 + this.getAccuracy()));

            this.debugLog.push(`Prediction results:`, {
                prediction,
                rawConfidence: confidence,
                adjustedConfidence
            });

            // Update prediction history
            this.addPrediction(prediction);

            return {
                prediction,
                confidence: adjustedConfidence,
                debug: {
                    frequencies: Object.fromEntries(frequencies),
                    patternCount: this.patternMap.size,
                    log: this.debugLog
                }
            };

        } catch (error) {
            console.error('[Frequency] Analysis error:', error);
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

module.exports = FrequencyAnalysis;
