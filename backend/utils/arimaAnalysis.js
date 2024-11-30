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

    // Convert symbols to numerical values
    symbolToNumber(symbol) {
        const mapping = { '♠': 0, '♣': 1, '♥': 2, '♦': 3 };
        return mapping[symbol] ?? -1;
    }

    numberToSymbol(number) {
        const mapping = ['♠', '♣', '♥', '♦'];
        return mapping[Math.round(number) % 4] ?? null;
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
        if (order === 0) return diffed;
        const result = [];
        let lastOriginal = original[original.length - 1];
        for (const diff of diffed) {
            const value = diff + lastOriginal;
            result.push(value);
            lastOriginal = value;
        }
        return result;
    }

    // Fit AR model using tensorflow
    async fitAR(data, order) {
        try {
            const X = [];
            const y = [];
            for (let i = order; i < data.length; i++) {
                X.push(data.slice(i - order, i));
                y.push(data[i]);
            }

            const xTensor = this.trackTensor(tf.tensor2d(X));
            const yTensor = this.trackTensor(tf.tensor1d(y));

            const model = tf.sequential();
            model.add(tf.layers.dense({ units: 1, inputShape: [order] }));
            
            await model.compile({
                optimizer: tf.train.adam(0.01),
                loss: 'meanSquaredError'
            });

            await model.fit(xTensor, yTensor, {
                epochs: 100,
                verbose: 0
            });

            return model;
        } catch (error) {
            this.debugLog.push(`AR model fitting error: ${error.message}`);
            throw error;
        }
    }

    // Predict next value using the ARIMA model
    async predict(data) {
        try {
            // Difference the data
            let diffed = this.difference(data, this.d);
            
            // Fit AR model
            const model = await this.fitAR(diffed, this.p);
            
            // Prepare last p values for prediction
            const lastValues = diffed.slice(-this.p);
            const input = this.trackTensor(tf.tensor2d([lastValues]));
            
            // Make prediction
            const diffPrediction = model.predict(input);
            const predictionValue = await diffPrediction.data();
            
            // Inverse difference
            const prediction = this.inverseDifference(
                [predictionValue[0]], 
                data,
                this.d
            )[0];

            return prediction;
        } catch (error) {
            this.debugLog.push(`Prediction error: ${error.message}`);
            throw error;
        }
    }

    async analyze(symbols) {
        try {
            this.debugLog = [];
            this.debugLog.push(`Starting ARIMA analysis with ${symbols.length} symbols`);

            // Validate input
            if (!Array.isArray(symbols)) {
                this.debugLog.push('Invalid input: symbols must be an array');
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Invalid input format',
                    debug: this.debugLog
                };
            }

            if (symbols.length < this.minSamples) {
                this.debugLog.push(`Insufficient data: ${symbols.length} < ${this.minSamples}`);
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Filter and convert valid symbols to numbers
            const validSymbols = ['♠', '♣', '♥', '♦'];
            const numericalData = [];
            const invalidSymbols = new Set();

            for (let i = 0; i < symbols.length; i++) {
                const symbol = symbols[i];
                if (validSymbols.includes(symbol)) {
                    numericalData.push(this.symbolToNumber(symbol));
                } else {
                    invalidSymbols.add(symbol);
                }
            }

            // Log invalid symbols if found
            if (invalidSymbols.size > 0) {
                this.debugLog.push(`Found invalid symbols: ${Array.from(invalidSymbols).join(', ')}`);
            }

            // Check if we have enough valid data after filtering
            if (numericalData.length < this.minSamples) {
                this.debugLog.push(`Insufficient valid symbols after filtering: ${numericalData.length} < ${this.minSamples}`);
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient valid symbols',
                    debug: this.debugLog
                };
            }

            // Log data quality metrics
            const validRatio = numericalData.length / symbols.length;
            this.debugLog.push(`Data quality: ${(validRatio * 100).toFixed(1)}% valid symbols`);

            // Make prediction with valid data
            const numericPrediction = await this.predict(numericalData);
            const prediction = this.numberToSymbol(numericPrediction);

            // Adjust confidence based on data quality
            let confidence = Math.min(0.95, 0.7 + this.getAccuracy());
            confidence *= validRatio; // Reduce confidence if we had to filter out invalid symbols

            // Update prediction history
            this.addPrediction(prediction);

            return {
                prediction,
                confidence,
                debug: {
                    numericalPrediction: numericPrediction,
                    validSymbols: numericalData.length,
                    totalSymbols: symbols.length,
                    dataQuality: validRatio,
                    log: this.debugLog
                }
            };

        } catch (error) {
            console.error('[ARIMA] Analysis error:', error);
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

module.exports = ARIMAAnalysis;
