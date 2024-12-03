const logger = require('./logger');

class PatternAnalyzer {
  constructor() {
    this.transitionMatrix = Array(4).fill().map(() => Array(4).fill(0));
  }

  // Calculate transition probabilities
  analyzeTransitions(sequence) {
    // Reset matrix
    this.transitionMatrix = Array(4).fill().map(() => Array(4).fill(0));
    
    // Count transitions
    for (let i = 0; i < sequence.length - 1; i++) {
      const current = sequence[i];
      const next = sequence[i + 1];
      this.transitionMatrix[current][next]++;
    }
    
    // Convert to probabilities
    const rowSums = this.transitionMatrix.map(row => 
      row.reduce((sum, count) => sum + count, 0)
    );
    
    return this.transitionMatrix.map((row, i) => 
      row.map(count => rowSums[i] ? count / rowSums[i] : 0)
    );
  }

  // Calculate sequence entropy
  calculateEntropy(sequence) {
    const frequencies = new Map();
    sequence.forEach(symbol => {
      frequencies.set(symbol, (frequencies.get(symbol) || 0) + 1);
    });
    
    return Array.from(frequencies.values()).reduce((entropy, freq) => {
      const p = freq / sequence.length;
      return entropy - (p * Math.log2(p));
    }, 0);
  }

  // Detect patterns using sliding window
  detectPatterns(sequence, windowSize = 3) {
    const patterns = new Map();
    
    for (let i = 0; i <= sequence.length - windowSize; i++) {
      const pattern = sequence.slice(i, i + windowSize).join('');
      patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
    }
    
    // Filter significant patterns (occurring more than random chance)
    const expectedFreq = sequence.length / Math.pow(4, windowSize);
    const significantPatterns = Array.from(patterns.entries())
      .filter(([_, freq]) => freq > expectedFreq * 2)
      .sort((a, b) => b[1] - a[1]);
    
    return significantPatterns;
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

  // Main analysis function
  async analyzeSequence(sequence) {
    try {
      const transitions = this.analyzeTransitions(sequence);
      const entropy = this.calculateEntropy(sequence);
      const patterns = this.detectPatterns(sequence);
      
      return {
        transitions,
        entropy,
        patterns,
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
}

module.exports = PatternAnalyzer;
