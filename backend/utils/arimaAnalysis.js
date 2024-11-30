const tf = require('@tensorflow/tfjs');
const AnalysisTool = require('./AnalysisTool');

class ARIMAAnalysis extends AnalysisTool {
    constructor() {
        super('ARIMA Analysis');
        this.p = 2; // autoregressive order
        this.d = 1; // difference order
        this.q = 2; // moving average order
        this.minSamples = 30;
        this.debugLog = [];
        this.tensors = new Set();
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

    // Calculate differences
    difference(data, order = 1) {
        if (order === 0) return data;
        const diffed = [];
        for (let i = order; i < data.length; i++) {
            diffed.push(data[i] - data[i - order]);
        }
        return diffed;
    }

    // Inverse difference
    inverseDifference(diffed, original, order = 1) {
        const result = new Array(diffed.length + order).fill(0);
        
        // Copy original values for the first 'order' elements
        for (let i = 0; i < order; i++) {
            result[i] = original[i];
        }
        
        // Reconstruct the series
        for (let i = order; i < result.length; i++) {
            result[i] = diffed[i - order] + result[i - order];
        }
        
        return result;
    }

    // Calculate moving average coefficients
    async calculateMA(data, order) {
        const X = [];
        const y = [];
        
        for (let i = order; i < data.length; i++) {
            const row = [];
            for (let j = 1; j <= order; j++) {
                row.push(data[i - j]);
            }
            X.push(row);
            y.push(data[i]);
        }
        
        // Use TensorFlow.js for linear regression
        const xTensor = this.trackTensor(tf.tensor2d(X));
        const yTensor = this.trackTensor(tf.tensor1d(y));
        
        const model = tf.sequential();
        model.add(tf.layers.dense({ units: 1, inputShape: [order] }));
        model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
        
        await model.fit(xTensor, yTensor, { epochs: 100, verbose: 0 });
        const weights = model.layers[0].getWeights()[0].arraySync().map(w => w[0]);
        
        model.dispose();
        return weights;
    }

    // Calculate autoregressive coefficients
    async calculateAR(data, order) {
        const X = [];
        const y = [];
        
        for (let i = order; i < data.length; i++) {
            const row = [];
            for (let j = 1; j <= order; j++) {
                row.push(data[i - j]);
            }
            X.push(row);
            y.push(data[i]);
        }
        
        // Use TensorFlow.js for linear regression
        const xTensor = this.trackTensor(tf.tensor2d(X));
        const yTensor = this.trackTensor(tf.tensor1d(y));
        
        const model = tf.sequential();
        model.add(tf.layers.dense({ units: 1, inputShape: [order] }));
        model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
        
        await model.fit(xTensor, yTensor, { epochs: 100, verbose: 0 });
        const weights = model.layers[0].getWeights()[0].arraySync().map(w => w[0]);
        
        model.dispose();
        return weights;
    }

    // Make prediction using ARIMA model
    async predict(data) {
        try {
            // Apply differencing
            let diffed = data;
            for (let i = 0; i < this.d; i++) {
                diffed = this.difference(diffed);
            }
            
            // Calculate AR and MA coefficients
            const arCoeffs = await this.calculateAR(diffed, this.p);
            const maCoeffs = await this.calculateMA(diffed, this.q);
            
            // Make prediction
            let prediction = 0;
            
            // AR component
            for (let i = 0; i < this.p; i++) {
                prediction += arCoeffs[i] * diffed[diffed.length - 1 - i];
            }
            
            // MA component
            for (let i = 0; i < this.q; i++) {
                prediction += maCoeffs[i] * diffed[diffed.length - 1 - i];
            }
            
            // Inverse differencing
            let result = prediction;
            for (let i = this.d - 1; i >= 0; i--) {
                const temp = this.inverseDifference([result], data.slice(-this.d), 1);
                result = temp[temp.length - 1];
            }
            
            // Convert to symbol index (0-3)
            result = Math.round(result) % 4;
            if (result < 0) result += 4;
            
            // Calculate confidence based on model fit
            const confidence = Math.min(0.95, 0.5 + Math.abs(arCoeffs[0]));
            
            return { prediction: result, confidence };
            
        } catch (error) {
            console.error('[ARIMA] Prediction error:', error);
            return { prediction: null, confidence: 0.25 };
        }
    }

    async analyze(symbols) {
        try {
            this.debugLog = [];
            this.debugLog.push(`Starting ARIMA analysis with ${symbols.length} symbols`);

            if (symbols.length < this.minSamples) {
                this.debugLog.push(`Insufficient data: ${symbols.length} < ${this.minSamples}`);
                return {
                    prediction: null,
                    confidence: 0.25,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Convert symbols to numeric indices
            const numericData = symbols.map(s => parseInt(s));
            
            // Get prediction
            const { prediction, confidence } = await this.predict(numericData);
            
            // Adjust confidence based on historical accuracy
            const adjustedConfidence = Math.min(0.95, confidence * (1 + this.getAccuracy()));

            this.debugLog.push(`Prediction results:`, {
                prediction,
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
                    p: this.p,
                    d: this.d,
                    q: this.q,
                    log: this.debugLog
                }
            };

        } catch (error) {
            console.error('[ARIMA] Analysis error:', error);
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

module.exports = ARIMAAnalysis;
