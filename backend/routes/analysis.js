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
      'hmm analysis': 'hmm',
      'rng analysis': 'rng'
    };

    // Reverse mapping for tool names to display names
    this.displayNames = {
      markovChain: 'Markov Chain',
      entropy: 'Entropy Analysis',
      chiSquare: 'Chi-Square Test',
      monteCarlo: 'Monte Carlo Simulation',
      arima: 'ARIMA Analysis',
      lstm: 'LSTM Analysis',
      hmm: 'HMM Analysis',
      rng: 'RNG Analysis'
    };

    this.modelWeights = {
      markovChain: 1.0,
      entropy: 1.0,
      chiSquare: 1.0,
      monteCarlo: 1.0,
      arima: 1.0,
      lstm: 1.0,
      hmm: 1.0,
      rng: 1.0
    };
    this.recentAccuracy = {
      markovChain: [],
      entropy: [],
      chiSquare: [],
      monteCarlo: [],
      monteCarlo: [],
      arima: [],
      lstm: [],
      hmm: [],
      rng: []
    };
    this.confidenceScores = {
      markovChain: [],
      entropy: [],
      chiSquare: [],
      monteCarlo: [],
      monteCarlo: [],
      arima: [],
      lstm: [],
      hmm: [],
      rng: []
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
        debug: {
          log: this.debugLog,
          final: { prediction: null, confidence: 0 }
        }
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
      debug: {
        log: this.debugLog,
        final: {
          prediction: prediction,
          confidence: confidence
        },
        entropy: {
          pattern: normalizedPatternEntropy,
          symbol: normalizedSymbolEntropy
        }
      }
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
    const [prediction, count] = Object.entries(counts)
      .reduce(([ak, av], [bk, bv]) => av > bv ? [ak, av] : [bk, bv], ['0', 0]);
    const probability = count / predictions.length;
    return { prediction: parseInt(prediction), probability };
  }

  analyze(symbols) {
    this.debugLog = []; // Reset debug log
    this.debugLog.push(`Starting Monte Carlo analysis with ${symbols.length} symbols`);

    if (symbols.length < this.minSamples) {
      this.debugLog.push(`Insufficient data: ${symbols.length} < ${this.minSamples}`);
      return { 
        prediction: null, 
        confidence: 0, 
        debug: {
          log: this.debugLog,
          final: { prediction: null, confidence: 0 }
        }
      };
    }

    try {
      // Calculate symbol frequencies
      const frequencies = this.calculateFrequencies(symbols);
      this.debugLog.push(`Frequencies calculated: ${JSON.stringify(frequencies)}`);
      
      // Run simulations
      const predictions = [];
      for (let i = 0; i < this.iterations; i++) {
        predictions.push(parseInt(this.simulateNext(frequencies)));
      }
      this.debugLog.push(`Completed ${this.iterations} simulations`);

      // Get most likely outcome
      const { prediction, probability } = this.getMostLikelyOutcome(predictions);
      this.debugLog.push(`Most likely outcome: ${prediction} with probability ${probability}`);
      
      // Calculate confidence
      const confidence = Math.min(0.95, Math.max(0.25, probability));
      this.debugLog.push(`Calculated confidence: ${confidence}`);
      
      return {
        prediction,
        confidence,
        debug: {
          log: this.debugLog,
          final: {
            prediction: prediction,
            confidence: confidence
          },
          probabilities: Object.fromEntries(
            [0,1,2,3].map(symbol => [
              symbol,
              predictions.filter(p => p === symbol).length / predictions.length
            ])
          )
        }
      };
    } catch (error) {
      this.debugLog.push(`Error in analysis: ${error.message}`);
      console.error('[Monte Carlo] Analysis error:', error, this.debugLog);
      return { 
        prediction: null, 
        confidence: 0, 
        debug: {
          log: this.debugLog,
          final: { prediction: null, confidence: 0 },
          error: error.message
        }
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
    this.epochs = 0;
    this.currentLoss = null;
  }

  createSequences(symbols) {
    if (symbols.length < this.sequenceLength + 1) {
      return null;
    }

    const xs = [];
    const ys = [];

    for (let i = 0; i <= symbols.length - this.sequenceLength - 1; i++) {
      const sequence = symbols.slice(i, i + this.sequenceLength);
      const nextSymbol = symbols[i + this.sequenceLength];
      
      xs.push(sequence.map(s => [s]));
      
      // One-hot encode the target
      const target = new Array(this.outputSize).fill(0);
      target[nextSymbol] = 1;
      ys.push(target);
    }

    return { xs, ys };
  }

  async initializeModel() {
    if (this.model) {
      this.model.dispose();
    }

    this.model = this.tf.sequential();
    
    this.model.add(this.tf.layers.lstm({
      units: 32,
      inputShape: [this.sequenceLength, 1],
      returnSequences: false
    }));
    
    this.model.add(this.tf.layers.dense({
      units: this.outputSize,
      activation: 'softmax'
    }));

    this.model.compile({
      optimizer: this.tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    this.initialized = true;
  }

  async train(symbols) {
    if (symbols.length < this.minTrainingSize) {
      return false;
    }

    const sequences = this.createSequences(symbols);
    if (!sequences || sequences.xs.length === 0) {
      return false;
    }

    const xs = this.tf.tensor3d(sequences.xs, [sequences.xs.length, this.sequenceLength, 1]);
    const ys = this.tf.tensor2d(sequences.ys, [sequences.ys.length, this.outputSize]);

    try {
      const result = await this.model.fit(xs, ys, {
        epochs: 10,
        batchSize: 32,
        shuffle: true,
        verbose: 0
      });

      this.epochs += 10;
      this.currentLoss = result.history.loss[result.history.loss.length - 1];

      xs.dispose();
      ys.dispose();
      return true;
    } catch (error) {
      console.error('LSTM training error:', error);
      return false;
    }
  }

  async predict(sequence) {
    if (!this.model || sequence.length < this.sequenceLength) {
      return null;
    }

    const input = sequence.slice(-this.sequenceLength).map(x => [x]);
    const xs = this.tf.tensor3d([input], [1, this.sequenceLength, 1]);
    
    try {
      const prediction = await this.model.predict(xs);
      const probabilities = await prediction.data();
      xs.dispose();
      prediction.dispose();

      const maxProb = Math.max(...probabilities);
      const predictedClass = probabilities.indexOf(maxProb);
      
      return {
        prediction: predictedClass,
        confidence: maxProb,
        probabilities: Array.from(probabilities)
      };
    } catch (error) {
      console.error('LSTM prediction error:', error);
      return null;
    }
  }

  async analyze(symbols) {
    this.debugLog = [];

    if (symbols.length < this.minTrainingSize) {
      return {
        prediction: null,
        confidence: 0,
        debug: {
          log: this.debugLog,
          final: { prediction: null, confidence: 0 },
          networkState: {
            epochs: this.epochs,
            loss: this.currentLoss,
            sequenceLength: this.sequenceLength
          }
        }
      };
    }

    try {
      if (!this.initialized) {
        await this.initializeModel();
      }

      // Train if we have new data
      if (symbols.length !== this.lastTrainingLength) {
        await this.train(symbols);
        this.lastTrainingLength = symbols.length;
      }

      const result = await this.predict(symbols);
      
      if (!result) {
        return {
          prediction: null,
          confidence: 0,
          debug: {
            log: this.debugLog,
            final: { prediction: null, confidence: 0 },
            networkState: {
              epochs: this.epochs,
              loss: this.currentLoss,
              sequenceLength: this.sequenceLength
            }
          }
        };
      }

      return {
        prediction: result.prediction,
        confidence: result.confidence,
        debug: {
          log: this.debugLog,
          final: {
            prediction: result.prediction,
            confidence: result.confidence
          },
          networkState: {
            epochs: this.epochs,
            loss: this.currentLoss,
            sequenceLength: this.sequenceLength,
            probabilities: result.probabilities
          }
        }
      };
    } catch (error) {
      console.error('LSTM analysis error:', error);
      return {
        prediction: null,
        confidence: 0,
        debug: {
          log: [...this.debugLog, error.message],
          final: { prediction: null, confidence: 0 },
          networkState: {
            epochs: this.epochs,
            loss: this.currentLoss,
            sequenceLength: this.sequenceLength
          },
          error: error.message
        }
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

// RNG Analysis
class RNGAnalysis extends AnalysisTool {
  constructor() {
    super('RNG Analysis');
    this.knownGenerators = new Map([
      ['lcg', this.linearCongruentialGenerator],
      ['xorshift', this.xorshiftGenerator],
      ['mersenne', this.mersenneGenerator]
    ]);
    this.seedCandidates = new Set();
    this.matchThreshold = 0.85;
    this.minSequenceLength = 50;
  }

  linearCongruentialGenerator(seed, length) {
    const m = 2147483647;  // 2^31 - 1
    const a = 1103515245;
    const c = 12345;
    const results = [];
    let current = seed;

    for (let i = 0; i < length; i++) {
      current = (a * current + c) % m;
      results.push(current % 4);  // Map to 0-3 range
    }
    return results;
  }

  xorshiftGenerator(seed, length) {
    let state = seed;
    const results = [];

    for (let i = 0; i < length; i++) {
      state ^= state << 13;
      state ^= state >> 17;
      state ^= state << 5;
      results.push(Math.abs(state % 4));  // Map to 0-3 range
    }
    return results;
  }

  mersenneGenerator(seed, length) {
    // Simplified Mersenne Twister implementation
    const N = 624;
    const M = 397;
    const MATRIX_A = 0x9908b0df;
    const UPPER_MASK = 0x80000000;
    const LOWER_MASK = 0x7fffffff;

    const mt = new Array(N);
    let mti = N + 1;

    function initGenRand(s) {
      mt[0] = s >>> 0;
      for (mti = 1; mti < N; mti++) {
        mt[mti] = (1812433253 * (mt[mti-1] ^ (mt[mti-1] >>> 30)) + mti);
        mt[mti] >>>= 0;
      }
    }

    function genrandInt32() {
      let y;
      const mag01 = [0x0, MATRIX_A];

      if (mti >= N) {
        let kk;

        if (mti === N+1) {
          initGenRand(5489);
        }

        for (kk = 0; kk < N-M; kk++) {
          y = (mt[kk] & UPPER_MASK) | (mt[kk+1] & LOWER_MASK);
          mt[kk] = mt[kk+M] ^ (y >>> 1) ^ mag01[y & 0x1];
        }
        for (; kk < N-1; kk++) {
          y = (mt[kk] & UPPER_MASK) | (mt[kk+1] & LOWER_MASK);
          mt[kk] = mt[kk+(M-N)] ^ (y >>> 1) ^ mag01[y & 0x1];
        }
        y = (mt[N-1] & UPPER_MASK) | (mt[0] & LOWER_MASK);
        mt[N-1] = mt[M-1] ^ (y >>> 1) ^ mag01[y & 0x1];

        mti = 0;
      }

      y = mt[mti++];

      y ^= (y >>> 11);
      y ^= (y << 7) & 0x9d2c5680;
      y ^= (y << 15) & 0xefc60000;
      y ^= (y >>> 18);

      return y >>> 0;
    }

    initGenRand(seed);
    const results = [];
    for (let i = 0; i < length; i++) {
      results.push(genrandInt32() % 4);  // Map to 0-3 range
    }
    return results;
  }

  calculateSimilarity(seq1, seq2) {
    const matches = seq1.filter((val, idx) => val === seq2[idx]).length;
    return matches / seq1.length;
  }

  findPotentialSeeds(sequence) {
    const results = {
      candidates: [],
      bestMatch: null,
      matchingSequences: {}
    };

    if (sequence.length < this.minSequenceLength) {
      return results;
    }

    // Test different seeds and generators
    for (const [genName, generator] of this.knownGenerators) {
      for (let seed = 1; seed <= 1000; seed++) {
        const generatedSeq = generator.call(this, seed, sequence.length);
        const similarity = this.calculateSimilarity(sequence, generatedSeq);

        if (similarity > this.matchThreshold) {
          const candidate = {
            generator: genName,
            seed,
            similarity,
            sequence: generatedSeq
          };
          results.candidates.push(candidate);

          if (!results.bestMatch || similarity > results.bestMatch.similarity) {
            results.bestMatch = candidate;
          }
        }
      }
    }

    // Store matching sequences for visualization
    if (results.bestMatch) {
      results.matchingSequences = {
        original: sequence,
        generated: results.bestMatch.sequence,
        matches: sequence.map((val, idx) => val === results.bestMatch.sequence[idx])
      };
    }

    return results;
  }

  analyze(symbols) {
    const results = this.findPotentialSeeds(symbols);
    
    return {
      hasPotentialRNG: results.candidates.length > 0,
      bestMatch: results.bestMatch,
      candidates: results.candidates,
      matchingSequences: results.matchingSequences,
      minSequenceLength: this.minSequenceLength
    };
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
  hmm: new HMMAnalysis(),
  rng: new RNGAnalysis()
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

        // Validate prediction before storing
        const validPrediction = result.prediction !== null && 
                              result.prediction !== undefined && 
                              Number.isInteger(result.prediction) && 
                              result.prediction >= 0 && 
                              result.prediction <= 3;

        // Store prediction if we have valid data
        if (latestSequenceId && validPrediction) {
          const confidence = Math.min(Math.max(result.confidence || 0, 0), 1);
          await db.storeModelPrediction(
            client,
            latestSequenceId,
            name,
            result.prediction,
            confidence
          );
        } else {
          logger.warn(`Invalid prediction from ${name}:`, {
            prediction: result.prediction,
            confidence: result.confidence
          });
        }
        
        analyses[name] = result;
        debugInfo[name] = {
          executionTime: endTime - startTime,
          debug: result.debug || [],
          error: result.error,
          symbolCount: symbols.length,
          modelState: tool.modelState || null,
          predictionValid: validPrediction
        };
        
        logger.info(`${name} analysis completed in ${endTime - startTime}ms`);
        
      } catch (error) {
        logger.error(`Error in ${name} analysis:`, error);
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

    // Get recent performance metrics for each model
    const performanceMetrics = {};
    for (const name of Object.keys(analysisTools)) {
      try {
        const metrics = await db.getModelPerformance(client, name, 1);
        performanceMetrics[name] = metrics.rows[0] || {
          accuracy: 0,
          confidence_calibration: 0,
          needs_retraining: false
        };
      } catch (error) {
        logger.error(`Error fetching performance metrics for ${name}:`, error);
      }
    }

    await client.query('COMMIT');

    res.json({
      message: 'Analysis complete',
      symbols: symbols,
      analyses: analyses,
      debug: debugInfo,
      performance: performanceMetrics
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Analysis error:', error);
    res.status(500).json({
      error: 'Analysis failed',
      message: error.message
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

router.post('/analyze', async (req, res) => {
  try {
    const { sequence } = req.body;
    const client = await db.getClient();

    // Validate sequence
    if (!sequence || !Array.isArray(sequence)) {
      return res.status(400).json({ error: 'Invalid sequence data' });
    }

    // Get model states
    const modelStates = await modelManager.getModelStates();

    // Run all enabled analyses
    const results = {};
    const analysisPromises = [];

    for (const [toolName, tool] of Object.entries(analysisTools)) {
      const internalName = modelManager.mapModelName(tool.name);
      if (!modelStates[internalName]?.enabled) continue;

      analysisPromises.push(
        tool.analyze(sequence.map(s => parseInt(s.value)))
          .then(result => {
            if (toolName === 'monteCarlo') {
              // Format Monte Carlo results for frontend
              results[internalName] = {
                predictedNext: result.prediction,
                confidence: result.confidence,
                probabilities: result.probabilities,
                debug: result.debug
              };
            } else if (toolName === 'rng') {
              results[internalName] = {
                hasPotentialRNG: result.hasPotentialRNG,
                bestMatch: result.bestMatch,
                candidates: result.candidates,
                matchingSequences: result.matchingSequences
              };
            } else {
              results[internalName] = {
                predictedNext: result.prediction,
                confidence: result.confidence
              };
            }
          })
          .catch(error => {
            logger.error(`Error in ${toolName} analysis:`, error);
            results[internalName] = {
              error: error.message
            };
          })
      );
    }

    await Promise.all(analysisPromises);

    // Return results
    res.json({
      results,
      modelStates
    });

  } catch (error) {
    logger.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
