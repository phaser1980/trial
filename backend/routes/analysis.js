const express = require('express');
const router = express.Router();
const pool = require('../db');
const tf = require('@tensorflow/tfjs');
const PredictionTracker = require('../utils/predictionTracker');
const { HybridModel, ErrorCorrection } = require('../utils/hybridModel');
const ARIMAAnalysis = require('../utils/arimaAnalysis');
const AnalysisTool = require('../utils/AnalysisTool');

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
    this.entropyThreshold = 1.5;
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

  analyze(symbols) {
    if (symbols.length < this.windowSize) {
      return { entropy: 0, prediction: undefined, confidence: 0.25 };
    }

    const recentWindow = symbols.slice(-this.windowSize);
    const entropy = this.calculateEntropy(recentWindow);
    
    // Simple prediction based on most frequent symbol
    const frequencies = {};
    recentWindow.forEach(symbol => {
      frequencies[symbol] = (frequencies[symbol] || 0) + 1;
    });

    let maxCount = 0;
    let prediction;
    Object.entries(frequencies).forEach(([symbol, count]) => {
      if (count > maxCount) {
        maxCount = count;
        prediction = symbol;
      }
    });

    const confidence = maxCount / this.windowSize;
    this.lastPrediction = prediction;
    
    return { entropy, prediction, confidence };
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
    const freq = { '♠': 0, '♣': 0, '♥': 0, '♦': 0 };
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
    return '♠'; // Default fallback
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
    this.lastPrediction = null;
    this.modelState = null;
    this.debugLog = [];
    this.tf = require('@tensorflow/tfjs');

    this.symbolMap = {
      '♠': 0, '♣': 1, '♥': 2, '♦': 3
    };
    this.reverseSymbolMap = Object.fromEntries(
      Object.entries(this.symbolMap).map(([k, v]) => [v, k])
    );
  }

  preprocessInput(sequence) {
    const numericalData = sequence.map(symbol => this.symbolMap[symbol] || 0);
    const normalizedData = numericalData.map(val => val / (Object.keys(this.symbolMap).length - 1));
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
        prediction: this.reverseSymbolMap[predIndex],
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

      const numericalData = symbols.map(symbol => this.symbolMap[symbol] || 0);
      const normalizedData = numericalData.map(val => val / (Object.keys(this.symbolMap).length - 1));
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
      const target = data[i + this.sequenceLength];
      sequences.push(sequence);
      
      const oneHot = Array(this.outputSize).fill(0);
      oneHot[Math.floor(target * (this.outputSize - 1) + 0.5)] = 1;
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
      '♠': 0.25, '♣': 0.25, '♥': 0.25, '♦': 0.25
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

    // Calculate observed frequencies first
    let observed = {};
    symbols.forEach(symbol => {
      observed[symbol] = (observed[symbol] || 0) + 1;
    });

    // Calculate chi-square statistic
    let chiSquare = this.calculateChiSquare(observed);

    let criticalValue = 7.815;

    // Calculate prediction based on deviation from expected
    let totalObserved = symbols.length;
    let maxDeviation = -Infinity;
    let predictedSymbol = null;

    for (let symbol in this.expectedFrequencies) {
      let expected = totalObserved * this.expectedFrequencies[symbol];
      let currentObserved = observed[symbol] || 0;
      let deviation = (currentObserved - expected) / expected;

      if (Math.abs(deviation) > Math.abs(maxDeviation)) {
        maxDeviation = deviation;
        // Predict the symbol that is most underrepresented (negative deviation)
        predictedSymbol = deviation < 0 ? symbol : null;
      }
    }

    // If no symbol is underrepresented, pick the least overrepresented one
    if (!predictedSymbol) {
      maxDeviation = Infinity;
      for (let symbol in this.expectedFrequencies) {
        let expected = totalObserved * this.expectedFrequencies[symbol];
        let currentObserved = observed[symbol] || 0;
        let deviation = (currentObserved - expected) / expected;
        if (deviation > 0 && deviation < maxDeviation) {
          maxDeviation = deviation;
          predictedSymbol = symbol;
        }
      }
    }

    // Calculate confidence based on chi-square value
    let confidence = Math.min(0.95, chiSquare / (2 * criticalValue));

    // If we still don't have a prediction, pick the least frequent symbol
    if (!predictedSymbol) {
      let minCount = Infinity;
      for (let symbol in observed) {
        if (observed[symbol] < minCount) {
          minCount = observed[symbol];
          predictedSymbol = symbol;
        }
      }
    }

    this.lastPrediction = predictedSymbol;
    return {
      prediction: predictedSymbol,
      confidence: confidence,
      message: `Chi-square statistic: ${chiSquare.toFixed(2)}`
    };
  }
}

// Hidden Markov Model Analysis
class HMMAnalysis extends AnalysisTool {
  constructor() {
    super('HMM Analysis');
    this.minSequenceLength = 200; 
    this.numStates = 8;
    this.symbols = ['♠', '♣', '♥', '♦'];
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
  try {
    // Fetch symbols from the database
    const result = await pool.query('SELECT symbol FROM sequences ORDER BY created_at ASC');
    const symbols = result.rows.map(row => row.symbol);
    console.log(`Analyzing ${symbols.length} symbols`);

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

    for (const [name, tool] of Object.entries(analysisTools)) {
      try {
        console.log(`Running ${name} analysis...`);
        const startTime = Date.now();
        
        const result = await tool.analyze(symbols);
        const endTime = Date.now();
        
        analyses[name] = result;
        debugInfo[name] = {
          executionTime: endTime - startTime,
          debug: result.debug || [],
          error: result.error,
          symbolCount: symbols.length,
          modelState: tool.modelState || null
        };
        
        console.log(`${name} analysis completed in ${endTime - startTime}ms`);
        
        // Update accuracy tracking
        if (tool.lastPrediction !== null) {
          tool.updateAccuracy(tool.lastPrediction, symbols[symbols.length - 1]);
          predictionTracker.recordPrediction(
            name,
            tool.lastPrediction,
            analyses[name].confidence,
            symbols[symbols.length - 1]
          );
        }
      } catch (error) {
        console.error(`Error in ${name} analysis:`, error);
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

    // Send back results with debug info
    const response = {
      symbols: symbols.length,
      tools: Object.keys(analyses),
      analyses: {
        ...analyses,
        hybrid: {
          prediction: hybridPrediction.prediction,
          confidence: hybridPrediction.confidence,
          modelWeights: hybridPrediction.weights,
          individualPredictions: hybridPrediction.modelPredictions
        }
      },
      debug: debugInfo
    };

    res.json(response);

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Analysis failed',
      details: error.message,
      stack: error.stack
    });
  }
});

// Update models with actual result
router.post('/feedback', async (req, res) => {
  try {
    const { actual } = req.body;
    if (actual !== undefined) {
      hybridModel.updateModels(actual);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Missing actual value' });
    }
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to process feedback' });
  }
});

module.exports = router;
