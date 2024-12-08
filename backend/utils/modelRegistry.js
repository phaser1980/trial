const tf = require('@tensorflow/tfjs');

// Base class for prediction models
class BaseModel {
    constructor(name) {
        this.name = name;
    }

    async analyze(sequence) {
        throw new Error('analyze() must be implemented by subclass');
    }
}

// Pattern detection model
class PatternModel extends BaseModel {
    constructor() {
        super('pattern_detector');
    }

    async analyze(sequence) {
        if (!Array.isArray(sequence) || sequence.length < 2) {
            return null;
        }

        // Simple pattern detection: look for repeating subsequences
        const lastFew = sequence.slice(-4);
        const repeats = this.findRepeatingPattern(lastFew);

        if (repeats) {
            return {
                prediction: repeats.nextValue,
                confidence: repeats.confidence,
                debug: { pattern: repeats.pattern }
            };
        }

        return null;
    }

    findRepeatingPattern(sequence) {
        // Look for patterns of length 2-3
        for (let len = 2; len <= 3; len++) {
            const pattern = sequence.slice(-len);
            const previousPattern = sequence.slice(-2 * len, -len);
            
            if (pattern.length === len && 
                previousPattern.length === len &&
                pattern.every((v, i) => v === previousPattern[i])) {
                
                return {
                    pattern: pattern,
                    nextValue: pattern[0],
                    confidence: 0.7 + (len - 2) * 0.1
                };
            }
        }
        return null;
    }
}

// Frequency analysis model
class FrequencyModel extends BaseModel {
    constructor() {
        super('frequency_analyzer');
    }

    async analyze(sequence) {
        if (!Array.isArray(sequence) || sequence.length < 5) {
            return null;
        }

        // Analyze recent frequency distribution
        const recentSequence = sequence.slice(-10);
        const frequencies = new Array(4).fill(0);
        recentSequence.forEach(symbol => frequencies[symbol]++);

        // Find least frequent symbol
        const minFreq = Math.min(...frequencies);
        const candidates = frequencies
            .map((freq, symbol) => ({ symbol, freq }))
            .filter(item => item.freq === minFreq);

        if (candidates.length === 1) {
            return {
                prediction: candidates[0].symbol,
                confidence: 0.6 + (minFreq === 0 ? 0.2 : 0),
                debug: { frequencies }
            };
        }

        return null;
    }
}

// Transition probability model
class TransitionModel extends BaseModel {
    constructor() {
        super('transition_predictor');
    }

    async analyze(sequence) {
        if (!Array.isArray(sequence) || sequence.length < 3) {
            return null;
        }

        // Build transition matrix from recent history
        const transitions = Array(4).fill(0).map(() => Array(4).fill(0));
        for (let i = 0; i < sequence.length - 1; i++) {
            transitions[sequence[i]][sequence[i + 1]]++;
        }

        const lastSymbol = sequence[sequence.length - 1];
        const transitionCounts = transitions[lastSymbol];
        const totalTransitions = transitionCounts.reduce((a, b) => a + b, 0);

        if (totalTransitions > 0) {
            // Find most likely next symbol
            const maxCount = Math.max(...transitionCounts);
            const prediction = transitionCounts.indexOf(maxCount);
            const confidence = maxCount / totalTransitions;

            if (confidence > 0.4) {
                return {
                    prediction,
                    confidence: 0.5 + confidence * 0.4,
                    debug: { transitions }
                };
            }
        }

        return null;
    }
}

class ModelRegistry {
    constructor() {
        this.models = new Map();
        this.initializeModels();
    }

    initializeModels() {
        // Add our prediction models
        this.addModel(new PatternModel());
        this.addModel(new FrequencyModel());
        this.addModel(new TransitionModel());
    }

    addModel(model) {
        this.models.set(model.name, model);
    }

    getModel(name) {
        return this.models.get(name);
    }

    getAllModels() {
        return Array.from(this.models.values());
    }
}

// Create and export a singleton instance
const modelRegistry = new ModelRegistry();
module.exports = modelRegistry;
