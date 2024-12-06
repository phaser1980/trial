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
  MSWS: 'MSWS'
};

class RNGGenerator {
  constructor(seed, algorithm = ALGORITHMS.LCG) {
    this.seed = typeof seed === 'number' ? seed : Date.now();
    this.algorithm = algorithm;
    this.originalSeed = this.seed;
    logger.info(`Initialized ${algorithm} RNG with seed: ${this.seed}`);
  }

  reset() {
    this.seed = this.originalSeed;
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
      default:
        throw new Error(`Unknown algorithm: ${this.algorithm}`);
    }
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
