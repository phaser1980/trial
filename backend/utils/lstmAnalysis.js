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

    // Convert symbols to one-hot encoding
    symbolToOneHot(symbol) {
        const mapping = { '♠': [1,0,0,0], '♣': [0,1,0,0], '♥': [0,0,1,0], '♦': [0,0,0,1] };
        return mapping[symbol] ?? null;
    }

    // Convert one-hot encoding back to symbol
    oneHotToSymbol(oneHot) {
        const mapping = ['♠', '♣', '♥', '♦'];
        const index = oneHot.indexOf(Math.max(...oneHot));
        return mapping[index];
    }

    // Prepare sequences for LSTM
    prepareSequences(symbols) {
        const X = [];
        const y = [];
        
        for (let i = 0; i <= symbols.length - this.sequenceLength - 1; i++) {
            const sequence = symbols.slice(i, i + this.sequenceLength);
            const target = symbols[i + this.sequenceLength];
            
            const sequenceOneHot = sequence.map(s => this.symbolToOneHot(s));
            const targetOneHot = this.symbolToOneHot(target);
            
            if (sequenceOneHot.includes(null) || !targetOneHot) continue;
            
            X.push(sequenceOneHot);
            y.push(targetOneHot);
        }
        
        return { X, y };
    }

    // Create and compile LSTM model
    createModel() {
        const model = tf.sequential();
        
        model.add(tf.layers.lstm({
            units: 64,
            inputShape: [this.sequenceLength, 4],
            returnSequences: false
        }));
        
        model.add(tf.layers.dropout({ rate: 0.2 }));
        
        model.add(tf.layers.dense({
            units: 32,
            activation: 'relu'
        }));
        
        model.add(tf.layers.dense({
            units: 4,
            activation: 'softmax'
        }));
        
        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });
        
        return model;
    }

    // Train the model
    async trainModel(X, y) {
        try {
            const xTensor = this.trackTensor(tf.tensor3d(X));
            const yTensor = this.trackTensor(tf.tensor2d(y));
            
            this.model = this.createModel();
            
            await this.model.fit(xTensor, yTensor, {
                batchSize: this.batchSize,
                epochs: this.epochs,
                shuffle: true,
                verbose: 0
            });
            
            return true;
        } catch (error) {
            this.debugLog.push(`Training error: ${error.message}`);
            return false;
        }
    }

    // Make prediction using trained model
    async predict(sequence) {
        try {
            if (!this.model) {
                throw new Error('Model not trained');
            }
            
            const sequenceOneHot = sequence.map(s => this.symbolToOneHot(s));
            const input = this.trackTensor(tf.tensor3d([sequenceOneHot]));
            
            const prediction = await this.model.predict(input).data();
            return Array.from(prediction);
        } catch (error) {
            this.debugLog.push(`Prediction error: ${error.message}`);
            throw error;
        }
    }

    async analyze(symbols) {
        try {
            this.debugLog = [];
            if (symbols.length < this.minSamples) {
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Prepare data
            const { X, y } = this.prepareSequences(symbols);
            if (X.length === 0) {
                throw new Error('No valid sequences found');
            }

            // Train model
            const trained = await this.trainModel(X, y);
            if (!trained) {
                throw new Error('Model training failed');
            }

            // Get last sequence for prediction
            const lastSequence = symbols.slice(-this.sequenceLength);
            const predictionOneHot = await this.predict(lastSequence);
            const prediction = this.oneHotToSymbol(predictionOneHot);

            // Calculate confidence as max probability
            const confidence = Math.max(...predictionOneHot);

            // Update prediction history
            this.addPrediction(prediction);

            return {
                prediction,
                confidence,
                debug: {
                    probabilities: predictionOneHot,
                    log: this.debugLog
                }
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
}

module.exports = LSTMAnalysis;
