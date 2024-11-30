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

    // Convert numeric index to one-hot encoding
    symbolToOneHot(symbol) {
        const oneHot = [0, 0, 0, 0];
        if (symbol >= 0 && symbol < 4) {
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
        
        this.model.add(tf.layers.lstm({
            units: 128,
            inputShape: [this.sequenceLength, 4],
            returnSequences: false
        }));
        
        this.model.add(tf.layers.dense({
            units: 64,
            activation: 'relu'
        }));
        
        this.model.add(tf.layers.dropout({
            rate: 0.3
        }));
        
        this.model.add(tf.layers.dense({
            units: 4,
            activation: 'softmax'
        }));
        
        this.model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });
        
        return this.model;
    }

    // Train model on sequences
    async trainModel(X, y) {
        const xTensor = this.trackTensor(tf.tensor3d(X));
        const yTensor = this.trackTensor(tf.tensor2d(y));
        
        await this.model.fit(xTensor, yTensor, {
            batchSize: this.batchSize,
            epochs: this.epochs,
            shuffle: true,
            verbose: 0
        });
    }

    // Make prediction for a sequence
    async predict(sequence) {
        try {
            const oneHotSequence = sequence.map(s => this.symbolToOneHot(s));
            const input = this.trackTensor(tf.tensor3d([oneHotSequence]));
            const prediction = await this.model.predict(input);
            const probabilities = await prediction.data();
            
            // Get prediction and confidence
            const maxProb = Math.max(...probabilities);
            const predictedIndex = probabilities.indexOf(maxProb);
            
            // Cleanup tensors
            prediction.dispose();
            
            return {
                prediction: predictedIndex,
                confidence: maxProb
            };
        } catch (error) {
            console.error('[LSTM] Prediction error:', error);
            return {
                prediction: null,
                confidence: 0.25
            };
        }
    }

    // Analyze sequence using LSTM
    async analyze(symbols) {
        try {
            this.debugLog = [];
            this.debugLog.push(`Starting LSTM analysis with ${symbols.length} symbols`);

            if (symbols.length < this.minSamples) {
                this.debugLog.push(`Insufficient data: ${symbols.length} < ${this.minSamples}`);
                return {
                    prediction: null,
                    confidence: 0.25,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Prepare sequences
            const [X, y] = this.prepareSequences(symbols);
            this.debugLog.push(`Prepared ${X.length} sequences for training`);

            // Create and train model
            this.createModel();
            await this.trainModel(X, y);
            this.debugLog.push('Model training completed');

            // Get last sequence for prediction
            const lastSequence = symbols.slice(-this.sequenceLength);
            const { prediction, confidence } = await this.predict(lastSequence);

            // Adjust confidence based on historical accuracy
            const adjustedConfidence = Math.min(0.95, confidence * (1 + this.getAccuracy()));

            this.debugLog.push(`Prediction results:`, {
                rawPrediction: prediction,
                rawConfidence: confidence,
                adjustedConfidence
            });

            // Update prediction history
            this.addPrediction(prediction);

            // Cleanup tensors
            this.cleanup();

            return {
                prediction,
                confidence: adjustedConfidence,
                debug: {
                    sequenceLength: this.sequenceLength,
                    trainingSequences: X.length,
                    log: this.debugLog
                }
            };

        } catch (error) {
            console.error('[LSTM] Analysis error:', error);
            this.debugLog.push(`Error in analysis: ${error.message}`);
            this.cleanup();
            return {
                prediction: null,
                confidence: 0.25,
                error: error.message,
                debug: this.debugLog
            };
        }
    }
}

module.exports = LSTMAnalysis;
