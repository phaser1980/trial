const tf = require('@tensorflow/tfjs');
const AnalysisTool = require('./AnalysisTool');

class ARIMAAnalysis extends AnalysisTool {
    constructor() {
        super('ARIMA Analysis');
        this.minSamples = 50;
        this.p = 2;  // Autoregressive order
        this.d = 1;  // Difference order
        this.q = 2;  // Moving average order
        this.debugLog = [];
    }

    // Calculate differences
    difference(data, order = 1) {
        if (order === 0) return data;
        const diff = [];
        for (let i = order; i < data.length; i++) {
            diff.push(data[i] - data[i - order]);
        }
        return diff;
    }

    // Calculate autoregressive terms
    calculateAR(data, order) {
        const matrix = [];
        const y = [];
        for (let i = order; i < data.length; i++) {
            const row = [];
            for (let j = 1; j <= order; j++) {
                row.push(data[i - j]);
            }
            matrix.push(row);
            y.push(data[i]);
        }
        return { matrix, y };
    }

    // Calculate moving average terms
    calculateMA(data, order, errors) {
        const matrix = [];
        for (let i = order; i < data.length; i++) {
            const row = [];
            for (let j = 1; j <= order; j++) {
                row.push(errors[i - j] || 0);
            }
            matrix.push(row);
        }
        return matrix;
    }

    // Fit ARIMA model
    async fit(data) {
        const tensors = [];  // Keep track of tensors to dispose later
        try {
            this.debugLog.push('Starting ARIMA model fitting');
            
            // Apply differencing
            let diffData = this.difference(data, this.d);
            this.debugLog.push(`Applied differencing of order ${this.d}`);

            // Calculate AR terms
            const { matrix: arMatrix, y } = this.calculateAR(diffData, this.p);
            this.debugLog.push(`Calculated AR terms of order ${this.p}`);

            // Ensure matrix is properly formatted for tensor2d
            const formattedMatrix = arMatrix.map(row => Array.from(row));
            const X = tf.keep(tf.tensor2d(formattedMatrix));
            tensors.push(X);
            const Y = tf.keep(tf.tensor1d(Array.from(y)));
            tensors.push(Y);

            // Fit AR model using pseudoinverse for better numerical stability
            const Xt = tf.keep(X.transpose());
            tensors.push(Xt);
            const XtX = tf.keep(Xt.matMul(X));
            tensors.push(XtX);
            const XtY = tf.keep(Xt.matMul(Y.expandDims(1)));
            tensors.push(XtY);
            
            // Convert to array for pseudoinverse calculation
            const XtXArray = XtX.arraySync();
            const pseudoInvResult = this.pseudoInverse(XtXArray);
            
            // Convert back to tensor for final calculation
            const XtXInv = tf.keep(tf.tensor2d(pseudoInvResult));
            tensors.push(XtXInv);
            const coefficients = tf.keep(XtXInv.matMul(XtY).squeeze());
            tensors.push(coefficients);

            // Calculate residuals
            const predicted = tf.keep(X.matMul(coefficients.expandDims(1)).squeeze());
            tensors.push(predicted);
            const errors = tf.sub(Y, predicted).arraySync();
            this.debugLog.push('Calculated model residuals');

            // Calculate MA terms
            const maMatrix = this.calculateMA(diffData, this.q, errors);
            this.debugLog.push(`Calculated MA terms of order ${this.q}`);

            // Store results before cleaning up tensors
            const results = {
                arCoef: coefficients.arraySync(),
                maMatrix,
                lastValues: data.slice(-this.p),
                lastErrors: errors.slice(-this.q)
            };

            // Clean up tensors only after we're done using them
            tensors.forEach(tensor => {
                if (tensor && tensor.dispose) {
                    tensor.dispose();
                }
            });

            return results;

        } catch (error) {
            // Clean up tensors in case of error
            tensors.forEach(tensor => {
                if (tensor && tensor.dispose) {
                    tensor.dispose();
                }
            });
            this.debugLog.push(`Error in model fitting: ${error.message}`);
            throw error;
        }
    }

    // Helper method for matrix pseudoinverse
    pseudoInverse(matrix) {
        const svd = this.singularValueDecomposition(matrix);
        const threshold = 1e-10;
        const s = svd.s.map(val => (Math.abs(val) < threshold ? 0 : 1 / val));
        
        const n = matrix[0].length;
        const Vt = this.transpose(svd.V);
        const U = svd.U;
        
        // Compute pseudoinverse
        const result = Array(n).fill().map(() => Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                for (let k = 0; k < n; k++) {
                    result[i][j] += Vt[i][k] * s[k] * U[j][k];
                }
            }
        }
        return result;
    }

    // Singular Value Decomposition implementation
    singularValueDecomposition(A) {
        const n = A.length;
        let U = Array(n).fill().map(() => Array(n).fill(0));
        let V = Array(n).fill().map(() => Array(n).fill(0));
        let s = Array(n).fill(0);

        // Simple SVD implementation for 2x2 matrices (sufficient for AR(2) model)
        if (n === 2) {
            const a = A[0][0], b = A[0][1], c = A[1][0], d = A[1][1];
            const theta = 0.5 * Math.atan2(2 * (a * c + b * d), a * a + b * b - c * c - d * d);
            const cost = Math.cos(theta), sint = Math.sin(theta);
            
            U = [[cost, -sint], [sint, cost]];
            V = [[cost, -sint], [sint, cost]];
            
            const B = this.matrixMultiply(this.matrixMultiply(this.transpose(U), A), V);
            s = [B[0][0], B[1][1]];
        } else {
            // For larger matrices, use a simpler approximation
            for (let i = 0; i < n; i++) {
                s[i] = Math.sqrt(A[i].reduce((sum, val) => sum + val * val, 0));
                U[i][i] = 1;
                V[i][i] = 1;
            }
        }

        return { U, s, V };
    }

    // Helper method for matrix multiplication
    matrixMultiply(A, B) {
        const n = A.length;
        const result = Array(n).fill().map(() => Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                for (let k = 0; k < n; k++) {
                    result[i][j] += A[i][k] * B[k][j];
                }
            }
        }
        return result;
    }

    // Helper method for matrix transpose
    transpose(matrix) {
        return matrix[0].map((_, i) => matrix.map(row => row[i]));
    }

    // Make prediction
    async predict(model, data) {
        const tensors = [];  // Keep track of tensors
        try {
            this.debugLog.push('Starting prediction');
            
            // Calculate AR component
            let arComponent = 0;
            const coefficients = tf.keep(tf.tensor1d(model.arCoef));
            tensors.push(coefficients);
            
            const lastValues = tf.keep(tf.tensor1d(data.slice(-this.p)));
            tensors.push(lastValues);
            
            arComponent = tf.sum(tf.mul(coefficients, lastValues)).arraySync();

            // Calculate MA component
            let maComponent = 0;
            for (let i = 0; i < this.q; i++) {
                maComponent += 0.1 * model.lastErrors[i]; // Simple MA coefficient
            }

            // Combine components
            const prediction = arComponent + maComponent;
            this.debugLog.push(`Prediction components - AR: ${arComponent}, MA: ${maComponent}`);

            // Map to nearest valid symbol
            const symbols = ['♠', '♣', '♥', '♦'];
            const symbolIndex = Math.floor((prediction + 2) % 4);
            const confidence = Math.min(0.95, Math.abs(prediction - Math.floor(prediction)));

            // Clean up tensors
            tensors.forEach(tensor => {
                if (tensor && tensor.dispose) {
                    tensor.dispose();
                }
            });

            return {
                prediction: symbols[symbolIndex],
                confidence,
                components: { ar: arComponent, ma: maComponent }
            };

        } catch (error) {
            // Clean up tensors in case of error
            tensors.forEach(tensor => {
                if (tensor && tensor.dispose) {
                    tensor.dispose();
                }
            });
            this.debugLog.push(`Error in prediction: ${error.message}`);
            throw error;
        }
    }

    // Main analysis method
    async analyze(symbols) {
        try {
            this.debugLog = [];
            this.debugLog.push(`Starting ARIMA analysis with ${symbols.length} symbols`);

            if (symbols.length < this.minSamples) {
                this.debugLog.push(`Insufficient data: ${symbols.length} < ${this.minSamples}`);
                return {
                    prediction: null,
                    confidence: 0,
                    message: 'Insufficient data',
                    debug: this.debugLog
                };
            }

            // Convert symbols to numerical values
            const numericalData = symbols.map(s => {
                switch (s) {
                    case '♠': return 0;
                    case '♣': return 1;
                    case '♥': return 2;
                    case '♦': return 3;
                    default: return 0;
                }
            });

            // Fit model
            const model = await this.fit(numericalData);
            this.debugLog.push('Model fitted successfully');

            // Make prediction
            const result = await this.predict(model, numericalData);
            this.debugLog.push(`Prediction made: ${result.prediction} with confidence ${result.confidence}`);

            // Update prediction history
            this.addPrediction(result.prediction);

            return {
                prediction: result.prediction,
                confidence: result.confidence,
                components: result.components,
                debug: this.debugLog
            };

        } catch (error) {
            this.debugLog.push(`Error in analysis: ${error.message}`);
            console.error('[ARIMA] Analysis error:', error);
            return {
                prediction: null,
                confidence: 0,
                error: error.message,
                debug: this.debugLog
            };
        }
    }
}

// Export the ARIMAAnalysis class
module.exports = ARIMAAnalysis;
