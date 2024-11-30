const express = require('express');
const router = express.Router();
const pool = require('../db');

// ModelManager Class for handling model weights and performance
class ModelManager {
  constructor() {
    // Model name mapping (using exact keys that match the analysisTools object)
    this.modelNameMap = {
      'markov chain': 'markovChain',
      'entropy analysis': 'entropy',
      'chi-square test': 'chiSquare',
      'monte carlo simulation': 'monteCarlo',
      'arima analysis': 'arima',
      'lstm analysis': 'lstm',
      'hmm analysis': 'hmm'
    };

    // Reverse mapping for tool names to display names
    this.displayNames = {
      markovChain: 'Markov Chain',
      entropy: 'Entropy Analysis',
      chiSquare: 'Chi-Square Test',
      monteCarlo: 'Monte Carlo Simulation',
      arima: 'ARIMA Analysis',
      lstm: 'LSTM Analysis',
      hmm: 'HMM Analysis'
    };

    this.modelWeights = {
      markovChain: 1.0,
      entropy: 1.0,
      chiSquare: 1.0,
      monteCarlo: 1.0,
      arima: 1.0,
      lstm: 1.0,
      hmm: 1.0
    };
    this.recentAccuracy = {
      markovChain: [],
      entropy: [],
      chiSquare: [],
      monteCarlo: [],
      arima: [],
      lstm: [],
      hmm: []
    };
    this.confidenceScores = {
      markovChain: [],
      entropy: [],
      chiSquare: [],
      monteCarlo: [],
      arima: [],
      lstm: [],
      hmm: []
    };
    this.windowSize = 20;      // Number of recent predictions to consider
    this.learningRate = 0.1;   // Rate at which weights are adjusted
    this.minWeight = 0.2;      // Minimum weight for any model
    this.confidenceWeight = 0.3; // Weight given to confidence scores
  }

  // Map display name to internal name
  mapModelName(displayName) {
    if (!displayName) {
      console.error('Undefined model name passed to mapModelName');
      return 'markovChain'; // Default to markovChain if undefined
    }

    // First try direct mapping if it's a tool name
    if (this.modelWeights.hasOwnProperty(displayName)) {
      return displayName;
    }

    // Then try to map from display name
    const key = displayName.toLowerCase();
    const mappedName = this.modelNameMap[key];
    
    if (!mappedName) {
      console.error(`No mapping found for model name: ${displayName}`);
      // Try to match the case-insensitive version of the key
      const toolKey = Object.keys(this.modelWeights)
        .find(k => k.toLowerCase() === displayName.toLowerCase());
      return toolKey || displayName;
    }
    
    return mappedName;
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
    
    // Safety check for undefined model
    if (!this.recentAccuracy[mappedName]) {
      console.error(`Unknown model name in getRecentAccuracy: ${modelName} (mapped to: ${mappedName})`);
      return 0.25; // Default accuracy for unknown model
    }
    
    const accuracies = this.recentAccuracy[mappedName];
    const confidences = this.confidenceScores[mappedName];
    
    if (!accuracies || !confidences || accuracies.length === 0) {
      return 0.25; // Default accuracy for no data
    }
    
    let weightedSum = 0;
    let weightSum = 0;
    const decayFactor = 0.9; // Exponential decay factor
    
    for (let i = accuracies.length - 1; i >= 0; i--) {
      const age = accuracies.length - 1 - i;
      const weight = Math.pow(decayFactor, age);
      const confidence = confidences[i] || 0.25; // Default confidence if undefined
      
      weightedSum += accuracies[i] * weight * (1 + this.confidenceWeight * (confidence - 0.25));
      weightSum += weight;
    }
    
    return weightSum > 0 ? weightedSum / weightSum : 0.25;
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
    const mean = recentAccuracies.reduce((a, b) => a + b) / recentAccuracies.length;
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
    
    // Map display names to internal names
    const displayToInternal = {
      'Markov Chain': 'markovChain',
      'Entropy Analysis': 'entropy',
      'Chi-Square Test': 'chiSquare',
      'Monte Carlo Simulation': 'monteCarlo',
      'ARIMA Analysis': 'arima',
      'LSTM Analysis': 'lstm',
      'HMM Analysis': 'hmm'
    };
    
    // Get the internal name for this model
    this.internalName = displayToInternal[name] || name.toLowerCase().replace(/\s+/g, '');
    
    // Initialize debug logging
    this.debugLog = [];
    this.maxLogEntries = 100;
    
    this.learningRate = 0.1;
    this.confidenceThreshold = 0.6;
    this.updateCounter = 0;
    this.performanceHistory = [];
    this.lastUpdateTime = Date.now();
    
    // Performance tracking
    this.successStreak = 0;
    this.totalPredictions = 0;
    this.weightAdjustmentFactor = 1.0;
  }

  logState(data) {
    const entry = {
      timestamp: new Date().toISOString(),
      modelState: this.getModelState(),
      inputData: data,
      prediction: this.lastPrediction,
      accuracy: this.getAverageAccuracy(),
      confidence: this.getCurrentConfidence()
    };
    
    this.debugLog.unshift(entry);
    if (this.debugLog.length > this.maxLogEntries) {
      this.debugLog.pop();
    }
    
    console.log(`[${this.name}] State Update:`, entry);
  }

  getModelState() {
    return {
      learningRate: this.learningRate,
      successStreak: this.successStreak,
      weightAdjustment: this.weightAdjustmentFactor,
      recentDataSize: this.recentData.length
    };
  }

  updateLearningRate() {
    // Adjust learning rate based on performance
    const recentAccuracy = this.getRecentAccuracy(10);
    if (recentAccuracy > 0.8) {
      this.learningRate = Math.max(0.05, this.learningRate * 0.95); // Slow down learning when performing well
    } else if (recentAccuracy < 0.4) {
      this.learningRate = Math.min(0.3, this.learningRate * 1.05); // Speed up learning when performing poorly
    }
  }

  getCurrentConfidence() {
    const recentAccuracy = this.getRecentAccuracy(5);
    const stabilityFactor = this.calculateStabilityFactor();
    const dataQualityFactor = this.recentData.length / this.maxRecentData;
    
    return Math.min(1, recentAccuracy * stabilityFactor * dataQualityFactor);
  }

  calculateStabilityFactor() {
    if (this.predictionAccuracy.length < 5) return 0.5;
    
    // Calculate variance in recent predictions
    const recent = this.predictionAccuracy.slice(-5);
    const mean = recent.reduce((a, b) => a + b) / recent.length;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    
    return 1 - Math.min(1, variance * 2); // Lower variance = higher stability
  }

  getRecentAccuracy(window = 10) {
    const recent = this.predictionAccuracy.slice(-window);
    if (recent.length === 0) return 0;
    return recent.reduce((a, b) => a + b) / recent.length;
  }

  updateAccuracy(predicted, actual) {
    if (this.lastPrediction !== null) {
      const accuracy = predicted === actual ? 1 : 0;
      this.predictionAccuracy.push(accuracy);
      this.totalPredictions++;
      
      // Update success streak
      if (accuracy === 1) {
        this.successStreak++;
        this.weightAdjustmentFactor = Math.min(2.0, this.weightAdjustmentFactor * 1.05);
      } else {
        this.successStreak = 0;
        this.weightAdjustmentFactor = Math.max(0.5, this.weightAdjustmentFactor * 0.95);
      }
      
      // Calculate confidence with new factors
      const confidence = this.getCurrentConfidence();
      
      // Update learning rate
      this.updateLearningRate();
      
      // Log state after update
      this.logState(actual);
      
      modelManager.updateAccuracy(this.internalName, predicted, actual, confidence);
    }
  }

  getAverageAccuracy() {
    if (this.predictionAccuracy.length === 0) return 0;
    return this.predictionAccuracy.reduce((a, b) => a + b) / this.predictionAccuracy.length;
  }

  addToRecentData(symbol) {
    this.recentData.push(symbol);
    if (this.recentData.length > this.maxRecentData) {
      this.recentData.shift();
    }
  }

  getModelWeight() {
    return modelManager.getWeight(this.internalName);
  }
}

// MarkovChain Analysis
class MarkovChain extends AnalysisTool {
  constructor() {
    super('Markov Chain');
    this.transitionMatrix = {};
    this.recentWeight = 2.0; // Weight for recent transitions
    this.decayFactor = 0.95; // Decay factor for older transitions
    this.smoothingFactor = 0.1;
  }
  
  getModelState() {
    return {
      ...super.getModelState(),
      transitionMatrix: this.transitionMatrix,
      smoothingFactor: this.smoothingFactor
    };
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
    this.entropyWindow = 20;
    this.recentEntropies = [];
  }
  
  getModelState() {
    return {
      ...super.getModelState(),
      entropyWindow: this.entropyWindow,
      recentEntropies: this.recentEntropies
    };
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
    this.expectedFrequencies = {};
    this.observedFrequencies = {};
  }
  
  getModelState() {
    return {
      ...super.getModelState(),
      expectedFrequencies: this.expectedFrequencies,
      observedFrequencies: this.observedFrequencies
    };
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
    this.patternWeights = {};
  }
  
  getModelState() {
    return {
      ...super.getModelState(),
      numSimulations: this.numSimulations,
      patternWeights: this.patternWeights
    };
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
    this.config = { p: 1, d: 0, q: 1 };
    this.lastTraining = Date.now();
    this.retrainingInterval = 1000 * 60; // 1 minute
  }
  
  getModelState() {
    return {
      ...super.getModelState(),
      config: this.config,
      timeSinceTraining: Date.now() - this.lastTraining
    };
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

// LSTM Analysis
class LSTMAnalysis extends AnalysisTool {
  constructor() {
    super('LSTM Analysis');
    this.sequenceLength = 10;
    this.model = null;
    this.isTraining = false;
    this.symbolMap = new Map();
    this.reverseSymbolMap = new Map();
    this.trainingBuffer = [];
    this.minTrainingSize = 50; // Reduced from 100
    this.lastPredictions = [];
    this.outputSize = 4; // Fixed size for card symbols
    this.initialized = false;
  }

  async initializeModel() {
    if (this.initialized) return;

    try {
      this.model = tf.sequential();
      this.model.add(tf.layers.lstm({
        units: 64, // Reduced from 128
        inputShape: [this.sequenceLength, 1],
        returnSequences: false
      }));
      this.model.add(tf.layers.dense({
        units: 32, // Reduced from 64
        activation: 'relu'
      }));
      this.model.add(tf.layers.dropout(0.1)); // Reduced dropout
      this.model.add(tf.layers.dense({
        units: this.outputSize,
        activation: 'softmax'
      }));

      this.model.compile({
        optimizer: tf.train.adam(0.005), // Increased learning rate
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      });

      this.initialized = true;
      console.log('[LSTM] Model initialized');
    } catch (error) {
      console.error('[LSTM] Initialization error:', error);
      this.initialized = false;
    }
  }

  preprocessData(symbols) {
    // Map symbols to numerical values (0-3)
    const symbolToIndex = {'♠': 0, '♣': 1, '♥': 2, '♦': 3};
    return symbols.map(s => symbolToIndex[s] !== undefined ? symbolToIndex[s] : 0);
  }

  async train(symbols) {
    if (this.isTraining || symbols.length < this.minTrainingSize) return;
    
    try {
      this.isTraining = true;
      await this.initializeModel();

      const normalizedData = this.preprocessData(symbols);
      
      // Prepare sequences for training
      const sequences = [];
      const targets = [];
      
      for (let i = 0; i < normalizedData.length - this.sequenceLength - 1; i++) {
        const sequence = normalizedData.slice(i, i + this.sequenceLength);
        const target = normalizedData[i + this.sequenceLength];
        sequences.push(sequence);
        targets.push(target);
      }

      // Convert to tensors
      const inputTensor = tf.tensor3d(sequences, [sequences.length, this.sequenceLength, 1]);
      const targetTensor = tf.tensor2d(targets.map(t => {
        const arr = new Array(this.outputSize).fill(0);
        arr[t] = 1;
        return arr;
      }));

      // Train the model
      await this.model.fit(inputTensor, targetTensor, {
        epochs: 5, // Reduced from 10
        batchSize: 16, // Reduced from 32
        shuffle: true,
        verbose: 1 // Added verbosity
      });

      console.log('[LSTM] Training completed');
      
      // Cleanup
      inputTensor.dispose();
      targetTensor.dispose();
      
    } catch (error) {
      console.error('[LSTM] Training error:', error);
    } finally {
      this.isTraining = false;
    }
  }

  async predict(sequence) {
    if (!this.initialized || sequence.length < this.sequenceLength) {
      return { prediction: null, confidence: 0.25 };
    }

    try {
      const normalizedData = this.preprocessData(sequence);
      const inputSequence = normalizedData.slice(-this.sequenceLength);
      const inputTensor = tf.tensor3d([inputSequence], [1, this.sequenceLength, 1]);
      
      const prediction = await this.model.predict(inputTensor).array();
      inputTensor.dispose();

      const probabilities = prediction[0];
      const maxProbIndex = probabilities.indexOf(Math.max(...probabilities));
      const symbols = ['♠', '♣', '♥', '♦'];
      const predictedSymbol = symbols[maxProbIndex];
      const confidence = probabilities[maxProbIndex];

      this.lastPredictions = probabilities;

      return {
        prediction: predictedSymbol,
        confidence: confidence,
        probabilities: probabilities
      };
    } catch (error) {
      console.error('[LSTM] Prediction error:', error);
      return { prediction: null, confidence: 0.25 };
    }
  }

  async analyze(symbols) {
    try {
      // Add to training buffer
      this.trainingBuffer.push(...symbols);
      if (this.trainingBuffer.length >= this.minTrainingSize) {
        await this.train(this.trainingBuffer);
        this.trainingBuffer = this.trainingBuffer.slice(-this.sequenceLength * 2);
      }

      const result = await this.predict(symbols);
      this.lastPrediction = result.prediction;
      return result;
    } catch (error) {
      console.error('[LSTM] Analysis error:', error);
      return { prediction: null, confidence: 0.25 };
    }
  }

  getModelState() {
    return {
      ...super.getModelState(),
      sequenceLength: this.sequenceLength,
      isTraining: this.isTraining,
      modelInitialized: this.initialized,
      trainingBufferSize: this.trainingBuffer.length,
      lastPredictions: this.lastPredictions
    };
  }
}

// Custom HMM implementation
class HMMModel {
  constructor(numStates, numObservations) {
    this.numStates = numStates;
    this.numObservations = numObservations;
    this.initialProb = new Array(numStates).fill(1/numStates);
    this.transitionProb = Array(numStates).fill().map(() => 
      new Array(numStates).fill(1/numStates)
    );
    this.emissionProb = Array(numStates).fill().map(() => 
      new Array(numObservations).fill(1/numObservations)
    );
  }

  forward(observations) {
    const T = observations.length;
    const alpha = Array(T).fill().map(() => new Array(this.numStates).fill(0));
    
    // Initialize
    for (let i = 0; i < this.numStates; i++) {
      alpha[0][i] = this.initialProb[i] * this.emissionProb[i][observations[0]];
    }
    
    // Forward recursion
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < this.numStates; j++) {
        let sum = 0;
        for (let i = 0; i < this.numStates; i++) {
          sum += alpha[t-1][i] * this.transitionProb[i][j];
        }
        alpha[t][j] = sum * this.emissionProb[j][observations[t]];
      }
    }
    
    return alpha;
  }

  backward(observations) {
    const T = observations.length;
    const beta = Array(T).fill().map(() => new Array(this.numStates).fill(0));
    
    // Initialize
    for (let i = 0; i < this.numStates; i++) {
      beta[T-1][i] = 1;
    }
    
    // Backward recursion
    for (let t = T-2; t >= 0; t--) {
      for (let i = 0; i < this.numStates; i++) {
        let sum = 0;
        for (let j = 0; j < this.numStates; j++) {
          sum += this.transitionProb[i][j] * this.emissionProb[j][observations[t+1]] * beta[t+1][j];
        }
        beta[t][i] = sum;
      }
    }
    
    return beta;
  }

  viterbi(observations) {
    const T = observations.length;
    const delta = Array(T).fill().map(() => new Array(this.numStates).fill(0));
    const psi = Array(T).fill().map(() => new Array(this.numStates).fill(0));
    
    // Initialize
    for (let i = 0; i < this.numStates; i++) {
      delta[0][i] = this.initialProb[i] * this.emissionProb[i][observations[0]];
      psi[0][i] = 0;
    }
    
    // Recursion
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < this.numStates; j++) {
        let maxVal = -Infinity;
        let maxIndex = 0;
        
        for (let i = 0; i < this.numStates; i++) {
          const val = delta[t-1][i] * this.transitionProb[i][j];
          if (val > maxVal) {
            maxVal = val;
            maxIndex = i;
          }
        }
        
        delta[t][j] = maxVal * this.emissionProb[j][observations[t]];
        psi[t][j] = maxIndex;
      }
    }
    
    // Backtrack
    const path = new Array(T);
    let maxVal = -Infinity;
    let maxIndex = 0;
    
    for (let i = 0; i < this.numStates; i++) {
      if (delta[T-1][i] > maxVal) {
        maxVal = delta[T-1][i];
        maxIndex = i;
      }
    }
    
    path[T-1] = maxIndex;
    for (let t = T-2; t >= 0; t--) {
      path[t] = psi[t+1][path[t+1]];
    }
    
    return path;
  }

  train(observations, maxIterations = 100, tolerance = 0.001) {
    let oldLogProb = -Infinity;
    
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // E-step
      const alpha = this.forward(observations);
      const beta = this.backward(observations);
      
      // Calculate gamma and xi
      const T = observations.length;
      const gamma = Array(T).fill().map(() => new Array(this.numStates).fill(0));
      const xi = Array(T-1).fill().map(() => 
        Array(this.numStates).fill().map(() => new Array(this.numStates).fill(0))
      );
      
      // Calculate gamma
      for (let t = 0; t < T; t++) {
        let sum = 0;
        for (let i = 0; i < this.numStates; i++) {
          gamma[t][i] = alpha[t][i] * beta[t][i];
          sum += gamma[t][i];
        }
        for (let i = 0; i < this.numStates; i++) {
          gamma[t][i] /= sum;
        }
      }
      
      // Calculate xi
      for (let t = 0; t < T-1; t++) {
        let sum = 0;
        for (let i = 0; i < this.numStates; i++) {
          for (let j = 0; j < this.numStates; j++) {
            xi[t][i][j] = alpha[t][i] * this.transitionProb[i][j] * 
                         this.emissionProb[j][observations[t+1]] * beta[t+1][j];
            sum += xi[t][i][j];
          }
        }
        for (let i = 0; i < this.numStates; i++) {
          for (let j = 0; j < this.numStates; j++) {
            xi[t][i][j] /= sum;
          }
        }
      }
      
      // M-step
      // Update initial probabilities
      for (let i = 0; i < this.numStates; i++) {
        this.initialProb[i] = gamma[0][i];
      }
      
      // Update transition probabilities
      for (let i = 0; i < this.numStates; i++) {
        for (let j = 0; j < this.numStates; j++) {
          let numerator = 0;
          let denominator = 0;
          for (let t = 0; t < T-1; t++) {
            numerator += xi[t][i][j];
            denominator += gamma[t][i];
          }
          this.transitionProb[i][j] = numerator / denominator;
        }
      }
      
      // Update emission probabilities
      for (let i = 0; i < this.numStates; i++) {
        for (let k = 0; k < this.numObservations; k++) {
          let numerator = 0;
          let denominator = 0;
          for (let t = 0; t < T; t++) {
            if (observations[t] === k) {
              numerator += gamma[t][i];
            }
            denominator += gamma[t][i];
          }
          this.emissionProb[i][k] = numerator / denominator;
        }
      }
      
      // Check for convergence
      let logProb = 0;
      for (let i = 0; i < this.numStates; i++) {
        logProb += alpha[T-1][i];
      }
      logProb = Math.log(logProb);
      
      if (Math.abs(logProb - oldLogProb) < tolerance) {
        break;
      }
      oldLogProb = logProb;
    }
  }
}

// HMM Analysis
class HMMAnalysis extends AnalysisTool {
  constructor() {
    super('HMM Analysis');
    this.numStates = 4;
    this.numObservations = 4;
    this.model = null;
    this.minSequenceLength = 20;
    this.trainingBuffer = [];
    this.initialized = false;
    this.stateHistory = [];
  }

  initializeModel() {
    if (this.initialized) return;
    this.model = new HMMModel(this.numStates, this.numObservations);
    this.initialized = true;
    console.log('[HMM] Model initialized');
  }

  preprocessData(symbols) {
    // Map symbols directly to observation indices
    const symbolToIndex = {'♠': 0, '♣': 1, '♥': 2, '♦': 3};
    return symbols.map(s => symbolToIndex[s] !== undefined ? symbolToIndex[s] : 0);
  }

  train(symbols) {
    if (symbols.length < this.minSequenceLength) return;

    try {
      this.initializeModel();
      const observations = this.preprocessData(symbols);
      
      // Train the model
      this.model.train(observations, 50, 0.001); // Reduced iterations
      console.log('[HMM] Training completed');
    } catch (error) {
      console.error('[HMM] Training error:', error);
    }
  }

  predict(sequence) {
    if (!this.initialized || sequence.length < 2) {
      return { prediction: null, confidence: 0.25 };
    }

    try {
      const observations = this.preprocessData(sequence);
      const viterbiPath = this.model.viterbi(observations);
      const lastState = viterbiPath[viterbiPath.length - 1];
      
      // Get emission probabilities for the predicted state
      const emissionProbs = this.model.emissionProb[lastState];
      
      // Find most likely observation
      const maxProbIndex = emissionProbs.indexOf(Math.max(...emissionProbs));
      const symbols = ['♠', '♣', '♥', '♦'];
      const predictedSymbol = symbols[maxProbIndex];
      const confidence = emissionProbs[maxProbIndex];

      // Update state history
      this.stateHistory = viterbiPath.slice(-5);

      return {
        prediction: predictedSymbol,
        confidence: confidence,
        stateSequence: this.stateHistory
      };
    } catch (error) {
      console.error('[HMM] Prediction error:', error);
      return { prediction: null, confidence: 0.25 };
    }
  }

  analyze(symbols) {
    try {
      // Add to training buffer
      this.trainingBuffer.push(...symbols);
      if (this.trainingBuffer.length >= this.minSequenceLength) {
        this.train(this.trainingBuffer);
        this.trainingBuffer = this.trainingBuffer.slice(-this.minSequenceLength);
      }

      const result = this.predict(symbols);
      this.lastPrediction = result.prediction;
      return result;
    } catch (error) {
      console.error('[HMM] Analysis error:', error);
      return { prediction: null, confidence: 0.25 };
    }
  }

  getModelState() {
    return {
      ...super.getModelState(),
      numStates: this.numStates,
      numObservations: this.numObservations,
      modelInitialized: this.initialized,
      trainingBufferSize: this.trainingBuffer.length,
      stateHistory: this.stateHistory
    };
  }
}

// Initialize analysis tools with new ML models
const analysisTools = {
  markovChain: new MarkovChain(),
  entropy: new EntropyAnalysis(),
  chiSquare: new ChiSquareTest(),
  monteCarlo: new MonteCarloSimulation(),
  arima: new ARIMAAnalysis(),
  lstm: new LSTMAnalysis(),
  hmm: new HMMAnalysis()
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
      try {
        analyses[name] = tool.analyze(symbols);
        // Update accuracy if we have new data
        if (tool.lastPrediction !== null) {
          tool.updateAccuracy(tool.lastPrediction, symbols[symbols.length - 1]);
        }
      } catch (error) {
        console.error(`Error in ${name} analysis:`, error);
        analyses[name] = {
          prediction: undefined,
          confidence: 0.25,
          error: error.message
        };
      }
    }

    // Send back the symbols and analysis results
    const response = {
      symbols: symbols.length,
      tools: Object.keys(analyses),
      analyses: analyses
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

module.exports = router;
