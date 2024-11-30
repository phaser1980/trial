const express = require('express');
const router = express.Router();
const pool = require('../db');

// Base class for all analysis tools
class AnalysisTool {
  constructor(name) {
    this.name = name;
    this.lastPrediction = null;
    this.predictionAccuracy = [];
  }

  updateAccuracy(predicted, actual) {
    if (this.lastPrediction !== null) {
      const accuracy = predicted === actual ? 1 : 0;
      this.predictionAccuracy.push(accuracy);
    }
  }

  getAverageAccuracy() {
    if (this.predictionAccuracy.length === 0) return 0;
    return this.predictionAccuracy.reduce((a, b) => a + b) / this.predictionAccuracy.length;
  }
}

// MarkovChain Analysis
class MarkovChain extends AnalysisTool {
  constructor() {
    super('Markov Chain');
    this.transitionMatrix = {};
  }

  analyze(symbols) {
    this.transitionMatrix = {};
    
    // Build transition matrix
    for (let i = 0; i < symbols.length - 1; i++) {
      const current = symbols[i];
      const next = symbols[i + 1];
      
      if (!this.transitionMatrix[current]) {
        this.transitionMatrix[current] = {};
      }
      
      this.transitionMatrix[current][next] = (this.transitionMatrix[current][next] || 0) + 1;
    }

    // Convert counts to probabilities
    Object.keys(this.transitionMatrix).forEach(current => {
      const total = Object.values(this.transitionMatrix[current])
        .reduce((sum, count) => sum + count, 0);
      
      Object.keys(this.transitionMatrix[current]).forEach(next => {
        this.transitionMatrix[current][next] = this.transitionMatrix[current][next] / total;
      });
    });

    // Make prediction based on highest probability
    const lastSymbol = symbols[symbols.length - 1];
    let prediction = { symbol: undefined, prob: 0 };

    if (this.transitionMatrix[lastSymbol]) {
      const transitions = this.transitionMatrix[lastSymbol];
      // Find the symbol with highest probability
      for (const [symbol, prob] of Object.entries(transitions)) {
        if (prob > prediction.prob) {
          prediction = { symbol: parseInt(symbol), prob };
        }
      }
    }

    // Only return a prediction if we have transition data
    return {
      matrix: this.transitionMatrix,
      prediction: prediction.symbol,
      confidence: prediction.prob,
      accuracy: this.getAverageAccuracy()
    };
  }
}

// EntropyAnalysis Class
class EntropyAnalysis extends AnalysisTool {
  constructor() {
    super('Entropy Analysis');
  }

  analyze(symbols) {
    if (symbols.length === 0) {
      return { entropy: 0, prediction: undefined, confidence: 0, accuracy: 0 };
    }

    const frequencies = {};
    symbols.forEach(symbol => {
      frequencies[symbol] = (frequencies[symbol] || 0) + 1;
    });

    // Calculate entropy
    const entropy = -Object.entries(frequencies).reduce((sum, [_, count]) => {
      const p = count / symbols.length;
      return sum + p * Math.log2(p);
    }, 0);

    // Predict next symbol based on highest frequency
    let maxCount = 0;
    let prediction;
    for (const [symbol, count] of Object.entries(frequencies)) {
      if (count > maxCount) {
        maxCount = count;
        prediction = parseInt(symbol);
      }
    }

    return {
      entropy,
      prediction,
      confidence: maxCount / symbols.length,
      accuracy: this.getAverageAccuracy()
    };
  }
}

// ChiSquareTest Class
class ChiSquareTest extends AnalysisTool {
  constructor() {
    super('Chi-Square Test');
  }

  analyze(symbols) {
    if (symbols.length === 0) {
      return { chiSquare: 0, prediction: undefined, confidence: 0, accuracy: 0 };
    }

    const observed = {};
    symbols.forEach(symbol => {
      observed[symbol] = (observed[symbol] || 0) + 1;
    });

    const n = symbols.length;
    const expected = 4; // We know there are 4 possible symbols
    const expectedFreq = n / expected;

    // Calculate chi-square statistic
    const chiSquare = Object.values(observed).reduce((sum, count) => {
      return sum + Math.pow(count - expectedFreq, 2) / expectedFreq;
    }, 0);

    // Find most frequent symbol for prediction
    let maxCount = 0;
    let prediction;
    for (const [symbol, count] of Object.entries(observed)) {
      if (count > maxCount) {
        maxCount = count;
        prediction = parseInt(symbol);
      }
    }

    // Normalize chi-square to get confidence
    const confidence = maxCount / n;

    return {
      chiSquare,
      prediction,
      confidence,
      accuracy: this.getAverageAccuracy()
    };
  }
}

// MonteCarloSimulation Class
class MonteCarloSimulation extends AnalysisTool {
  constructor() {
    super('Monte Carlo Simulation');
    this.numSimulations = 1000;
  }

  analyze(symbols) {
    if (symbols.length < 2) {
      return { simulations: 0, prediction: undefined, confidence: 0, accuracy: 0 };
    }

    // Count transitions in actual data
    const transitions = {};
    for (let i = 0; i < symbols.length - 1; i++) {
      const current = symbols[i];
      const next = symbols[i + 1];
      transitions[`${current}-${next}`] = (transitions[`${current}-${next}`] || 0) + 1;
    }

    // Get last symbol
    const lastSymbol = symbols[symbols.length - 1];
    
    // Count which symbol appears most often after lastSymbol
    const nextCounts = {};
    for (const [transition, count] of Object.entries(transitions)) {
      const [current, next] = transition.split('-');
      if (current === lastSymbol.toString()) {
        nextCounts[next] = (nextCounts[next] || 0) + count;
      }
    }

    // Find most likely next symbol
    let maxCount = 0;
    let prediction;
    for (const [symbol, count] of Object.entries(nextCounts)) {
      if (count > maxCount) {
        maxCount = count;
        prediction = parseInt(symbol);
      }
    }

    // Calculate confidence based on proportion of transitions
    const totalTransitions = Object.values(nextCounts).reduce((a, b) => a + b, 0);
    const confidence = totalTransitions > 0 ? maxCount / totalTransitions : 0;

    return {
      simulations: this.numSimulations,
      prediction,
      confidence,
      accuracy: this.getAverageAccuracy()
    };
  }
}

// Initialize analysis tools
const analysisTools = {
  markovChain: new MarkovChain(),
  entropy: new EntropyAnalysis(),
  chiSquare: new ChiSquareTest(),
  monteCarlo: new MonteCarloSimulation()
};

router.get('/', async (req, res) => {
  try {
    // Fetch symbols from the database
    const result = await pool.query('SELECT symbol FROM sequences ORDER BY created_at ASC');
    const symbols = result.rows.map(row => row.symbol);

    // If there are fewer than 2 symbols, return an early response
    if (symbols.length < 2) {
      return res.json({
        message: 'Need at least 2 symbols for analysis',
        symbols: symbols,
        analyses: {} 
      });
    }

    // Run all analyses if there are enough symbols
    const analyses = {};
    for (const [name, tool] of Object.entries(analysisTools)) {
      analyses[name] = tool.analyze(symbols);
      // Update accuracy if we have new data
      if (tool.lastPrediction !== null) {
        tool.updateAccuracy(tool.lastPrediction, symbols[symbols.length - 1]);
      }
    }

    // Send back the symbols and analysis results
    const response = {
      symbols: symbols.length,
      tools: Object.keys(analyses),
      analyses: analyses
    };
    
    console.log('Analysis results:', response);
    res.json(response);
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

module.exports = router;
