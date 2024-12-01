const tf = require('@tensorflow/tfjs');
const AnalysisTool = require('./AnalysisTool');

class LSTMAnalysis extends AnalysisTool {
    constructor() {
        super('LSTM Analysis');
        this.sequenceLength = 10;
        this.minSamples = 50;
        this.batchSize = 32;
        this.epochs = 100;
        this.debugLog = [];
        this.tensors = new Set();
        this.model = null;
        this.lastTrainingLength = null;
        this.numSymbols = 4; // Total number of symbols (0-3)
    }

    // Keep track of tensors
    trackTensor(tensor) {
        this.tensors.add(tensor);
        return tensor;
    }

    // Clean up tensors
    cleanup() {
        this.tensors.forEach(tensor => {
            if (tensor && tensor.dispose) {
                tensor.dispose();
            }
        });
        this.tensors.clear();
    }

    // Convert numeric index to one-hot encoding
    symbolToOneHot(symbol) {
        const oneHot = Array(this.numSymbols).fill(0);
        if (symbol >= 0 && symbol < this.numSymbols) {
            oneHot[symbol] = 1;
        }
        return oneHot;
    }

    // Convert one-hot encoding back to numeric index
    oneHotToSymbol(oneHot) {
        return oneHot.indexOf(Math.max(...oneHot));
    }

    // Prepare sequences for LSTM
    prepareSequences(symbols) {
        const X = [];
        const y = [];
        
        for (let i = 0; i <= symbols.length - this.sequenceLength - 1; i++) {
            const sequence = symbols.slice(i, i + this.sequenceLength);
            const nextSymbol = symbols[i + this.sequenceLength];
            
            // Convert sequence to one-hot encodings
            const oneHotSequence = sequence.map(s => this.symbolToOneHot(s));
            const oneHotNext = this.symbolToOneHot(nextSymbol);
            
            X.push(oneHotSequence);
            y.push(oneHotNext);
        }
        
        return [X, y];
    }

    // Create and compile LSTM model
    createModel() {
        if (this.model) {
            this.model.dispose();
        }

        this.model = tf.sequential();
        
        // Add bidirectional LSTM layer for better sequence understanding
        this.model.add(tf.layers.bidirectional({
            layer: tf.layers.lstm({
                units: 128,
                returnSequences: true
            }),
            inputShape: [this.sequenceLength, this.numSymbols]
        }));
        
        // Add another LSTM layer
        this.model.add(tf.layers.lstm({
            units: 64,
            returnSequences: false
        }));
        
        // Add dropout for regularization
        this.model.add(tf.layers.dropout({
            rate: 0.3
        }));
        
        // Add dense layers with batch normalization
        this.model.add(tf.layers.dense({
            units: 32,
            activation: 'relu'
        }));
        
        this.model.add(tf.layers.batchNormalization());
        
        this.model.add(tf.layers.dense({
            units: this.numSymbols,
            activation: 'softmax'
        }));
        
        // Use Adam optimizer with custom learning rate
        const optimizer = tf.train.adam(0.001);
        
        this.model.compile({
            optimizer,
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });
        
        return this.model;
    }

    // Train model on sequences
    async trainModel(X, y) {
        try {
            const xTensor = this.trackTensor(tf.tensor3d(X));
            const yTensor = this.trackTensor(tf.tensor2d(y));
            
            // Add validation split
            const history = await this.model.fit(xTensor, yTensor, {
                batchSize: this.batchSize,
                epochs: this.epochs,
                shuffle: true,
                validationSplit: 0.2,
                verbose: 1,
                callbacks: {
                    onEpochEnd: async (epoch, logs) => {
                        if (epoch % 10 === 0) {
                            console.log('[LSTM] Training epoch', epoch, 'metrics:', {
                                loss: logs.loss.toFixed(4),
                                accuracy: logs.acc.toFixed(4),
                                valLoss: logs.val_loss.toFixed(4),
                                valAccuracy: logs.val_acc.toFixed(4)
                            });
                        }
                    }
                }
            });
            
            console.log('[LSTM] Training completed. Final metrics:', {
                loss: history.history.loss[history.history.loss.length - 1].toFixed(4),
                accuracy: history.history.acc[history.history.acc.length - 1].toFixed(4),
                valLoss: history.history.val_loss[history.history.val_loss.length - 1].toFixed(4),
                valAccuracy: history.history.val_acc[history.history.val_acc.length - 1].toFixed(4)
            });
            
            return history;
        } catch (error) {
            console.error('[LSTM] Training error:', error);
            throw error;
        }
    }

    // Make prediction for a sequence
    async predict(sequence) {
        try {
            if (!this.model) {
                console.error('[LSTM] Model not initialized');
                return { prediction: 0, confidence: 0.25 };
            }

            const oneHotSequence = sequence.map(s => this.symbolToOneHot(s));
            if (oneHotSequence.includes(null)) {
                console.error('[LSTM] Invalid symbols in sequence');
                return { prediction: 0, confidence: 0.25 };
            }

            const input = this.trackTensor(tf.tensor3d([oneHotSequence]));
            const prediction = await this.model.predict(input);
            const probabilities = await prediction.data();
            
            // Get prediction and confidence
            const maxProb = Math.max(...probabilities);
            const predictionIndex = probabilities.indexOf(maxProb);

            // Handle NaN values
            if (isNaN(maxProb) || isNaN(predictionIndex)) {
                console.error('[LSTM] NaN values detected in prediction');
                return { prediction: 0, confidence: 0.25 };
            }

            // Calculate entropy-based confidence
            const entropy = -probabilities.reduce((sum, p) => {
                if (p <= 0) return sum;
                return sum + (p * Math.log2(p));
            }, 0);
            const normalizedEntropy = entropy / Math.log2(this.numSymbols);
            const entropyConfidence = 1 - normalizedEntropy;

            // Combine probability and entropy confidence
            const confidence = Math.min(0.95, Math.max(0.25,
                (maxProb * 0.6) + (entropyConfidence * 0.4)
            ));

            return {
                prediction: predictionIndex,
                confidence: confidence,
                probabilities: Array.from(probabilities)
            };

        } catch (error) {
            console.error('[LSTM] Prediction error:', error);
            return { prediction: 0, confidence: 0.25 };
        }
    }

    // Analyze sequence using LSTM
    async analyze(symbols) {
        try {
            this.debugLog = [];
            console.log('[LSTM] Starting analysis with', symbols.length, 'symbols');

            if (symbols.length < this.minSamples) {
                console.log('[LSTM] Insufficient data:', symbols.length);
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Prepare sequences
            const [X, y] = this.prepareSequences(symbols);
            console.log('[LSTM] Prepared', X.length, 'sequences');

            if (X.length === 0) {
                console.log('[LSTM] No valid sequences generated');
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'No valid sequences',
                    debug: this.debugLog
                };
            }

            // Create and train model if needed
            if (!this.model || this.needsRetraining(symbols)) {
                this.createModel();
                await this.trainModel(X, y);
            }

            // Get last sequence for prediction
            const lastSequence = symbols.slice(-this.sequenceLength);

            if (lastSequence.length < this.sequenceLength) {
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient sequence length',
                    debug: this.debugLog
                };
            }

            // Make prediction
            const result = await this.predict(lastSequence);
            
            if (!result || result.confidence < 0.3) {
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Low confidence prediction',
                    debug: this.debugLog,
                    probabilities: result?.probabilities
                };
            }

            return {
                prediction: result.prediction,
                confidence: result.confidence,
                probabilities: result.probabilities,
                debug: this.debugLog
            };

        } catch (error) {
            console.error('[LSTM] Analysis error:', error);
            return {
                prediction: null,
                confidence: 0,
                error: error.message,
                debug: this.debugLog
            };
        } finally {
            this.cleanup();
        }
    }

    // Check if model needs retraining
    needsRetraining(symbols) {
        if (!this.lastTrainingLength) return true;
        return symbols.length >= this.lastTrainingLength * 1.5;
    }
}

module.exports = LSTMAnalysis;
