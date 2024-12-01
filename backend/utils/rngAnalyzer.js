const tf = require('@tensorflow/tfjs');
const AnalysisTool = require('./AnalysisTool');

class RNGAnalyzer extends AnalysisTool {
    constructor() {
        super('RNG Analyzer');
        this.knownGenerators = {
            'LCG': {
                a: 1103515245,
                c: 12345,
                m: 0x7fffffff
            },
            'XORShift': {
                a: 13,
                b: 17,
                c: 5
            }
        };
        this.seedHistory = [];
        this.currentSeed = null;
        this.seedConfidence = 0;
        this.patternWindow = 100;
        this.minPatternLength = 3;
        this.maxPatternLength = 8;
    }

    // Analyze sequence for RNG patterns and potential seeds
    async analyze(sequence) {
        if (sequence.length < this.minPatternLength) {
            return {
                seed: null,
                confidence: 0,
                type: null,
                analysis: 'Insufficient data'
            };
        }

        // Convert symbols to numbers if they're not already
        const numbers = sequence.map(s => typeof s === 'number' ? s : parseInt(s));

        // Analyze for different RNG types
        const results = await Promise.all([
            this.analyzeLCG(numbers),
            this.analyzeXORShift(numbers),
            this.analyzePatterns(numbers)
        ]);

        // Get the most confident result
        const bestResult = results.reduce((best, current) => {
            return (current.confidence > best.confidence) ? current : best;
        }, { confidence: 0 });

        // Update seed history if we have a good match
        if (bestResult.confidence > 0.8) {
            this.updateSeedHistory(bestResult);
        }

        return bestResult;
    }

    // Analyze sequence for Linear Congruential Generator patterns
    async analyzeLCG(numbers) {
        const lcg = this.knownGenerators.LCG;
        const potentialSeeds = new Set();
        let maxConfidence = 0;
        let bestSeed = null;

        // Try to reverse-engineer the seed
        for (let i = 0; i < numbers.length - 1; i++) {
            const current = numbers[i];
            const next = numbers[i + 1];
            
            // Try to find seeds that could generate this transition
            for (let seed = 0; seed < 1000; seed++) {
                const testSeq = this.generateLCGSequence(seed, 2);
                if (testSeq[0] === current && testSeq[1] === next) {
                    potentialSeeds.add(seed);
                }
            }
        }

        // Validate potential seeds
        for (const seed of potentialSeeds) {
            const testSequence = this.generateLCGSequence(seed, numbers.length);
            const confidence = this.calculateSequenceMatch(numbers, testSequence);
            
            if (confidence > maxConfidence) {
                maxConfidence = confidence;
                bestSeed = seed;
            }
        }

        return {
            type: 'LCG',
            seed: bestSeed,
            confidence: maxConfidence,
            analysis: `LCG with seed ${bestSeed}, confidence: ${maxConfidence.toFixed(2)}`
        };
    }

    // Generate sequence using LCG
    generateLCGSequence(seed, length) {
        const { a, c, m } = this.knownGenerators.LCG;
        const sequence = [];
        let value = seed;

        for (let i = 0; i < length; i++) {
            value = (a * value + c) % m;
            sequence.push(value % 4); // Map to 0-3 range
        }

        return sequence;
    }

    // Analyze sequence for XORShift patterns
    async analyzeXORShift(numbers) {
        const xor = this.knownGenerators.XORShift;
        const potentialStates = new Set();
        let maxConfidence = 0;
        let bestState = null;

        // Try to identify potential initial states
        for (let i = 0; i < numbers.length - 1; i++) {
            const current = numbers[i];
            const next = numbers[i + 1];
            
            for (let state = 0; state < 1000; state++) {
                const testSeq = this.generateXORShiftSequence(state, 2);
                if (testSeq[0] === current && testSeq[1] === next) {
                    potentialStates.add(state);
                }
            }
        }

        // Validate potential states
        for (const state of potentialStates) {
            const testSequence = this.generateXORShiftSequence(state, numbers.length);
            const confidence = this.calculateSequenceMatch(numbers, testSequence);
            
            if (confidence > maxConfidence) {
                maxConfidence = confidence;
                bestState = state;
            }
        }

        return {
            type: 'XORShift',
            seed: bestState,
            confidence: maxConfidence,
            analysis: `XORShift with state ${bestState}, confidence: ${maxConfidence.toFixed(2)}`
        };
    }

    // Generate sequence using XORShift
    generateXORShiftSequence(state, length) {
        const { a, b, c } = this.knownGenerators.XORShift;
        const sequence = [];
        let value = state || 1;

        for (let i = 0; i < length; i++) {
            value ^= (value << a);
            value ^= (value >> b);
            value ^= (value << c);
            sequence.push(Math.abs(value) % 4); // Map to 0-3 range
        }

        return sequence;
    }

    // Analyze for repeating patterns
    async analyzePatterns(numbers) {
        const patterns = new Map();
        let bestPattern = null;
        let maxConfidence = 0;

        // Look for patterns of different lengths
        for (let len = this.minPatternLength; len <= this.maxPatternLength; len++) {
            for (let i = 0; i <= numbers.length - len; i++) {
                const pattern = numbers.slice(i, i + len).join(',');
                patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
            }
        }

        // Analyze pattern frequencies
        for (const [pattern, count] of patterns.entries()) {
            const confidence = count / (numbers.length / pattern.split(',').length);
            if (confidence > maxConfidence) {
                maxConfidence = confidence;
                bestPattern = pattern;
            }
        }

        return {
            type: 'Pattern',
            pattern: bestPattern,
            confidence: maxConfidence,
            analysis: `Repeating pattern found: ${bestPattern}, confidence: ${maxConfidence.toFixed(2)}`
        };
    }

    // Calculate how well two sequences match
    calculateSequenceMatch(seq1, seq2) {
        const length = Math.min(seq1.length, seq2.length);
        let matches = 0;

        for (let i = 0; i < length; i++) {
            if (seq1[i] === seq2[i]) matches++;
        }

        return matches / length;
    }

    // Update seed history and detect changes
    updateSeedHistory(result) {
        const now = Date.now();
        this.seedHistory.push({
            timestamp: now,
            seed: result.seed,
            type: result.type,
            confidence: result.confidence
        });

        // Keep only recent history
        this.seedHistory = this.seedHistory.filter(
            entry => (now - entry.timestamp) < 24 * 60 * 60 * 1000 // 24 hours
        );

        // Check for seed changes
        if (this.currentSeed !== result.seed && result.confidence > 0.9) {
            console.log(`[RNG] Seed change detected: ${this.currentSeed} -> ${result.seed}`);
            this.currentSeed = result.seed;
            this.seedConfidence = result.confidence;
        }
    }

    // Get seed change analysis
    getSeedChangeAnalysis() {
        if (this.seedHistory.length < 2) return null;

        const changes = [];
        for (let i = 1; i < this.seedHistory.length; i++) {
            const prev = this.seedHistory[i - 1];
            const curr = this.seedHistory[i];
            
            if (prev.seed !== curr.seed) {
                changes.push({
                    timestamp: curr.timestamp,
                    oldSeed: prev.seed,
                    newSeed: curr.seed,
                    confidence: curr.confidence
                });
            }
        }

        return {
            changes,
            totalChanges: changes.length,
            averageConfidence: changes.reduce((sum, c) => sum + c.confidence, 0) / changes.length || 0
        };
    }
}

module.exports = RNGAnalyzer;
