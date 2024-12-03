const { Pool } = require('pg');
const logger = require('./logger');

class ModelWeightAdjuster {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL
        });
        
        // Base weights for different pattern types
        this.patternTypeWeights = {
            'linear': { 
                'markov': 0.6, 'lstm': 0.8, 'arima': 0.9, 
                'monte_carlo': 0.5, 'hmm': 0.7 
            },
            'periodic': { 
                'markov': 0.8, 'lstm': 0.9, 'arima': 0.7, 
                'monte_carlo': 0.6, 'hmm': 0.8 
            },
            'random': { 
                'markov': 0.5, 'lstm': 0.6, 'arima': 0.5, 
                'monte_carlo': 0.9, 'hmm': 0.7 
            }
        };

        // Learning rate for weight adjustments
        this.learningRate = 0.1;
        this.momentumFactor = 0.15;
        this.previousAdjustments = new Map();
    }

    async calculatePatternBasedWeights(client) {
        const result = await client.query(`
            SELECT 
                pas.pattern,
                pas.predictability_class,
                pas.avg_entropy,
                mpp.model_name,
                mpp.accuracy,
                mpp.confidence_correlation
            FROM pattern_analysis_summary pas
            JOIN model_pattern_performance mpp ON pas.pattern = mpp.pattern
        `);

        const weights = new Map();
        
        for (const row of result.rows) {
            const baseWeight = this._getBaseWeight(row.predictability_class);
            const entropyFactor = this._calculateEntropyFactor(row.avg_entropy);
            const performanceFactor = this._calculatePerformanceFactor(
                row.accuracy, 
                row.confidence_correlation
            );

            const modelWeight = baseWeight * entropyFactor * performanceFactor;
            
            // Apply momentum
            const previousAdjustment = this.previousAdjustments.get(row.model_name) || 0;
            const finalWeight = modelWeight + (this.momentumFactor * previousAdjustment);
            
            // Store current adjustment for next iteration
            this.previousAdjustments.set(
                row.model_name, 
                modelWeight - (weights.get(row.model_name) || 0)
            );

            weights.set(row.model_name, finalWeight);
        }

        return weights;
    }

    _getBaseWeight(predictabilityClass) {
        switch(predictabilityClass) {
            case 'High Predictability': return 0.9;
            case 'Medium Predictability': return 0.7;
            case 'Low Predictability': return 0.5;
            default: return 0.6;
        }
    }

    _calculateEntropyFactor(entropy) {
        // Lower entropy should result in higher weight
        return Math.exp(-entropy);
    }

    _calculatePerformanceFactor(accuracy, confidenceCorrelation) {
        // Combine accuracy and confidence correlation
        const accuracyWeight = 0.7;
        const correlationWeight = 0.3;
        
        // Normalize correlation from [-1,1] to [0,1]
        const normalizedCorrelation = (confidenceCorrelation + 1) / 2;
        
        return (accuracy * accuracyWeight) + 
               (normalizedCorrelation * correlationWeight);
    }

    async updateModelWeights() {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Get current pattern-based weights
            const weights = await this.calculatePatternBasedWeights(client);

            // Update weights in database
            for (const [modelName, weight] of weights.entries()) {
                await client.query(`
                    INSERT INTO model_weights (model_name, weight, updated_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (model_name) 
                    DO UPDATE SET 
                        weight = $2,
                        updated_at = NOW()
                `, [modelName, weight]);
            }

            // Log weight updates
            logger.info('Updated model weights:', Object.fromEntries(weights));

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error updating model weights:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new ModelWeightAdjuster();
