const logger = require('./logger');

class PatternAnalyzer {
  constructor() {
    this.transitionMatrix = Array(4).fill().map(() => Array(4).fill(0));
  }

  // Main analysis method that combines all analysis types
  async analyzeSequence(sequence) {
    if (!Array.isArray(sequence)) {
      throw new Error('Invalid sequence: must be an array');
    }

    if (sequence.length < 2) {
      throw new Error('Invalid sequence: must have at least 2 elements');
    }

    if (!sequence.every(n => Number.isInteger(n) && n >= 0 && n < 4)) {
      throw new Error('Invalid sequence: all elements must be integers between 0 and 3');
    }

    try {
      const transitions = this.analyzeTransitions(sequence);
      const entropy = this.calculateEntropy(sequence);
      const patterns = this.detectPatterns(sequence);

      return {
        transitions,
        entropy,
        patterns: Array.from(patterns.entries()),
        metadata: {
          length: sequence.length,
          uniqueSymbols: new Set(sequence).size,
          timestamp: new Date()
        }
      };
    } catch (error) {
      logger.error('Error in pattern analysis:', error);
      throw error;
    }
  }

  // Calculate transition probabilities
  analyzeTransitions(sequence) {
    if (!Array.isArray(sequence) || sequence.length < 2) {
      return Array(4).fill().map(() => Array(4).fill(0.25)); // Return uniform distribution
    }

    // Reset matrix
    this.transitionMatrix = Array(4).fill().map(() => Array(4).fill(0));
    
    try {
      // Count transitions
      for (let i = 0; i < sequence.length - 1; i++) {
        const current = sequence[i];
        const next = sequence[i + 1];
        
        if (current >= 0 && current < 4 && next >= 0 && next < 4) {
          this.transitionMatrix[current][next]++;
        }
      }
      
      // Convert to probabilities
      const rowSums = this.transitionMatrix.map(row => 
        row.reduce((sum, count) => sum + count, 0)
      );
      
      return this.transitionMatrix.map((row, i) => 
        row.map(count => rowSums[i] ? count / rowSums[i] : 0.25)
      );
    } catch (error) {
      logger.error('Error in transition analysis:', error);
      return Array(4).fill().map(() => Array(4).fill(0.25)); // Return uniform distribution on error
    }
  }

  // Calculate sequence entropy
  calculateEntropy(sequence) {
    if (!Array.isArray(sequence) || sequence.length === 0) {
      return 0;
    }

    const frequencies = new Map();
    sequence.forEach(symbol => {
      if (symbol >= 0 && symbol < 4) {
        frequencies.set(symbol, (frequencies.get(symbol) || 0) + 1);
      }
    });
    
    return Array.from(frequencies.values()).reduce((entropy, freq) => {
      const p = freq / sequence.length;
      return entropy - (p * Math.log2(p));
    }, 0);
  }

  // Detect patterns using sliding window
  detectPatterns(sequence, windowSize = 3) {
    if (!Array.isArray(sequence) || sequence.length < windowSize) {
      return new Map();
    }

    const patterns = new Map();
    
    for (let i = 0; i <= sequence.length - windowSize; i++) {
      const window = sequence.slice(i, i + windowSize);
      if (window.every(n => n >= 0 && n < 4)) {
        const pattern = window.join('');
        patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
      }
    }
    
    // Convert counts to frequencies
    const totalPatterns = Array.from(patterns.values()).reduce((sum, count) => sum + count, 0);
    for (const [pattern, count] of patterns) {
      patterns.set(pattern, count / totalPatterns);
    }
    
    return patterns;
  }

  // Calculate similarity between sequences
  calculateSimilarity(seq1, seq2) {
    const trans1 = this.analyzeTransitions(seq1);
    const trans2 = this.analyzeTransitions(seq2);
    
    // Calculate Frobenius norm of difference
    let sumSquaredDiff = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const diff = trans1[i][j] - trans2[i][j];
        sumSquaredDiff += diff * diff;
      }
    }
    
    return 1 / (1 + Math.sqrt(sumSquaredDiff));
  }
}

module.exports = PatternAnalyzer;
