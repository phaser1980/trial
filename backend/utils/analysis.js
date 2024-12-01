const math = require('mathjs');

// Calculate entropy of a sequence
const calculateEntropy = (symbols) => {
    const windowSize = 3;
    const frequencies = new Map();
    const patterns = new Map();
    let totalPatterns = 0;

    // Calculate pattern frequencies with sliding window
    for (let i = 0; i <= symbols.length - windowSize; i++) {
        const pattern = symbols.slice(i, i + windowSize).join(',');
        patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
        totalPatterns++;

        // Track individual symbol frequencies
        const symbol = symbols[i];
        frequencies.set(symbol, (frequencies.get(symbol) || 0) + 1);
    }

    // Calculate pattern entropy
    let patternEntropy = 0;
    patterns.forEach(count => {
        const probability = count / totalPatterns;
        patternEntropy -= probability * Math.log2(probability);
    });

    // Calculate symbol entropy
    let symbolEntropy = 0;
    frequencies.forEach(count => {
        const probability = count / symbols.length;
        symbolEntropy -= probability * Math.log2(probability);
    });

    // Normalize entropies
    const maxPatternEntropy = Math.log2(Math.pow(4, windowSize)); // Maximum possible entropy for patterns
    const maxSymbolEntropy = Math.log2(4); // Maximum possible entropy for individual symbols

    const normalizedPatternEntropy = patternEntropy / maxPatternEntropy;
    const normalizedSymbolEntropy = symbolEntropy / maxSymbolEntropy;

    // Detect non-randomness
    const entropyDifference = Math.abs(normalizedPatternEntropy - normalizedSymbolEntropy);
    const patternStrength = 1 - normalizedPatternEntropy; // Higher when patterns are present

    // Calculate prediction confidence
    const confidence = Math.min(0.95, Math.max(0.25, 
        0.5 + (entropyDifference * 0.3) + (patternStrength * 0.2)
    ));

    // Find most likely next symbol based on pattern matching
    let prediction = null;
    let maxPatternCount = 0;
    const lastPattern = symbols.slice(-windowSize + 1).join(',');

    patterns.forEach((count, pattern) => {
        if (pattern.startsWith(lastPattern) && count > maxPatternCount) {
            maxPatternCount = count;
            prediction = Number(pattern.split(',').pop());
        }
    });

    return {
        prediction,
        confidence,
        entropy: normalizedPatternEntropy,
        patternStrength,
        debug: {
            symbolEntropy: normalizedSymbolEntropy,
            patternEntropy: normalizedPatternEntropy,
            entropyDifference,
            uniquePatterns: patterns.size,
            totalPatterns
        }
    };
};

// Perform Chi-Square test for randomness
const performChiSquareTest = (symbols) => {
    const windowSize = 3;
    const observed = new Map();
    const expected = new Map();
    let totalPatterns = 0;

    // Calculate observed frequencies of patterns
    for (let i = 0; i <= symbols.length - windowSize; i++) {
        const pattern = symbols.slice(i, i + windowSize).join(',');
        observed.set(pattern, (observed.get(pattern) || 0) + 1);
        totalPatterns++;
    }

    // Calculate expected frequencies (uniform distribution)
    const expectedFrequency = totalPatterns / Math.pow(4, windowSize);
    observed.forEach((_, pattern) => {
        expected.set(pattern, expectedFrequency);
    });

    // Calculate Chi-Square statistic
    let chiSquare = 0;
    observed.forEach((observedCount, pattern) => {
        const expectedCount = expected.get(pattern);
        chiSquare += Math.pow(observedCount - expectedCount, 2) / expectedCount;
    });

    // Calculate degrees of freedom
    const degreesOfFreedom = Math.pow(4, windowSize) - 1;

    // Calculate p-value using chi-square distribution
    const pValue = 1 - math.chi2.cdf(chiSquare, degreesOfFreedom);

    // Find most likely next pattern
    let prediction = null;
    let maxCount = 0;
    const lastPattern = symbols.slice(-windowSize + 1).join(',');

    observed.forEach((count, pattern) => {
        if (pattern.startsWith(lastPattern) && count > maxCount) {
            maxCount = count;
            prediction = Number(pattern.split(',').pop());
        }
    });

    // Calculate confidence based on multiple factors
    const nonRandomnessStrength = 1 - pValue; // Higher when sequence is less random
    const patternStrength = maxCount / totalPatterns;
    const recentDataWeight = Math.min(1, symbols.length / 500);

    const confidence = Math.min(0.95, Math.max(0.25,
        (nonRandomnessStrength * 0.4) +
        (patternStrength * 0.4) +
        (recentDataWeight * 0.2)
    ));

    return {
        prediction,
        confidence,
        isRandom: pValue > 0.05,
        debug: {
            chiSquare,
            pValue,
            degreesOfFreedom,
            observedPatterns: observed.size,
            totalPatterns,
            nonRandomnessStrength,
            patternStrength
        }
    };
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

// Detect patterns in a sequence
const detectPatterns = (symbols) => {
    const results = {
        entropy: calculateEntropy(symbols),
        chiSquare: performChiSquareTest(symbols),
        transitionMatrix: calculateTransitionMatrix(symbols)
    };

    // Combine predictions and confidences
    const predictions = [
        { pred: results.entropy.prediction, conf: results.entropy.confidence },
        { pred: results.chiSquare.prediction, conf: results.chiSquare.confidence }
    ];

    // Weight predictions by confidence
    let bestPrediction = null;
    let maxConfidence = 0;

    predictions.forEach(({ pred, conf }) => {
        if (pred !== null && conf > maxConfidence) {
            maxConfidence = conf;
            bestPrediction = pred;
        }
    });

    return {
        prediction: bestPrediction,
        confidence: maxConfidence,
        analysis: results
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
    patternConfidence: patterns.confidence
  };
};

module.exports = {
  calculateEntropy,
  performChiSquareTest,
  calculateTransitionMatrix,
  detectPatterns,
  predictNextSymbol,
  analyzePattern
};
