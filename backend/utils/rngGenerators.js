const { v4: uuidv4 } = require('uuid');

class RNGGenerator {
  constructor(seed) {
    this.seed = seed;
    this._batchId = uuidv4();
    this.type = 'lcg'; // default type
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

  setType(type) {
    this.type = type.toLowerCase();
    return this;
  }

  next() {
    switch(this.type) {
      case 'xorshift':
        return this.xorshift();
      case 'msws':
        return this.msws();
      case 'lcg':
      default:
        return this.lcg();
    }
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
