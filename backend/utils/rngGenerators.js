const { v4: uuidv4 } = require('uuid');

class RNGGenerator {
  constructor(seed) {
    this.seed = seed;
    this._batchId = uuidv4();
  }

  uuid() {
    return this._batchId;
  }

  // Linear Congruential Generator
  lcg(modulus = 2**31 - 1, multiplier = 1103515245, increment = 12345) {
    this.seed = (multiplier * this.seed + increment) % modulus;
    return this.seed;
  }

  // XORShift
  xorshift() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.seed = x;
    return Math.abs(x);
  }

  // Middle Square Weyl Sequence
  msws() {
    const x = this.seed * this.seed;
    const middle = Math.floor((x / 100) % 10000);
    this.seed = (this.seed + 0xb5ad4eceda1ce2a9n) % Number.MAX_SAFE_INTEGER;
    return middle;
  }

  generateSequence(type = 'lcg', length = 90) {
    const sequence = [];
    for (let i = 0; i < length; i++) {
      let num;
      switch(type.toLowerCase()) {
        case 'xorshift':
          num = this.xorshift();
          break;
        case 'msws':
          num = this.msws();
          break;
        case 'lcg':
        default:
          num = this.lcg();
      }
      // Map to 0-3 range for symbols
      sequence.push(num % 4);
    }
    return sequence;
  }
}

module.exports = RNGGenerator;
