const logger = require('./logger');

const SYMBOLS = {
  HEART: 0,
  DIAMOND: 1,
  CLUB: 2,
  SPADE: 3
};

const ALGORITHMS = {
  LCG: 'LCG',
  XORShift: 'XORShift',
  MSWS: 'MSWS',
  HYBRID: 'HYBRID'
};

class RNGGenerator {
  constructor(seed, algorithm = ALGORITHMS.LCG) {
    this.seed = typeof seed === 'number' ? seed : Date.now();
    this.algorithm = algorithm;
    this.originalSeed = this.seed;
    this.transitionHistory = new Array(4).fill(null).map(() => new Array(4).fill(0));
    this.symbolHistory = [];
    this.algorithmWeights = {
      [ALGORITHMS.LCG]: 0.33,
      [ALGORITHMS.XORShift]: 0.33,
      [ALGORITHMS.MSWS]: 0.34
    };
    logger.info(`Initialized ${algorithm} RNG with seed: ${this.seed}`);
  }

  reset() {
    this.seed = this.originalSeed;
    this.transitionHistory = new Array(4).fill(null).map(() => new Array(4).fill(0));
    this.symbolHistory = [];
    logger.info(`Reset ${this.algorithm} RNG to original seed: ${this.seed}`);
  }

  next() {
    let result;
    switch (this.algorithm) {
      case ALGORITHMS.LCG:
        result = this.lcg();
        break;
      case ALGORITHMS.XORShift:
        result = this.xorshift();
        break;
      case ALGORITHMS.MSWS:
        result = this.msws();
        break;
      case ALGORITHMS.HYBRID:
        result = this.hybrid();
        break;
      default:
        throw new Error(`Unknown algorithm: ${this.algorithm}`);
    }
    
    // Update transition history
    if (this.symbolHistory.length > 0) {
      const lastSymbol = this.symbolHistory[this.symbolHistory.length - 1];
      this.transitionHistory[lastSymbol][result]++;
    }
    this.symbolHistory.push(result);
    
    logger.debug(`Generated symbol: ${result} using ${this.algorithm}`);
    return result;
  }

  // Linear Congruential Generator
  lcg() {
    // Using parameters from Numerical Recipes
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    this.seed = (a * this.seed + c) % m;
    return Math.abs(this.seed >> 16) % 4; // Better randomization by using upper bits
  }

  // XORShift
  xorshift() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.seed = x;
    return Math.abs(x) % 4;
  }

  // Middle Square Weyl Sequence
  msws() {
    const weylSequence = 0xb5ad4eceda1ce2a9n;
    let x = BigInt(this.seed);
    x *= x;
    x = (x >> 32n) & 0xffffffffn;
    this.seed = Number(x);
    return Number(x % 4n);
  }

  // Hybrid mode combining multiple algorithms
  hybrid() {
    const random = Math.random();
    let cumulativeWeight = 0;
    
    for (const [algo, weight] of Object.entries(this.algorithmWeights)) {
      cumulativeWeight += weight;
      if (random <= cumulativeWeight) {
        switch (algo) {
          case ALGORITHMS.LCG:
            return this.lcg();
          case ALGORITHMS.XORShift:
            return this.xorshift();
          case ALGORITHMS.MSWS:
            return this.msws();
        }
      }
    }
    return this.lcg(); // Fallback to LCG
  }

  // Generate a sequence of n numbers with validation
  generateSequence(length) {
    if (!Number.isInteger(length) || length < 1) {
      throw new Error('Length must be a positive integer');
    }

    const sequence = Array.from({ length }, () => this.next());
    
    // Validate sequence randomness
    const distribution = sequence.reduce((acc, val) => {
      acc[val] = (acc[val] || 0) + 1;
      return acc;
    }, {});

    logger.info('Sequence distribution:', distribution);
    
    return sequence;
  }

  // Update algorithm weights based on entropy performance
  updateWeights(entropyScores) {
    const total = Object.values(entropyScores).reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (const [algo, score] of Object.entries(entropyScores)) {
        this.algorithmWeights[algo] = score / total;
      }
      logger.info('Updated algorithm weights:', this.algorithmWeights);
    }
  }

  getTransitionMatrix() {
    const total = this.symbolHistory.length;
    return this.transitionHistory.map(row => {
      const rowSum = row.reduce((a, b) => a + b, 0);
      return row.map(count => rowSum > 0 ? count / rowSum : 0);
    });
  }

  getPrediction() {
    if (this.symbolHistory.length < 3) {
      return { symbol: null, confidence: 0 };
    }

    const lastSymbol = this.symbolHistory[this.symbolHistory.length - 1];
    const transitions = this.transitionHistory[lastSymbol];
    const totalTransitions = transitions.reduce((a, b) => a + b, 0);
    
    if (totalTransitions === 0) {
      return { symbol: null, confidence: 0 };
    }

    const probabilities = transitions.map(count => count / totalTransitions);
    const maxProb = Math.max(...probabilities);
    const predictedSymbol = probabilities.indexOf(maxProb);

    return {
      symbol: predictedSymbol,
      confidence: maxProb,
      transitionMatrix: this.getTransitionMatrix()
    };
  }

  static getSymbolName(value) {
    return Object.keys(SYMBOLS).find(key => SYMBOLS[key] === value) || 'UNKNOWN';
  }

  static get algorithms() {
    return Object.values(ALGORITHMS);
  }

  static get symbols() {
    return SYMBOLS;
  }
}

module.exports = RNGGenerator;
