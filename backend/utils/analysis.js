const math = require('mathjs');

// Calculate Shannon entropy of a sequence
const calculateEntropy = (sequence) => {
  const frequencies = {};
  sequence.forEach(symbol => {
    frequencies[symbol] = (frequencies[symbol] || 0) + 1;
  });

  return Object.values(frequencies).reduce((entropy, freq) => {
    const p = freq / sequence.length;
    return entropy - (p * Math.log2(p));
  }, 0);
};

// Calculate transition probability matrix
const calculateTransitionMatrix = (sequence) => {
  const matrix = Array(4).fill().map(() => Array(4).fill(0));
  const counts = Array(4).fill().map(() => Array(4).fill(0));

  // Count transitions
  for (let i = 0; i < sequence.length - 1; i++) {
    const current = sequence[i];
    const next = sequence[i + 1];
    counts[current][next]++;
  }

  // Calculate probabilities
  for (let i = 0; i < 4; i++) {
    const rowSum = counts[i].reduce((a, b) => a + b, 0);
    if (rowSum > 0) {
      for (let j = 0; j < 4; j++) {
        matrix[i][j] = counts[i][j] / rowSum;
      }
    }
  }

  return matrix;
};

// Detect patterns using autocorrelation
const detectPatterns = (sequence) => {
  const maxLag = Math.min(20, Math.floor(sequence.length / 2));
  const correlations = [];

  for (let lag = 1; lag <= maxLag; lag++) {
    let correlation = 0;
    let n = sequence.length - lag;

    for (let i = 0; i < n; i++) {
      correlation += sequence[i] * sequence[i + lag];
    }

    correlation /= n;
    correlations.push({
      lag,
      correlation
    });
  }

  // Find significant patterns
  const mean = math.mean(correlations.map(c => c.correlation));
  const stdDev = math.std(correlations.map(c => c.correlation));
  
  const significantPatterns = correlations.filter(c => 
    Math.abs(c.correlation - mean) > 2 * stdDev
  );

  return {
    correlations,
    significantPatterns,
    patternConfidence: significantPatterns.length > 0 ? 
      Math.max(...significantPatterns.map(p => Math.abs(p.correlation - mean) / stdDev)) / 3 : 0
  };
};

// Predict next symbol using recent history and transition matrix
const predictNextSymbol = (sequence) => {
  if (sequence.length < 2) {
    return {
      prediction: null,
      confidence: 0
    };
  }

  const matrix = calculateTransitionMatrix(sequence);
  const lastSymbol = sequence[sequence.length - 1];
  
  // Get probabilities for next symbol
  const probabilities = matrix[lastSymbol];
  
  // Find most likely next symbol
  let maxProb = 0;
  let prediction = null;
  
  probabilities.forEach((prob, symbol) => {
    if (prob > maxProb) {
      maxProb = prob;
      prediction = symbol;
    }
  });

  return {
    prediction,
    confidence: maxProb,
    probabilities
  };
};

// Analyze pattern for a sequence
const analyzePattern = (sequence) => {
  const patterns = detectPatterns(sequence);
  const prediction = predictNextSymbol(sequence);

  return {
    predictability: prediction.confidence,
    patternConfidence: patterns.patternConfidence
  };
};

module.exports = {
  calculateEntropy,
  calculateTransitionMatrix,
  detectPatterns,
  predictNextSymbol,
  analyzePattern
};
