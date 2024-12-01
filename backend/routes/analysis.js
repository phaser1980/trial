const express = require('express');
const router = express.Router();
const db = require('../db');
const tf = require('@tensorflow/tfjs');
const PredictionTracker = require('../utils/predictionTracker');
const { HybridModel, ErrorCorrection } = require('../utils/hybridModel');
const ARIMAAnalysis = require('../utils/arimaAnalysis');
const AnalysisTool = require('../utils/AnalysisTool');
const logger = require('../utils/logger');

// Initialize prediction tracker and hybrid model
const predictionTracker = new PredictionTracker();
const hybridModel = new HybridModel();

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
      monteCarlo: [],
      arima: [],
      lstm: [],
      hmm: []
    };
    this.windowSize = 20;      // Number of recent predictions to consider
    this.learningRate = 0.1;   // Rate at which weights are adjusted
    this.minWeight = 0.2;      // Minimum weight for any model
    this.confidenceWeight = 0.3; // Weight given to confidence scores
    this.lastActual = null; // Store last actual symbol for feedback
    this.db = db;

    // Adaptive threshold parameters
    this.adaptiveThresholds = {
      accuracy: { min: 0.55, max: 0.75, current: 0.6 },
      calibration: { min: 0.65, max: 0.85, current: 0.7 },
      adjustmentRate: 0.01
    };
    
    // RNG pattern tracking
    this.patternTracking = {
      periodicity: new Map(),
      transitions: new Map(),
      entropyHistory: [],
      potentialSeeds: new Set()
    };
    
    // Performance monitoring
    this.performanceHistory = {
      shortTerm: [], // Last hour
      mediumTerm: [], // Last day
      longTerm: []   // Last week
    };
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
  async updateModelMetrics(modelName, prediction, actualSymbol) {
    const mappedName = this.mapModelName(modelName);
    const wasCorrect = prediction.symbol === actualSymbol;
    
    // Store prediction in database
    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');
      
      // Store the prediction
      const predictionId = await this.db.storeModelPrediction(
        client,
        prediction.sequenceId,
        mappedName,
        prediction.symbol,
        prediction.confidence
      );

      // Update whether the prediction was correct
      await this.db.updatePredictionCorrectness(client, predictionId, wasCorrect);

      // Update recent accuracy tracking
      this.recentAccuracy[mappedName].push(wasCorrect ? 1 : 0);
      this.confidenceScores[mappedName].push(prediction.confidence);
      
      // Trim arrays to window size
      if (this.recentAccuracy[mappedName].length > this.windowSize) {
        this.recentAccuracy[mappedName].shift();
        this.confidenceScores[mappedName].shift();
      }

      // Calculate metrics
      const accuracy = this.calculateAccuracy(mappedName);
      const confidenceCalibration = this.calculateConfidenceCalibration(mappedName);
      const needsRetraining = this.checkNeedsRetraining(mappedName);

      // Store performance metrics
      await this.db.storeModelPerformance(client, mappedName, {
        accuracy,
        confidenceCalibration,
        sampleSize: this.recentAccuracy[mappedName].length,
        needsRetraining
      });

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating model metrics:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Calculate accuracy for a model
  calculateAccuracy(modelName) {
    const accuracies = this.recentAccuracy[modelName];
    if (!accuracies || accuracies.length === 0) return 0;
    return accuracies.reduce((sum, val) => sum + val, 0) / accuracies.length;
  }

  // Calculate confidence calibration
  calculateConfidenceCalibration(modelName) {
    const accuracies = this.recentAccuracy[modelName];
    const confidences = this.confidenceScores[modelName];
    if (!accuracies || accuracies.length === 0) return 0;
    
    // Calculate average confidence and accuracy
    const avgConfidence = confidences.reduce((sum, val) => sum + val, 0) / confidences.length;
    const avgAccuracy = this.calculateAccuracy(modelName);
    
    // Return absolute difference (lower is better)
    return 1 - Math.abs(avgConfidence - avgAccuracy);
  }

  // Check if model needs retraining
  checkNeedsRetraining(modelName) {
    const accuracy = this.calculateAccuracy(modelName);
    const calibration = this.calculateConfidenceCalibration(modelName);
    
    // Adjust thresholds based on recent performance
    this.updateAdaptiveThresholds(accuracy, calibration);
    
    return accuracy < this.adaptiveThresholds.accuracy.current || 
           calibration < this.adaptiveThresholds.calibration.current;
  }

  // Update adaptive thresholds based on performance
  updateAdaptiveThresholds(accuracy, calibration) {
    const { adaptiveThresholds: thresholds } = this;
    
    // Adjust accuracy threshold
    if (accuracy > thresholds.accuracy.current + 0.1) {
      thresholds.accuracy.current = Math.min(
        thresholds.accuracy.current + thresholds.adjustmentRate,
        thresholds.accuracy.max
      );
    } else if (accuracy < thresholds.accuracy.current - 0.1) {
      thresholds.accuracy.current = Math.max(
        thresholds.accuracy.current - thresholds.adjustmentRate,
        thresholds.accuracy.min
      );
    }
    
    // Adjust calibration threshold similarly
    if (calibration > thresholds.calibration.current + 0.1) {
      thresholds.calibration.current = Math.min(
        thresholds.calibration.current + thresholds.adjustmentRate,
        thresholds.calibration.max
      );
    } else if (calibration < thresholds.calibration.current - 0.1) {
      thresholds.calibration.current = Math.max(
        thresholds.calibration.current - thresholds.adjustmentRate,
        thresholds.calibration.min
      );
    }
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

  // Update prediction tracking
  updatePrediction(modelName, prediction, confidence) {
    if (this.lastActual !== null) {
      predictionTracker.recordPrediction(
        this.mapModelName(modelName),
        prediction,
        confidence,
        this.lastActual
      );
    }
  }

  // Set actual symbol for feedback
  setActualSymbol(symbol) {
    this.lastActual = symbol;
  }

  // Get calibrated confidence
  getCalibratedConfidence(modelName, rawConfidence) {
    return predictionTracker.getCalibratedConfidence(
      this.mapModelName(modelName),
      rawConfidence
    );
  }

  // Get model performance metrics
  getModelMetrics(modelName) {
    return predictionTracker.getModelMetrics(this.mapModelName(modelName));
  }

  // Track potential RNG patterns
  trackPatterns(symbols, prediction) {
    // Track symbol transitions
    if (symbols.length >= 2) {
      const transition = `${symbols[symbols.length - 2]}->${symbols[symbols.length - 1]}`;
      this.patternTracking.transitions.set(
        transition,
        (this.patternTracking.transitions.get(transition) || 0) + 1
      );
    }
    
    // Track periodicity
    for (let period = 2; period <= 10; period++) {
      if (symbols.length >= period * 2) {
        const matches = this.checkPeriodicity(symbols, period);
        if (matches > 0.7) {
          this.patternTracking.periodicity.set(period, matches);
        }
      }
    }
    
    // Calculate and track entropy
    const entropy = this.calculateEntropy(symbols.slice(-20));
    this.patternTracking.entropyHistory.push({
      entropy,
      timestamp: Date.now()
    });
    
    // Trim history
    if (this.patternTracking.entropyHistory.length > 1000) {
      this.patternTracking.entropyHistory.shift();
    }
    
    // Identify potential RNG seeds
    this.identifyPotentialSeeds(symbols);
  }

  // Check for periodic patterns
  checkPeriodicity(symbols, period) {
    let matches = 0;
    const cycles = Math.floor(symbols.length / period) - 1;
    
    for (let i = 0; i < cycles; i++) {
      const start = symbols.length - (i + 2) * period;
      const end = symbols.length - (i + 1) * period;
      const pattern = symbols.slice(start, end);
      const nextPattern = symbols.slice(end, end + period);
      
      if (pattern.every((val, idx) => val === nextPattern[idx])) {
        matches++;
      }
    }
    
    return matches / cycles;
  }

  // Calculate entropy of a sequence
  calculateEntropy(sequence) {
    const frequencies = new Map();
    const patterns = new Map();
    let totalPatterns = 0;

    // Calculate pattern frequencies with sliding window
    for (let i = 0; i <= sequence.length - 3; i++) {
      const pattern = sequence.slice(i, i + 3).join(',');
      patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
      totalPatterns++;

      // Track individual symbol frequencies
      const symbol = sequence[i];
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
      const probability = count / sequence.length;
      symbolEntropy -= probability * Math.log2(probability);
    });

    return {
      patternEntropy,
      symbolEntropy,
      patterns,
      frequencies,
      totalPatterns
    };
  }

  // Identify potential RNG seeds based on patterns
  identifyPotentialSeeds(symbols) {
    // Look for characteristic patterns that might indicate specific seeds
    const patterns = this.findCharacteristicPatterns(symbols);
    
    patterns.forEach(pattern => {
      // Use Monte Carlo simulation to test if pattern matches known seed patterns
      const potentialSeeds = this.simulateSeedPatterns(pattern);
      potentialSeeds.forEach(seed => this.patternTracking.potentialSeeds.add(seed));
    });
    
    // Clean up old seeds that no longer match recent patterns
    this.cleanupPotentialSeeds(symbols);
  }

  // Find characteristic patterns that might indicate specific seeds
  findCharacteristicPatterns(symbols) {
    const patterns = [];
    const windowSizes = [3, 4, 5, 6];
    
    windowSizes.forEach(size => {
      for (let i = 0; i <= symbols.length - size; i++) {
        const pattern = symbols.slice(i, i + size);
        const patternStr = pattern.join('');
        
        // Check if this pattern appears multiple times
        const occurrences = this.countPatternOccurrences(symbols, pattern);
        if (occurrences > 1) {
          patterns.push({
            pattern: patternStr,
            occurrences,
            positions: this.findPatternPositions(symbols, pattern)
          });
        }
      }
    });
    
    return patterns;
  }

  // Count pattern occurrences in sequence
  countPatternOccurrences(symbols, pattern) {
    let count = 0;
    for (let i = 0; i <= symbols.length - pattern.length; i++) {
      if (symbols.slice(i, i + pattern.length).every((val, idx) => val === pattern[idx])) {
        count++;
      }
    }
    return count;
  }

  // Find positions where pattern occurs
  findPatternPositions(symbols, pattern) {
    const positions = [];
    for (let i = 0; i <= symbols.length - pattern.length; i++) {
      if (symbols.slice(i, i + pattern.length).every((val, idx) => val === pattern[idx])) {
        positions.push(i);
      }
    }
    return positions;
  }

  // Simulate potential seed patterns
  simulateSeedPatterns(pattern) {
    const potentialSeeds = new Set();
    const numSimulations = 1000;
    
    // Test different seeds
    for (let seed = 0; seed < numSimulations; seed++) {
      const simulatedSequence = this.simulateRNGSequence(seed, pattern.pattern.length * 2);
      if (this.sequenceContainsPattern(simulatedSequence, pattern.pattern)) {
        potentialSeeds.add(seed);
      }
    }
    
    return potentialSeeds;
  }

  // Simulate RNG sequence with given seed
  simulateRNGSequence(seed, length) {
    const sequence = [];
    let state = seed;
    
    for (let i = 0; i < length; i++) {
      // Simple LCG parameters (for demonstration)
      state = (1103515245 * state + 12345) & 0x7fffffff;
      sequence.push(state % 4);
    }
    
    return sequence;
  }

  // Check if sequence contains pattern
  sequenceContainsPattern(sequence, pattern) {
    const patternArr = pattern.split('').map(Number);
    return sequence.some((_, i) => 
      i <= sequence.length - patternArr.length &&
      sequence.slice(i, i + patternArr.length).every((val, idx) => val === patternArr[idx])
    );
  }

  // Clean up seeds that no longer match recent patterns
  cleanupPotentialSeeds(recentSymbols) {
    const validSeeds = new Set();
    
    this.patternTracking.potentialSeeds.forEach(seed => {
      const simulatedSequence = this.simulateRNGSequence(seed, recentSymbols.length);
      if (this.sequenceSimilarity(simulatedSequence, recentSymbols) > 0.7) {
        validSeeds.add(seed);
      }
    });
    
    this.patternTracking.potentialSeeds = validSeeds;
  }

  // Calculate similarity between two sequences
  sequenceSimilarity(seq1, seq2) {
    const length = Math.min(seq1.length, seq2.length);
    let matches = 0;
    
    for (let i = 0; i < length; i++) {
      if (seq1[i] === seq2[i]) matches++;
    }
    
    return matches / length;
  }
}

// Initialize model manager
const modelManager = new ModelManager();

// Base Analysis Tool class
class MarkovChain extends AnalysisTool {
  constructor() {
    super('Markov Chain');
    this.transitionMatrix = {};
    this.recentWeight = 2.0;
    this.decayFactor = 0.95;
    this.smoothingFactor = 0.1;
  }

  analyze(symbols) {
    if (symbols.length < 2) {
      return { prediction: undefined, confidence: 0.25 };
    }

    // Build transition matrix
    this.transitionMatrix = {};
    for (let i = 0; i < symbols.length - 1; i++) {
      const current = symbols[i];
      const next = symbols[i + 1];
      
      if (!this.transitionMatrix[current]) {
        this.transitionMatrix[current] = {};
      }
      this.transitionMatrix[current][next] = 
        (this.transitionMatrix[current][next] || 0) + 1;
    }

    // Normalize probabilities
    Object.keys(this.transitionMatrix).forEach(current => {
      const total = Object.values(this.transitionMatrix[current])
        .reduce((sum, count) => sum + count, 0);
      
      Object.keys(this.transitionMatrix[current]).forEach(next => {
        this.transitionMatrix[current][next] /= total;
      });
    });

    // Make prediction
    const lastSymbol = symbols[symbols.length - 1];
    let prediction = undefined;
    let maxProb = 0;

    if (this.transitionMatrix[lastSymbol]) {
      Object.entries(this.transitionMatrix[lastSymbol]).forEach(([next, prob]) => {
        if (prob > maxProb) {
          maxProb = prob;
          prediction = next;
        }
      });
    }

    this.lastPrediction = prediction;
    return { prediction, confidence: maxProb };
  }
}

// EntropyAnalysis Class
class EntropyAnalysis extends AnalysisTool {
  constructor() {
    super('Entropy Analysis');
    this.windowSize = 30;
    this.patternSize = 3;
    this.entropyThreshold = 1.5;
    this.debugLog = [];
  }

  calculateEntropy(data) {
    const frequencies = new Map();
    const patterns = new Map();
    let totalPatterns = 0;

    // Calculate pattern frequencies with sliding window
    for (let i = 0; i <= data.length - this.patternSize; i++) {
      const pattern = data.slice(i, i + this.patternSize).join(',');
      patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
      totalPatterns++;

      // Track individual symbol frequencies
      const symbol = data[i];
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
      const probability = count / data.length;
      symbolEntropy -= probability * Math.log2(probability);
    });

    return {
      patternEntropy,
      symbolEntropy,
      patterns,
      frequencies,
      totalPatterns
    };
  }

  analyze(symbols) {
    this.debugLog = [];

    if (symbols.length < this.windowSize) {
      return {
        prediction: null,
        confidence: 0,
        entropy: 0,
        debug: this.debugLog
      };
    }

    const recentWindow = symbols.slice(-this.windowSize);
    const entropyResults = this.calculateEntropy(recentWindow);
    
    // Normalize entropies
    const maxPatternEntropy = Math.log2(Math.pow(4, this.patternSize));
    const maxSymbolEntropy = Math.log2(4);

    const normalizedPatternEntropy = entropyResults.patternEntropy / maxPatternEntropy;
    const normalizedSymbolEntropy = entropyResults.symbolEntropy / maxSymbolEntropy;

    // Find most likely next symbol based on pattern matching
    let prediction = null;
    let maxPatternCount = 0;
    const lastPattern = recentWindow.slice(-this.patternSize + 1).join(',');

    entropyResults.patterns.forEach((count, pattern) => {
      if (pattern.startsWith(lastPattern) && count > maxPatternCount) {
        maxPatternCount = count;
        prediction = Number(pattern.split(',').pop());
      }
    });

    // If no pattern match, use frequency-based prediction
    if (prediction === null) {
      let maxFreq = 0;
      entropyResults.frequencies.forEach((freq, symbol) => {
        if (freq > maxFreq) {
          maxFreq = freq;
          prediction = Number(symbol);
        }
      });
    }

    // Calculate confidence based on multiple factors
    const entropyDifference = Math.abs(normalizedPatternEntropy - normalizedSymbolEntropy);
    const patternStrength = 1 - normalizedPatternEntropy;
    const frequencyConfidence = maxPatternCount / entropyResults.totalPatterns;

    let confidence = Math.min(0.95, Math.max(0.25,
      0.4 * frequencyConfidence +
      0.3 * (1 - normalizedPatternEntropy) +
      0.3 * (1 - normalizedSymbolEntropy)
    ));

    // Add debug information
    this.debugLog.push(
      `Pattern Entropy: ${normalizedPatternEntropy.toFixed(3)}`,
      `Symbol Entropy: ${normalizedSymbolEntropy.toFixed(3)}`,
      `Pattern Strength: ${patternStrength.toFixed(3)}`,
      `Frequency Confidence: ${frequencyConfidence.toFixed(3)}`,
      `Final Confidence: ${confidence.toFixed(3)}`
    );

    return {
      prediction,
      confidence,
      entropy: normalizedPatternEntropy,
      debug: this.debugLog
    };
  }
}

// Monte Carlo Analysis
class MonteCarloAnalysis extends AnalysisTool {
  constructor() {
    super('Monte Carlo Analysis');
    this.minSamples = 50; 
    this.iterations = 1000; 
    this.confidenceLevel = 0.95;
    this.lastState = null;
    this.debugLog = [];
  }

  calculateFrequencies(symbols) {
    const freq = { 0: 0, 1: 0, 2: 0, 3: 0 };
    symbols.forEach(s => freq[s]++);
    const total = symbols.length;
    Object.keys(freq).forEach(k => freq[k] /= total);
    return freq;
  }

  simulateNext(frequencies) {
    const rand = Math.random();
    let cumulative = 0;
    for (const [symbol, prob] of Object.entries(frequencies)) {
      cumulative += prob;
      if (rand <= cumulative) return symbol;
    }
    return 0; // Default fallback
  }

  getMostLikelyOutcome(predictions) {
    const counts = {};
    predictions.forEach(p => counts[p] = (counts[p] || 0) + 1);
    return Object.entries(counts)
      .reduce((a, b) => counts[a] > counts[b] ? a : b)[0];
  }

  calculateConfidence(predictions, prediction) {
    const count = predictions.filter(p => p === prediction).length;
    return Math.max(0.25, count / predictions.length);
  }

  analyze(symbols) {
    this.debugLog = []; // Reset debug log
    this.debugLog.push(`Starting Monte Carlo analysis with ${symbols.length} symbols`);

    if (symbols.length < this.minSamples) {
      this.debugLog.push(`Insufficient data: ${symbols.length} < ${this.minSamples}`);
      return { prediction: null, confidence: 0, message: 'Insufficient data', debug: this.debugLog };
    }

    try {
      // Calculate symbol frequencies
      const frequencies = this.calculateFrequencies(symbols);
      this.debugLog.push(`Frequencies calculated: ${JSON.stringify(frequencies)}`);
      
      // Run simulations
      const predictions = [];
      for (let i = 0; i < this.iterations; i++) {
        predictions.push(this.simulateNext(frequencies));
      }
      this.debugLog.push(`Completed ${this.iterations} simulations`);

      // Get most likely outcome
      const { prediction, probability } = this.getMostLikelyOutcome(predictions);
      this.debugLog.push(`Most likely outcome: ${prediction} with probability ${probability}`);
      
      // Calculate confidence
      const confidence = this.calculateConfidence(predictions, prediction);
      this.debugLog.push(`Calculated confidence: ${confidence}`);
      
      return {
        prediction,
        confidence: Math.min(0.95, confidence),
        probability,
        debug: this.debugLog,
        message: `Monte Carlo prediction based on ${this.iterations} simulations`
      };
    } catch (error) {
      this.debugLog.push(`Error in analysis: ${error.message}`);
      console.error('[Monte Carlo] Analysis error:', error, this.debugLog);
      return { 
        prediction: null, 
        confidence: 0.25, 
        error: error.message,
        debug: this.debugLog 
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
    this.minTrainingSize = 100; 
    this.outputSize = 4;
    this.initialized = false;
    this.tf = require('@tensorflow/tfjs');
    this.debugLog = [];
    this.tensors = new Set();
    this.lastTrainingLength = null;
  }

  preprocessInput(sequence) {
    const numericalData = sequence.map(symbol => symbol);
    const normalizedData = numericalData.map(val => val / (this.outputSize - 1));
    return this.tf.tensor3d([normalizedData.map(val => [val])]);
  }

  async initializeModel() {
    if (this.model) return;

    const model = this.tf.sequential();
    
    model.add(this.tf.layers.lstm({
      units: 32,
      inputShape: [this.sequenceLength, 1],
      returnSequences: false
    }));

    model.add(this.tf.layers.dense({
      units: 16,
      activation: 'relu'
    }));

    model.add(this.tf.layers.dropout({ rate: 0.2 }));

    model.add(this.tf.layers.dense({
      units: this.outputSize,
      activation: 'softmax'
    }));

    model.compile({
      optimizer: this.tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    this.model = model;
    this.initialized = true;
  }

  async predict(symbols) {
    try {
      if (!this.model || !symbols || symbols.length < this.sequenceLength) {
        return null;
      }

      const sequence = symbols.slice(-this.sequenceLength);
      const input = this.preprocessInput(sequence);
      
      const prediction = await this.model.predict(input);
      const predIndex = tf.argMax(prediction, 1).dataSync()[0];
      const confidence = prediction.dataSync()[predIndex];

      return {
        prediction: predIndex,
        confidence: confidence
      };
    } catch (error) {
      console.error('[LSTM] Prediction error:', error);
      return null;
    }
  }

  async train(symbols) {
    if (this.isTraining || !symbols || symbols.length < this.sequenceLength + 1) {
      return;
    }

    try {
      this.isTraining = true;
      await this.initializeModel();

      const numericalData = symbols.map(symbol => symbol);
      const normalizedData = numericalData.map(val => val / (this.outputSize - 1));
      const { sequences, targets } = this.createSequences(normalizedData);

      await this.model.fit(sequences, targets, {
        epochs: 100,
        batchSize: 64,
        shuffle: true,
        verbose: 0,
        validationSplit: 0.2
      });

      sequences.dispose();
      targets.dispose();

    } catch (error) {
      console.error('[LSTM] Training error:', error);
    } finally {
      this.isTraining = false;
    }
  }

  createSequences(data) {
    const sequences = [];
    const targets = [];

    for (let i = 0; i <= data.length - this.sequenceLength - 1; i++) {
      const sequence = data.slice(i, i + this.sequenceLength).map(val => [val]);
      sequences.push(sequence);
      
      const oneHot = Array(this.outputSize).fill(0);
      oneHot[Math.floor(data[i + this.sequenceLength] * (this.outputSize - 1) + 0.5)] = 1;
      targets.push(oneHot);
    }

    return {
      sequences: this.tf.tensor3d(sequences),
      targets: this.tf.tensor2d(targets)
    };
  }

  async analyze(symbols) {
    this.debugLog = [];
    this.debugLog.push(`Starting LSTM analysis with ${symbols.length} symbols`);

    if (symbols.length < this.minTrainingSize) {
      this.debugLog.push(`Insufficient data: ${symbols.length} < ${this.minTrainingSize}`);
      return { prediction: null, confidence: 0, message: 'Insufficient data', debug: this.debugLog };
    }

    try {
      if (!this.initialized) {
        this.debugLog.push('Initializing LSTM model');
        await this.initializeModel();
        this.initialized = true;
      }

      // Improve confidence calculation based on sequence length
      const baseConfidence = 0.6;
      const sequenceWeight = Math.min(1, (symbols.length - this.minTrainingSize) / 300);
      const adjustedConfidence = Math.min(0.95, baseConfidence * (1 + sequenceWeight));

      const prediction = await this.predict(symbols);
      return {
        prediction: prediction.index,
        confidence: adjustedConfidence,
        probabilities: prediction.probabilities,
        debug: this.debugLog,
        isTraining: this.isTraining
      };
    } catch (error) {
      this.debugLog.push(`Error in analysis: ${error.message}`);
      console.error('[LSTM] Analysis error:', error, this.debugLog);
      return { 
        prediction: null, 
        confidence: 0, 
        error: error.message,
        debug: this.debugLog 
      };
    }
  }
}

// Chi-Square Test Analysis
class ChiSquareTest extends AnalysisTool {
  constructor() {
    super('Chi-Square Test');
    this.minSamples = 50;
    this.significanceLevel = 0.05;
    this.expectedFrequencies = {
      0: 0.25, 1: 0.25, 2: 0.25, 3: 0.25
    };
  }

  calculateChiSquare(observed) {
    let total = Object.values(observed).reduce((a, b) => a + b, 0);
    let chiSquare = 0;
    
    for (let symbol in this.expectedFrequencies) {
      let expectedCount = total * this.expectedFrequencies[symbol];
      let observedCount = observed[symbol] || 0;
      chiSquare += Math.pow(observedCount - expectedCount, 2) / expectedCount;
    }
    
    return chiSquare;
  }

  analyze(symbols) {
    if (symbols.length < this.minSamples) {
      return {
        prediction: null,
        confidence: 0,
        message: `Need at least ${this.minSamples} symbols for chi-square analysis`
      };
    }

    // Calculate observed frequencies
    let observed = {};
    symbols.forEach(symbol => {
      observed[symbol] = (observed[symbol] || 0) + 1;
    });

    // Calculate chi-square statistic
    let chiSquare = this.calculateChiSquare(observed);
    let criticalValue = 7.815; // Critical value for df=3, p=0.05

    // Calculate prediction based on deviation from expected
    let totalObserved = symbols.length;
    let maxDeviation = -Infinity;
    let predictedSymbol = null;
    let deviations = {};

    // Calculate deviations for all symbols
    for (let symbol in this.expectedFrequencies) {
      let expected = totalObserved * this.expectedFrequencies[symbol];
      let currentObserved = observed[symbol] || 0;
      let deviation = (currentObserved - expected) / expected;
      deviations[symbol] = deviation;
      
      if (deviation > maxDeviation) {
        maxDeviation = deviation;
        predictedSymbol = parseInt(symbol);
      }
    }

    // Calculate confidence based on chi-square test result
    let confidence = Math.min(0.95, Math.max(0.25, 1 - (chiSquare / (criticalValue * 2))));

    return {
      prediction: predictedSymbol,
      confidence: confidence,
      chiSquare: chiSquare,
      deviations: deviations
    };
  }
}

// Hidden Markov Model Analysis
class HMMAnalysis extends AnalysisTool {
  constructor() {
    super('HMM Analysis');
    this.minSequenceLength = 200; 
    this.numStates = 8;
    this.symbols = [0, 1, 2, 3];
    this.states = Array.from({length: this.numStates}, (_, i) => `s${i}`);
    this.initialized = false;
    
    // Initialize transition and emission matrices
    this.initializeMatrices();
  }

  initializeMatrices() {
    // Initialize transition probabilities (uniform)
    this.transitionProb = {};
    this.states.forEach(fromState => {
      this.transitionProb[fromState] = {};
      this.states.forEach(toState => {
        this.transitionProb[fromState][toState] = 1 / this.numStates;
      });
    });

    // Initialize emission probabilities (uniform)
    this.emissionProb = {};
    this.states.forEach(state => {
      this.emissionProb[state] = {};
      this.symbols.forEach(symbol => {
        this.emissionProb[state][symbol] = 1 / this.symbols.length;
      });
    });

    // Initialize initial state probabilities (uniform)
    this.initialProb = {};
    this.states.forEach(state => {
      this.initialProb[state] = 1 / this.numStates;
    });
  }

  analyze(symbols) {
    if (symbols.length < this.minSequenceLength) {
      return { confidence: 0, prediction: null };
    }

    // Improve confidence calculation
    const baseConfidence = 0.5;
    const sequenceWeight = Math.min(1, (symbols.length - this.minSequenceLength) / 250);
    const adjustedConfidence = Math.min(0.95, baseConfidence * (1 + sequenceWeight));

    // Rest of the analysis logic...
    const result = this.performAnalysis(symbols);
    return {
      ...result,
      confidence: adjustedConfidence
    };
  }

  performAnalysis(symbols) {
    try {
      // Get last n symbols for state
      const recentSymbols = symbols.slice(-10);
      
      // Calculate transition probabilities
      const transitionCounts = {};
      const symbolCounts = {};
      
      for (let i = 0; i < symbols.length - 1; i++) {
        const current = symbols[i];
        const next = symbols[i + 1];
        
        transitionCounts[current] = transitionCounts[current] || {};
        transitionCounts[current][next] = (transitionCounts[current][next] || 0) + 1;
        
        symbolCounts[current] = (symbolCounts[current] || 0) + 1;
      }

      // Get current state
      const currentState = recentSymbols[recentSymbols.length - 1];
      
      if (!transitionCounts[currentState]) {
        return {
          prediction: null,
          confidence: 0,
          message: 'Insufficient transition data for current state'
        };
      }

      // Find most likely next symbol
      let maxProb = 0;
      let prediction = null;
      
      Object.entries(transitionCounts[currentState]).forEach(([nextSymbol, count]) => {
        const prob = count / symbolCounts[currentState];
        if (prob > maxProb) {
          maxProb = prob;
          prediction = nextSymbol;
        }
      });

      return {
        prediction,
        confidence: maxProb,
        message: `HMM prediction based on window size ${10}`
      };

    } catch (error) {
      console.error('[HMM] Analysis error:', error);
      return {
        prediction: null,
        confidence: 0,
        message: 'Error in HMM analysis'
      };
    }
  }
}

// Initialize analysis tools
const analysisTools = {
  markovChain: new MarkovChain(),
  entropy: new EntropyAnalysis(),
  chiSquare: new ChiSquareTest(),
  monteCarlo: new MonteCarloAnalysis(),
  arima: new ARIMAAnalysis(),
  lstm: new LSTMAnalysis(),
  hmm: new HMMAnalysis()
};

// Add models to hybrid ensemble
Object.values(analysisTools).forEach(tool => {
  if (tool && typeof tool.analyze === 'function') {
    hybridModel.addModel(tool.name, tool);
  }
});

router.get('/', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // Fetch symbols from the database
    const result = await client.query('SELECT id, symbol, created_at FROM sequences ORDER BY created_at ASC');
    const symbols = result.rows.map(row => row.symbol);
    const latestSequenceId = result.rows[result.rows.length - 1]?.id;
    
    logger.info(`Analyzing ${symbols.length} symbols`);

    if (symbols.length < 2) {
      return res.json({
        message: 'Need at least 2 symbols for analysis',
        symbols: symbols,
        analyses: {}
      });
    }

    // Get individual model predictions
    const analyses = {};
    const debugInfo = {};
    const predictionPromises = [];

    for (const [name, tool] of Object.entries(analysisTools)) {
      try {
        logger.info(`Running ${name} analysis...`);
        const startTime = Date.now();
        
        const result = await tool.analyze(symbols);
        const endTime = Date.now();

        // Store prediction if we have valid data
        if (latestSequenceId && result.prediction !== null) {
          await db.storeModelPrediction(
            client,
            latestSequenceId,
            name,
            result.prediction,
            result.confidence
          );
        }
        
        analyses[name] = result;
        debugInfo[name] = {
          executionTime: endTime - startTime,
          debug: result.debug || [],
          error: result.error,
          symbolCount: symbols.length,
          modelState: tool.modelState || null
        };
        
        logger.info(`${name} analysis completed in ${endTime - startTime}ms`);
        
      } catch (error) {
        logger.error(`Error in ${name} analysis:`, { error });
        analyses[name] = {
          prediction: null,
          confidence: 0,
          error: error.message
        };
        debugInfo[name] = {
          error: error.message,
          stack: error.stack,
          symbolCount: symbols.length
        };
      }
    }

    // Get hybrid model prediction
    const hybridPrediction = await hybridModel.getPrediction(symbols);

    // Store hybrid model prediction if valid
    if (latestSequenceId && hybridPrediction.prediction !== null) {
      await db.storeModelPrediction(
        client,
        latestSequenceId,
        'hybrid',
        hybridPrediction.prediction,
        hybridPrediction.confidence
      );
    }

    await client.query('COMMIT');

    // Send back results with debug info
    const response = {
      symbols: symbols.length,
      tools: Object.keys(analyses),
      analyses: {
        markovChain: {
          matrix: analyses.markovChain?.matrix || {},
          prediction: analyses.markovChain?.prediction,
          confidence: analyses.markovChain?.confidence || 0
        },
        entropy: {
          entropy: analyses.entropy?.entropy || 0,
          prediction: analyses.entropy?.prediction,
          confidence: analyses.entropy?.confidence || 0
        },
        chiSquare: {
          chiSquare: analyses.chiSquare?.value || 0,
          prediction: analyses.chiSquare?.prediction,
          confidence: analyses.chiSquare?.confidence || 0
        },
        monteCarlo: {
          prediction: analyses.monteCarlo?.prediction,
          confidence: analyses.monteCarlo?.confidence || 0
        },
        arima: {
          prediction: analyses.arima?.prediction,
          confidence: analyses.arima?.confidence || 0,
          params: analyses.arima?.params,
          error: analyses.arima?.error
        },
        lstm: {
          prediction: analyses.lstm?.prediction,
          confidence: analyses.lstm?.confidence || 0,
          probabilities: analyses.lstm?.probabilities || [],
          isTraining: analyses.lstm?.isTraining || false
        },
        hmm: {
          prediction: analyses.hmm?.prediction,
          confidence: analyses.hmm?.confidence || 0,
          stateSequence: analyses.hmm?.stateSequence || []
        }
      },
      debug: debugInfo,
      hybridPrediction
    };

    res.json(response);

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Analysis error:', { error });
    res.status(500).json({ 
      error: 'Analysis failed',
      details: error.message,
      stack: error.stack
    });
  } finally {
    client.release();
  }
});

// Update models with actual result and store performance metrics
router.post('/feedback', async (req, res) => {
  const client = await db.getClient();
  try {
    const { actual } = req.body;
    if (actual === undefined) {
      logger.warn('Feedback received without actual value');
      return res.status(400).json({ error: 'Missing actual value' });
    }

    logger.info('Processing feedback', { actual });
    await client.query('BEGIN');

    // Update was_correct for recent predictions
    await db.updatePredictionCorrectness(client, actual);

    // Calculate and store performance metrics for each model
    for (const modelName of [...Object.keys(analysisTools), 'hybrid']) {
      logger.debug('Calculating metrics for model', { modelName });
      const metrics = await db.getModelAccuracy(client, modelName, '1 hour');
      await db.storeModelPerformance(client, modelName, metrics);
    }

    await client.query('COMMIT');
    
    // Update models in memory
    hybridModel.updateModels(actual);
    logger.info('Feedback processed successfully', { actual });
    
    res.json({ 
      success: true,
      message: 'Feedback processed and metrics updated'
    });

  } catch (error) {
    logger.error('Error processing feedback', { 
      error,
      requestBody: req.body 
    });
    await client.query('ROLLBACK');
    res.status(500).json({ 
      error: 'Failed to process feedback',
      details: error.message 
    });
  } finally {
    client.release();
  }
});

// Get model performance metrics
router.get('/performance', async (req, res) => {
  const client = await db.getClient();
  try {
    logger.debug('Fetching performance metrics');
    const [overall, recent] = await Promise.all([
      db.getModelPerformance(client, null, 100),  // Last 100 records
      db.getModelAccuracy(client, null, '1 hour')  // Last hour
    ]);
    
    logger.debug('Performance metrics retrieved', {
      overallCount: overall.length,
      recentCount: recent.length
    });
    
    res.json({
      overall_performance: overall,
      recent_performance: recent,
      timestamp: new Date()
    });
    
  } catch (error) {
    logger.error('Error fetching performance metrics', { error });
    res.status(500).json({ 
      error: 'Failed to fetch performance metrics',
      details: error.message 
    });
  } finally {
    client.release();
  }
});

module.exports = router;
