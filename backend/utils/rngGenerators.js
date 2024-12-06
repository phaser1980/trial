const { v4: uuidv4 } = require('uuid');

class RNGGenerator {
  constructor(seed) {
    this.seed = typeof seed === 'number' ? seed : Date.now();
    this._batchId = uuidv4();
    this.type = 'lcg'; // default type
  }

  uuid() {
    return this._batchId;
  }

  // Linear Congruential Generator
  lcg(modulus = 2**31 - 1, multiplier = 1103515245, increment = 12345) {
    this.seed = (multiplier * this.seed + increment) % modulus;
    return this.seed / modulus; // Return normalized value between 0 and 1
  }

  // XORShift
  xorshift() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.seed = x;
    return Math.abs(x) / Number.MAX_SAFE_INTEGER; // Normalize
  }

  // Middle Square Weyl Sequence
  msws() {
    const x = this.seed * this.seed;
    const middle = Math.floor((x / 100) % 10000);
    this.seed = (this.seed + 0xb5ad4eceda1ce2a9n) % Number.MAX_SAFE_INTEGER;
    return middle / 10000; // Normalize
  }

  setType(type) {
    if (!['lcg', 'xorshift', 'msws'].includes(type.toLowerCase())) {
      throw new Error('Invalid RNG type. Must be one of: lcg, xorshift, msws');
    }
    this.type = type.toLowerCase();
    return this;
  }

  next() {
    let value;
    switch(this.type) {
      case 'xorshift':
        value = this.xorshift();
        break;
      case 'msws':
        value = this.msws();
        break;
      case 'lcg':
      default:
        value = this.lcg();
    }
    return value;
  }

  // Generate integer between min (inclusive) and max (inclusive)
  nextInt(min = 0, max = Number.MAX_SAFE_INTEGER) {
    const range = max - min + 1;
    return Math.floor(this.next() * range) + min;
  }

  generateSequence(type = 'lcg', length = 90) {
    this.setType(type);
    const sequence = [];
    for (let i = 0; i < length; i++) {
      sequence.push(this.next());
    }
    return sequence;
  }
}

module.exports = RNGGenerator;
