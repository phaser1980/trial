const express = require('express');
const router = express.Router();
const pool = require('../db');

// ModelManager Class for handling model weights and performance
class ModelManager {
  constructor() {
    // Model name mapping
    this.modelNameMap = {
      'markov chain': 'markovChain',
      'entropy analysis': 'entropy',
      'chi-square test': 'chiSquare',
      'monte carlo simulation': 'monteCarlo',
      'arima analysis': 'arima'
    };

    this.modelWeights = {
      markovChain: 1.0,
      entropy: 1.0,
      chiSquare: 1.0,
      monteCarlo: 1.0,
      arima: 1.0
    };
    this.recentAccuracy = {
      markovChain: [],
      entropy: [],
      chiSquare: [],
      monteCarlo: [],
      arima: []
    };
    this.confidenceScores = {
      markovChain: [],
      entropy: [],
      chiSquare: [],
      monteCarlo: [],
      arima: []
    };
    this.windowSize = 20;      // Number of recent predictions to consider
    this.learningRate = 0.1;   // Rate at which weights are adjusted
    this.minWeight = 0.2;      // Minimum weight for any model
    this.confidenceWeight = 0.3; // Weight given to confidence scores
  }

  // Map display name to internal name
  mapModelName(displayName) {
    const key = displayName.toLowerCase();
    return this.modelNameMap[key] || key;
  }

  // Update accuracy for a specific model
  updateAccuracy(modelName, predicted, actual, confidence = 0.25) {
    const mappedName = this.mapModelName(modelName);
    
    if (!this.recentAccuracy[mappedName]) {
      console.error(`Unknown model name: ${modelName} (mapped to: ${mappedName})`);
      return;
    }

    // Calculate weighted accuracy based on confidence
    const accuracy = predicted === actual ? 1 : 0;
    const weightedAccuracy = accuracy * (1 + this.confidenceWeight * (confidence - 0.25));
    
    this.recentAccuracy[mappedName].push(weightedAccuracy);
    this.confidenceScores[mappedName].push(confidence);
    
    // Keep only recent predictions
    if (this.recentAccuracy[mappedName].length > this.windowSize) {
      this.recentAccuracy[mappedName].shift();
      this.confidenceScores[mappedName].shift();
    }

    this.updateWeights();
  }

  // Calculate recent accuracy for a model with exponential decay
  getRecentAccuracy(modelName) {
    const mappedName = this.mapModelName(modelName);
    const accuracies = this.recentAccuracy[mappedName];
    const confidences = this.confidenceScores[mappedName];
    
    if (accuracies.length === 0) return 0.25; // Default accuracy for no data
    
    let weightedSum = 0;
    let weightSum = 0;
    const decayFactor = 0.9; // Exponential decay factor
    
    for (let i = accuracies.length - 1; i >= 0; i--) {
      const age = accuracies.length - 1 - i;
      const weight = Math.pow(decayFactor, age);
      const confidence = confidences[i];
      
      weightedSum += accuracies[i] * weight * (1 + this.confidenceWeight * (confidence - 0.25));
      weightSum += weight;
    }
    
    return weightedSum / weightSum;
  }

  // Update weights based on recent performance and confidence
  updateWeights() {
    const accuracies = {};
    let totalScore = 0;

    // Calculate accuracies and confidence-weighted scores
    for (const model in this.modelWeights) {
      const accuracy = this.getRecentAccuracy(model);
      const recentConfidences = this.confidenceScores[model].slice(-5);
      const avgConfidence = recentConfidences.length > 0 
        ? recentConfidences.reduce((a, b) => a + b, 0) / recentConfidences.length 
        : 0.25;
      
      accuracies[model] = accuracy * (1 + this.confidenceWeight * (avgConfidence - 0.25));
      totalScore += accuracies[model];
    }

    // Update weights based on relative performance
    if (totalScore > 0) {
      for (const model in this.modelWeights) {
        const targetWeight = accuracies[model] / totalScore;
        const weightDiff = targetWeight - this.modelWeights[model];
        
        // Adaptive learning rate based on performance stability
        const stability = this.calculateStability(model);
        const adaptiveLearningRate = this.learningRate * stability;
        
        this.modelWeights[model] += adaptiveLearningRate * weightDiff;
        this.modelWeights[model] = Math.max(this.modelWeights[model], this.minWeight);
      }

      // Normalize weights
      const totalWeight = Object.values(this.modelWeights).reduce((a, b) => a + b, 0);
      for (const model in this.modelWeights) {
        this.modelWeights[model] /= totalWeight;
      }
    }
  }

  // Calculate stability of model performance
  calculateStability(modelName) {
    const mappedName = this.mapModelName(modelName);
    const recentAccuracies = this.recentAccuracy[mappedName].slice(-5);
    if (recentAccuracies.length < 2) return 1.0;
    
    // Calculate variance in recent accuracies
    const mean = recentAccuracies.reduce((a, b) => a + b, 0) / recentAccuracies.length;
    const variance = recentAccuracies.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentAccuracies.length;
    
    // Higher stability (lower variance) means we can learn faster
    return 1.0 / (1.0 + variance);
  }

  // Get current weight for a model
  getWeight(modelName) {
    const mappedName = this.mapModelName(modelName);
    return this.modelWeights[mappedName];
  }

  // Check if models need retraining with improved metrics
  needsRetraining() {
    const recentMetrics = {};
    
    for (const model in this.modelWeights) {
      const recentAccuracies = this.recentAccuracy[model].slice(-5);
      const recentConfidences = this.confidenceScores[model].slice(-5);
      
      if (recentAccuracies.length >= 5) {
        const avgAccuracy = recentAccuracies.reduce((a, b) => a + b, 0) / recentAccuracies.length;
        const avgConfidence = recentConfidences.reduce((a, b) => a + b, 0) / recentConfidences.length;
        
        recentMetrics[model] = {
          accuracy: avgAccuracy,
          confidence: avgConfidence
        };
      }
    }
    
    // Check if any model is performing well
    const hasGoodPerformer = Object.values(recentMetrics).some(
      metrics => metrics.accuracy > 0.3 && metrics.confidence > 0.4
    );
    
    // If no model is performing well and we have enough data, suggest retraining
    return Object.keys(recentMetrics).length >= 3 && !hasGoodPerformer;
  }
}

// Initialize model manager
const modelManager = new ModelManager();

// Base class for all analysis tools
class AnalysisTool {
  constructor(name) {
    this.name = name;
    this.lastPrediction = null;
    this.predictionAccuracy = [];
    this.recentData = []; // Store recent data for sliding window
    this.maxRecentData = 50; // Maximum size of recent data window
  }

  updateAccuracy(predicted, actual) {
    if (this.lastPrediction !== null) {
      const accuracy = predicted === actual ? 1 : 0;
      this.predictionAccuracy.push(accuracy);
      // Use the original display name, let ModelManager handle the mapping
      modelManager.updateAccuracy(this.name, predicted, actual);
    }
  }

  getAverageAccuracy() {
    if (this.predictionAccuracy.length === 0) return 0;
    return this.predictionAccuracy.reduce((a, b) => a + b) / this.predictionAccuracy.length;
  }

  // Add new data point to recent data
  addToRecentData(symbol) {
    this.recentData.push(symbol);
    if (this.recentData.length > this.maxRecentData) {
      this.recentData.shift();
    }
  }

  // Get weight for this model
  getModelWeight() {
    return modelManager.getWeight(this.name);
  }
}

// MarkovChain Analysis
class MarkovChain extends AnalysisTool {
  constructor() {
    super('Markov Chain');
    this.transitionMatrix = {};
    this.recentWeight = 2.0; // Weight for recent transitions
    this.decayFactor = 0.95; // Decay factor for older transitions
  }

  analyze(symbols) {
    if (symbols.length < 2) {
      return { prediction: undefined, confidence: 0.25, accuracy: 0 };
    }

    // Update recent data
    this.recentData = symbols.slice(-this.maxRecentData);

    // Build transition matrix with emphasis on recent data
    this.transitionMatrix = {};
    let weight = 1.0;
    
    // Process symbols from oldest to newest with increasing weights
    for (let i = 0; i < symbols.length - 1; i++) {
      const current = symbols[i];
      const next = symbols[i + 1];
      
      if (!this.transitionMatrix[current]) {
        this.transitionMatrix[current] = {};
      }
      
      // Apply higher weight to recent transitions
      const isRecent = i >= symbols.length - this.maxRecentData;
      const transitionWeight = isRecent ? weight * this.recentWeight : weight;
      
      this.transitionMatrix[current][next] = 
        (this.transitionMatrix[current][next] || 0) + transitionWeight;
      
      // Increase weight for more recent transitions
      weight *= this.decayFactor;
    }

    // Normalize probabilities
    Object.keys(this.transitionMatrix).forEach(current => {
      const total = Object.values(this.transitionMatrix[current])
        .reduce((sum, count) => sum + count, 0);
      
      Object.keys(this.transitionMatrix[current]).forEach(next => {
        this.transitionMatrix[current][next] /= total;
      });
    });

    // Make prediction based on last symbol
    const lastSymbol = symbols[symbols.length - 1];
    let prediction = undefined;
    let maxProb = 0;

    if (this.transitionMatrix[lastSymbol]) {
      Object.entries(this.transitionMatrix[lastSymbol]).forEach(([next, prob]) => {
        if (prob > maxProb) {
          maxProb = prob;
          prediction = parseInt(next);
        }
      });
    }

    // Store prediction for accuracy tracking
    this.lastPrediction = prediction;

    return {
      matrix: this.transitionMatrix,
      prediction,
      confidence: maxProb * this.getModelWeight(),
      accuracy: this.getAverageAccuracy()
    };
  }
}

// EntropyAnalysis Class
class EntropyAnalysis extends AnalysisTool {
  constructor() {
    super('Entropy Analysis');
    this.slidingWindowSize = 30;
    this.entropyThreshold = 1.5; // Threshold for pattern detection
  }

  calculateEntropy(data) {
    const frequencies = {};
    data.forEach(symbol => {
      frequencies[symbol] = (frequencies[symbol] || 0) + 1;
    });

    return -Object.values(frequencies).reduce((sum, count) => {
      const p = count / data.length;
      return sum + p * Math.log2(p);
    }, 0);
  }

  detectPatterns(data) {
    const patterns = {};
    const maxPatternLength = 4;

    // Look for patterns of different lengths
    for (let len = 2; len <= maxPatternLength; len++) {
      for (let i = 0; i < data.length - len; i++) {
        const pattern = data.slice(i, i + len).join(',');
        const next = data[i + len];
        if (next !== undefined) {
          if (!patterns[pattern]) {
            patterns[pattern] = {};
          }
          patterns[pattern][next] = (patterns[pattern][next] || 0) + 1;
        }
      }
    }

    return patterns;
  }

  analyze(symbols) {
    if (symbols.length < this.slidingWindowSize) {
      return { entropy: 0, prediction: undefined, confidence: 0.25, accuracy: 0 };
    }

    // Update recent data
    this.recentData = symbols.slice(-this.maxRecentData);

    // Calculate entropy for recent window
    const recentWindow = symbols.slice(-this.slidingWindowSize);
    const entropy = this.calculateEntropy(recentWindow);

    // Detect patterns in recent data
    const patterns = this.detectPatterns(recentWindow);
    const lastFour = recentWindow.slice(-4).join(',');
    const lastThree = recentWindow.slice(-3).join(',');
    const lastTwo = recentWindow.slice(-2).join(',');

    let prediction;
    let confidence = 0.25;

    // Try to find matching patterns from longest to shortest
    if (patterns[lastFour]) {
      [prediction, confidence] = this.getMostLikelyNext(patterns[lastFour]);
    } else if (patterns[lastThree]) {
      [prediction, confidence] = this.getMostLikelyNext(patterns[lastThree]);
    } else if (patterns[lastTwo]) {
      [prediction, confidence] = this.getMostLikelyNext(patterns[lastTwo]);
    }

    // Adjust confidence based on entropy
    const entropyFactor = Math.max(0, 1 - entropy / this.entropyThreshold);
    confidence *= entropyFactor * this.getModelWeight();

    // Store prediction for accuracy tracking
    this.lastPrediction = prediction;

    return {
      entropy,
      prediction,
      confidence: confidence,
      accuracy: this.getAverageAccuracy()
    };
  }

  getMostLikelyNext(frequencies) {
    const total = Object.values(frequencies).reduce((a, b) => a + b, 0);
    let maxCount = 0;
    let prediction;

    for (const [symbol, count] of Object.entries(frequencies)) {
      if (count > maxCount) {
        maxCount = count;
        prediction = parseInt(symbol);
      }
    }

    return [prediction, maxCount / total];
  }
}

// ChiSquareTest Class
class ChiSquareTest extends AnalysisTool {
  constructor() {
    super('Chi-Square Test');
    this.windowSize = 40;
    this.expectedDistribution = { 0: 0.25, 1: 0.25, 2: 0.25, 3: 0.25 };
    this.adaptationRate = 0.1;
  }

  updateExpectedDistribution(observed) {
    const total = Object.values(observed).reduce((a, b) => a + b, 0);
    
    // Gradually adapt expected distribution
    for (let i = 0; i < 4; i++) {
      const observedProb = (observed[i] || 0) / total;
      this.expectedDistribution[i] = 
        (1 - this.adaptationRate) * this.expectedDistribution[i] + 
        this.adaptationRate * observedProb;
    }

    // Normalize to ensure probabilities sum to 1
    const sum = Object.values(this.expectedDistribution).reduce((a, b) => a + b, 0);
    for (let i = 0; i < 4; i++) {
      this.expectedDistribution[i] /= sum;
    }
  }

  analyze(symbols) {
    if (symbols.length === 0) {
      return { chiSquare: 0, prediction: undefined, confidence: 0.25, accuracy: 0 };
    }

    // Update recent data
    this.recentData = symbols.slice(-this.maxRecentData);

    // Get recent window
    const recentSymbols = symbols.slice(-this.windowSize);
    const n = recentSymbols.length;

    // Calculate observed frequencies
    const observed = {};
    recentSymbols.forEach(symbol => {
      observed[symbol] = (observed[symbol] || 0) + 1;
    });

    // Update expected distribution based on observed data
    this.updateExpectedDistribution(observed);

    // Calculate chi-square statistic
    let chiSquare = 0;
    for (let i = 0; i < 4; i++) {
      const observedCount = observed[i] || 0;
      const expectedCount = n * this.expectedDistribution[i];
      chiSquare += Math.pow(observedCount - expectedCount, 2) / expectedCount;
    }

    // Make prediction based on deviations from expected
    const lastSymbol = symbols[symbols.length - 1];
    const deviations = {};
    
    for (let i = 0; i < 4; i++) {
      const observedProb = (observed[i] || 0) / n;
      deviations[i] = observedProb - this.expectedDistribution[i];
    }

    // Predict the symbol that's most "due" based on deviations
    let prediction;
    let maxDeviation = -Infinity;
    
    for (let i = 0; i < 4; i++) {
      if (deviations[i] < maxDeviation) {  // Look for most underrepresented symbol
        maxDeviation = deviations[i];
        prediction = i;
      }
    }

    // Calculate confidence based on chi-square and model weight
    const confidence = Math.min(0.95, Math.max(0.25,
      (1 - Math.exp(-chiSquare / 10)) * this.getModelWeight()
    ));

    // Store prediction for accuracy tracking
    this.lastPrediction = prediction;

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
    this.patternLength = 3;
    this.adaptivePatterns = new Map();
    this.minPatternCount = 5;
  }

  updatePatterns(symbols) {
    // Update pattern frequencies
    for (let i = 0; i <= symbols.length - this.patternLength; i++) {
      const pattern = symbols.slice(i, i + this.patternLength).join(',');
      const next = symbols[i + this.patternLength];
      
      if (next !== undefined) {
        if (!this.adaptivePatterns.has(pattern)) {
          this.adaptivePatterns.set(pattern, new Map());
        }
        const outcomes = this.adaptivePatterns.get(pattern);
        outcomes.set(next, (outcomes.get(next) || 0) + 1);
      }
    }

    // Prune rare patterns to prevent overfitting
    for (const [pattern, outcomes] of this.adaptivePatterns) {
      const total = Array.from(outcomes.values()).reduce((a, b) => a + b, 0);
      if (total < this.minPatternCount) {
        this.adaptivePatterns.delete(pattern);
      }
    }
  }

  runSimulation(startPattern, numSteps = 1) {
    let currentPattern = startPattern;
    let result = [];

    for (let step = 0; step < numSteps; step++) {
      const outcomes = this.adaptivePatterns.get(currentPattern);
      
      if (!outcomes || outcomes.size === 0) {
        // If no pattern match, use random walk
        result.push(Math.floor(Math.random() * 4));
      } else {
        // Choose next symbol based on observed frequencies
        const total = Array.from(outcomes.values()).reduce((a, b) => a + b, 0);
        let rand = Math.random() * total;
        let chosen;
        
        for (const [symbol, count] of outcomes) {
          rand -= count;
          if (rand <= 0) {
            chosen = parseInt(symbol);
            break;
          }
        }
        
        result.push(chosen);
      }

      // Update current pattern
      currentPattern = [...currentPattern.split(',').slice(1), result[result.length - 1]].join(',');
    }

    return result;
  }

  analyze(symbols) {
    if (symbols.length < this.patternLength + 1) {
      return { simulations: 0, prediction: undefined, confidence: 0.25, accuracy: 0 };
    }

    // Update recent data
    this.recentData = symbols.slice(-this.maxRecentData);

    // Update pattern database
    this.updatePatterns(symbols);

    // Get current pattern
    const currentPattern = symbols.slice(-this.patternLength).join(',');
    
    // Run multiple simulations
    const predictions = new Map();
    let totalConfidence = 0;
    
    for (let i = 0; i < this.numSimulations; i++) {
      const simResult = this.runSimulation(currentPattern, 1)[0];
      predictions.set(simResult, (predictions.get(simResult) || 0) + 1);
    }

    // Find most frequent prediction
    let maxCount = 0;
    let prediction;
    
    for (const [symbol, count] of predictions) {
      if (count > maxCount) {
        maxCount = count;
        prediction = symbol;
      }
    }

    // Calculate confidence based on simulation consensus
    const confidence = (maxCount / this.numSimulations) * this.getModelWeight();

    // Store prediction for accuracy tracking
    this.lastPrediction = prediction;

    return {
      simulations: this.numSimulations,
      prediction,
      confidence,
      accuracy: this.getAverageAccuracy()
    };
  }
}

// ARIMAAnalysis Class
class ARIMAAnalysis extends AnalysisTool {
  constructor() {
    super('ARIMA Analysis');
    this.minDataPoints = 30; // Minimum data points needed for ARIMA
    this.p = 2;  // AR order
    this.d = 1;  // Difference order
    this.q = 2;  // MA order
  }

  // Calculate autocorrelation for different lags
  calculateAutocorrelation(data, lag) {
    const n = data.length;
    const mean = data.reduce((a, b) => a + b) / n;
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n - lag; i++) {
      numerator += (data[i] - mean) * (data[i + lag] - mean);
    }
    for (let i = 0; i < n; i++) {
      denominator += Math.pow(data[i] - mean, 2);
    }

    return numerator / denominator;
  }

  // Difference the time series
  differenceSeries(data, order = 1) {
    let diffed = [...data];
    for (let d = 0; d < order; d++) {
      const temp = [];
      for (let i = 1; i < diffed.length; i++) {
        temp.push(diffed[i] - diffed[i - 1]);
      }
      diffed = temp;
    }
    return diffed;
  }

  // Estimate AR parameters using Yule-Walker equations
  estimateARParameters(data, order) {
    const r = [];
    for (let i = 0; i <= order; i++) {
      r.push(this.calculateAutocorrelation(data, i));
    }

    // Create Toeplitz matrix
    const R = [];
    for (let i = 0; i < order; i++) {
      R.push([]);
      for (let j = 0; j < order; j++) {
        R[i][j] = r[Math.abs(i - j)];
      }
    }

    // Solve Yule-Walker equations using simple matrix inversion
    const b = r.slice(1, order + 1);
    // Simple matrix solver for demonstration
    // In production, use a proper linear algebra library
    const phi = this.solveLinearEquation(R, b);
    
    return phi;
  }

  // Simple matrix solver for demonstration
  solveLinearEquation(A, b) {
    const n = A.length;
    const x = new Array(n).fill(0);
    
    // Gaussian elimination (simplified)
    for (let i = 0; i < n; i++) {
      let maxEl = Math.abs(A[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > maxEl) {
          maxEl = Math.abs(A[k][i]);
          maxRow = k;
        }
      }

      for (let k = i; k < n; k++) {
        const tmp = A[maxRow][k];
        A[maxRow][k] = A[i][k];
        A[i][k] = tmp;
      }
      const tmp = b[maxRow];
      b[maxRow] = b[i];
      b[i] = tmp;

      for (let k = i + 1; k < n; k++) {
        const c = -A[k][i] / A[i][i];
        for (let j = i; j < n; j++) {
          if (i === j) {
            A[k][j] = 0;
          } else {
            A[k][j] += c * A[i][j];
          }
        }
        b[k] += c * b[i];
      }
    }

    // Back substitution
    for (let i = n - 1; i >= 0; i--) {
      x[i] = b[i] / A[i][i];
      for (let k = i - 1; k >= 0; k--) {
        b[k] -= A[k][i] * x[i];
      }
    }

    return x;
  }

  // Make prediction using AR parameters
  predictNext(data, arParams) {
    // Get the last few values for prediction
    const lastValues = data.slice(-arParams.length);
    
    // Calculate the AR prediction
    let prediction = 0;
    for (let i = 0; i < arParams.length; i++) {
      prediction += arParams[i] * lastValues[lastValues.length - 1 - i];
    }

    // If we're using differencing (d > 0), we need to integrate back
    if (this.d > 0) {
      // Add the last original value to get back to the original scale
      prediction += data[data.length - 1];
    }

    // Ensure prediction is within 0-3 range
    return Math.round(Math.abs(prediction)) % 4;
  }

  analyze(symbols) {
    if (symbols.length < this.minDataPoints) {
      return {
        prediction: undefined,
        confidence: 0.25,
        params: {},
        error: "Insufficient data for ARIMA analysis"
      };
    }

    try {
      // Convert symbols to numerical time series
      const timeSeries = symbols.map(Number);
      
      // Apply differencing
      const diffedSeries = this.differenceSeries(timeSeries, this.d);
      
      // Estimate AR parameters
      const arParams = this.estimateARParameters(diffedSeries, this.p);
      
      // Make prediction using the original series for proper integration
      const prediction = this.predictNext(timeSeries, arParams);
      
      // Calculate confidence based on autocorrelation
      const confidence = Math.abs(this.calculateAutocorrelation(diffedSeries, 1));
      
      // Store last prediction for accuracy tracking
      this.lastPrediction = prediction;
      
      return {
        prediction,
        confidence: Math.min(Math.max(confidence, 0.25), 0.95), // Bound confidence between 0.25 and 0.95
        params: {
          ar: arParams,
          d: this.d,
          ma: new Array(this.q).fill(0) // Simplified MA parameters
        }
      };
    } catch (error) {
      console.error('ARIMA Analysis error:', error);
      return {
        prediction: undefined,
        confidence: 0.25,
        params: {},
        error: error.message
      };
    }
  }
}

// Initialize analysis tools
const analysisTools = {
  markovChain: new MarkovChain(),
  entropy: new EntropyAnalysis(),
  chiSquare: new ChiSquareTest(),
  monteCarlo: new MonteCarloSimulation(),
  arima: new ARIMAAnalysis()
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
