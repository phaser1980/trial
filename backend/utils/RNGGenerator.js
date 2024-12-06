const logger = require('./logger');

class RNGGenerator {
  constructor(seed, algorithm = 'LCG') {
    this.seed = typeof seed === 'number' ? seed : Date.now();
    this.algorithm = algorithm;
    this.originalSeed = this.seed; // Store original seed for reset
    logger.info(`Initialized ${algorithm} RNG with seed: ${this.seed}`);
  }

  reset() {
    this.seed = this.originalSeed;
    logger.info(`Reset ${this.algorithm} RNG to original seed: ${this.seed}`);
  }

  next() {
    switch (this.algorithm) {
      case 'LCG':
        return this.lcg();
      case 'XORShift':
        return this.xorshift();
      case 'MSWS':
        return this.msws();
      default:
        throw new Error(`Unknown algorithm: ${this.algorithm}`);
    }
  }

  // Linear Congruential Generator
  lcg() {
    // Using parameters from glibc
    const a = 1103515245;
    const c = 12345;
    const m = 2147483648; // 2^31
    this.seed = (a * this.seed + c) % m;
    return Math.abs(this.seed) % 4; // Map to 0-3 range
  }

  // XORShift
  xorshift() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.seed = x;
    return Math.abs(x) % 4; // Map to 0-3 range
  }

  // Middle Square Weyl Sequence
  msws() {
    const weylSequence = 0xb5ad4eceda1ce2a9n; // Large odd constant
    let x = BigInt(this.seed);
    x *= x;
    x = (x >> 32n) & 0xffffffffn; // Middle 32 bits
    this.seed = Number(x);
    return Number(x % 4n); // Map to 0-3 range
  }

  // Generate a sequence of n numbers
  generateSequence(length) {
    return Array.from({ length }, () => this.next());
  }
}

module.exports = RNGGenerator;
