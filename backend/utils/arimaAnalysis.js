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
        this.modelState = {
            lastPrediction: null,
            confidence: 0,
            errorHistory: [],
            needsRetraining: false
        };
        this.hyperparameters = {
            learningRate: 0.01,
            epochs: 100,
            batchSize: 32,
            validationSplit: 0.2
        };
    }

    // Validate and clean input data
    validateData(data) {
        if (!Array.isArray(data) || data.length < this.minSamples) {
            throw new Error(`Insufficient data: need at least ${this.minSamples} samples`);
        }

        // Convert to numbers and handle invalid values
        const cleaned = data.map(val => {
            const num = Number(val);
            return isNaN(num) ? null : num;
        });

        // Handle missing values using interpolation
        const interpolated = this.interpolateMissingValues(cleaned);
        
        if (interpolated.some(val => val === null || isNaN(val))) {
            throw new Error('Unable to clean data: too many invalid values');
        }

        return interpolated;
    }

    // Interpolate missing values
    interpolateMissingValues(data) {
        const result = [...data];
        let start = 0;

        while (start < result.length) {
            if (result[start] === null || isNaN(result[start])) {
                // Find the next valid value
                let end = start + 1;
                while (end < result.length && (result[end] === null || isNaN(result[end]))) {
                    end++;
                }

                // Interpolate between valid values
                if (start > 0 && end < result.length) {
                    const startVal = result[start - 1];
                    const endVal = result[end];
                    const step = (endVal - startVal) / (end - start + 1);
                    
                    for (let i = start; i < end; i++) {
                        result[i] = startVal + step * (i - start + 1);
                    }
                } else {
                    // Edge case: use nearest valid value
                    const validValue = start > 0 ? result[start - 1] : result[end];
                    result[start] = validValue;
                }
                start = end;
            } else {
                start++;
            }
        }

        return result;
    }

    // Enhanced difference calculation with error handling
    difference(data, order = 1) {
        if (order === 0) return data;
        
        try {
            const diffed = [];
            for (let i = order; i < data.length; i++) {
                const diff = data[i] - data[i - order];
                if (isNaN(diff)) {
                    console.warn(`[ARIMA] NaN detected in difference calculation at index ${i}`);
                    continue;
                }
                diffed.push(diff);
            }
            return diffed;
        } catch (error) {
            console.error('[ARIMA] Error in difference calculation:', error);
            throw error;
        }
    }

    // Enhanced inverse difference with validation
    inverseDifference(diffed, original, order = 1) {
        try {
            const result = new Array(diffed.length + order).fill(0);
            
            // Validate and copy original values
            for (let i = 0; i < order; i++) {
                if (isNaN(original[i])) {
                    throw new Error(`Invalid original value at index ${i}`);
                }
                result[i] = original[i];
            }
            
            // Reconstruct the series with validation
            for (let i = order; i < result.length; i++) {
                const diff = diffed[i - order];
                const prev = result[i - order];
                
                if (isNaN(diff) || isNaN(prev)) {
                    throw new Error(`Invalid values detected at index ${i}`);
                }
                
                result[i] = diff + prev;
            }
            
            return result;
        } catch (error) {
            console.error('[ARIMA] Error in inverse difference:', error);
            throw error;
        }
    }

    // Enhanced MA calculation with regularization
    async calculateMA(data, order) {
        const X = [];
        const y = [];
        
        // Prepare training data with validation
        for (let i = order; i < data.length; i++) {
            if (data.slice(i - order, i).some(val => isNaN(val))) {
                console.warn(`[ARIMA] Skipping invalid data at index ${i}`);
                continue;
            }
            
            const row = [];
            for (let j = 1; j <= order; j++) {
                row.push(data[i - j]);
            }
            X.push(row);
            y.push(data[i]);
        }
        
        if (X.length === 0) {
            throw new Error('No valid training data available');
        }
        
        // Use TensorFlow.js with enhanced model configuration
        const xTensor = this.trackTensor(tf.tensor2d(X));
        const yTensor = this.trackTensor(tf.tensor1d(y));
        
        const model = tf.sequential();
        model.add(tf.layers.dense({
            units: 1,
            inputShape: [order],
            kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
            kernelInitializer: 'glorotNormal'
        }));
        
        model.compile({
            optimizer: tf.train.adam(this.hyperparameters.learningRate),
            loss: 'meanSquaredError',
            metrics: ['mse']
        });
        
        try {
            const history = await model.fit(xTensor, yTensor, {
                epochs: this.hyperparameters.epochs,
                batchSize: this.hyperparameters.batchSize,
                validationSplit: this.hyperparameters.validationSplit,
                verbose: 0,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        if (epoch % 10 === 0) {
                            console.log(`[ARIMA] MA Training - Epoch ${epoch}: loss = ${logs.loss.toFixed(4)}`);
                        }
                    }
                }
            });
            
            const weights = model.layers[0].getWeights()[0].arraySync().map(w => w[0]);
            model.dispose();
            
            // Update model state
            this.modelState.lastTrainingLoss = history.history.loss[history.history.loss.length - 1];
            this.modelState.needsRetraining = this.modelState.lastTrainingLoss > 0.1;
            
            return weights;
        } catch (error) {
            console.error('[ARIMA] Error in MA calculation:', error);
            throw error;
        }
    }

    // Enhanced AR calculation with validation and error tracking
    async calculateAR(data, order) {
        try {
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
            
            const xTensor = this.trackTensor(tf.tensor2d(X));
            const yTensor = this.trackTensor(tf.tensor1d(y));
            
            const model = tf.sequential();
            model.add(tf.layers.dense({
                units: 1,
                inputShape: [order],
                kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
                activation: 'linear'
            }));
            
            model.compile({
                optimizer: tf.train.adam(this.hyperparameters.learningRate),
                loss: 'meanSquaredError'
            });
            
            const history = await model.fit(xTensor, yTensor, {
                epochs: this.hyperparameters.epochs,
                batchSize: this.hyperparameters.batchSize,
                validationSplit: this.hyperparameters.validationSplit,
                verbose: 0
            });
            
            const weights = model.layers[0].getWeights()[0].arraySync().map(w => w[0]);
            model.dispose();
            
            // Track error history
            this.modelState.errorHistory.push({
                timestamp: Date.now(),
                loss: history.history.loss[history.history.loss.length - 1]
            });
            
            // Keep only recent error history
            if (this.modelState.errorHistory.length > 100) {
                this.modelState.errorHistory.shift();
            }
            
            return weights;
        } catch (error) {
            console.error('[ARIMA] Error in AR calculation:', error);
            throw error;
        }
    }

    // Main analysis function with enhanced error handling and validation
    async analyze(symbols) {
        try {
            if (symbols.length < this.minSamples) {
                return {
                    prediction: null,
                    confidence: 0,
                    error: `Need at least ${this.minSamples} samples`
                };
            }

            // Clean and validate input data
            const data = this.validateData(symbols);
            
            // Calculate differences
            const diffed = this.difference(data, this.d);
            
            // Calculate AR and MA coefficients
            const [arCoef, maCoef] = await Promise.all([
                this.calculateAR(diffed, this.p),
                this.calculateMA(diffed, this.q)
            ]);
            
            // Make prediction
            const prediction = await this.predict(data, arCoef, maCoef);
            
            // Calculate confidence based on recent performance
            const confidence = this.calculateConfidence();
            
            // Update model state
            this.modelState.lastPrediction = prediction;
            this.modelState.confidence = confidence;
            
            return {
                prediction,
                confidence,
                modelState: { ...this.modelState }
            };
        } catch (error) {
            console.error('[ARIMA] Analysis error:', error);
            return {
                prediction: null,
                confidence: 0,
                error: error.message
            };
        } finally {
            this.cleanup();
        }
    }

    // Calculate prediction confidence based on error history
    calculateConfidence() {
        if (this.modelState.errorHistory.length === 0) return 0.5;
        
        const recentErrors = this.modelState.errorHistory.slice(-10);
        const avgError = recentErrors.reduce((sum, e) => sum + e.loss, 0) / recentErrors.length;
        
        // Convert error to confidence score (0-1)
        const confidence = Math.max(0, Math.min(1, 1 - avgError));
        
        // Adjust confidence based on training needs
        return this.modelState.needsRetraining ? confidence * 0.8 : confidence;
    }

    // Enhanced prediction function
    async predict(data, arCoef, maCoef) {
        try {
            // Use recent values for prediction
            const recent = data.slice(-Math.max(this.p, this.q));
            
            // Calculate AR component
            let arComponent = 0;
            for (let i = 0; i < this.p; i++) {
                arComponent += arCoef[i] * recent[recent.length - 1 - i];
            }
            
            // Calculate MA component
            let maComponent = 0;
            for (let i = 0; i < this.q; i++) {
                maComponent += maCoef[i] * recent[recent.length - 1 - i];
            }
            
            // Combine components and handle inverse difference
            const diffPrediction = arComponent + maComponent;
            const prediction = this.inverseDifference([diffPrediction], recent, this.d);
            
            // Ensure prediction is within valid range (0-3)
            return Math.max(0, Math.min(3, Math.round(prediction[prediction.length - 1])));
        } catch (error) {
            console.error('[ARIMA] Prediction error:', error);
            throw error;
        }
    }
}

module.exports = ARIMAAnalysis;
