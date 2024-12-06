const Queue = require('bull');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const DatabaseManager = require('../utils/dbManager');
const PatternAnalyzer = require('../utils/patternAnalysis');
const processPatternAnalysis = require('./patternAnalysisProcessor');

class AnalysisQueue {
    constructor() {
        this.isRedisAvailable = false;
        this.queue = null;
        this.init();
    }

    async init() {
        try {
            // Redis configuration with retry strategy
            const redisConfig = {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                maxRetriesPerRequest: 3,
                enableReadyCheck: false,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 500, 2000);
                    logger.warn(`Redis connection attempt ${times} failed. Retrying in ${delay}ms`);
                    return delay;
                },
                lazyConnect: true // Don't connect immediately
            };

            // Create queue with fallback handling
            this.queue = new Queue('pattern-analysis', {
                redis: redisConfig,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000
                    },
                    removeOnComplete: 100,
                    removeOnFail: 100
                }
            });

            // Set up event handlers
            this.queue.on('error', (error) => {
                logger.error('Queue error:', error);
                this.isRedisAvailable = false;
            });

            this.queue.on('ready', () => {
                logger.info('Queue is ready');
                this.isRedisAvailable = true;
            });

            // Process jobs when Redis is available
            this.queue.process('pattern-analysis', async (job) => {
                if (!this.isRedisAvailable) {
                    // If Redis isn't available, process synchronously
                    return await this.processFallback(job);
                }
                return await processPatternAnalysis(job);
            });

        } catch (error) {
            logger.error('Failed to initialize queue:', error);
            this.isRedisAvailable = false;
        }
    }

    async processFallback(job) {
        // Fallback processing when Redis isn't available
        logger.warn('Processing job without Redis:', job.id);
        const { sequence, metadata = {} } = job.data;
        
        try {
            const analyzer = new PatternAnalyzer();
            const analysis = await analyzer.analyzeSequence(sequence);
            
            // Store results directly in database
            const result = await DatabaseManager.withTransaction(async (client) => {
                // Store prediction
                const predictionResult = await client.query(`
                    INSERT INTO model_predictions (
                        sequence_id,
                        model_type,
                        prediction_data,
                        confidence_score,
                        metadata
                    ) VALUES ($1, $2, $3, $4, $5)
                    RETURNING id
                `, [
                    metadata.sequence_id || null,
                    'pattern_analysis',
                    JSON.stringify(analysis.patterns),
                    analysis.entropy,
                    JSON.stringify({
                        ...metadata,
                        transitions: analysis.transitions,
                        uniqueSymbols: analysis.metadata.uniqueSymbols,
                        timestamp: new Date().toISOString()
                    })
                ]);

                // Store performance metrics if we have ground truth
                if (metadata.actual_seed) {
                    await client.query(`
                        INSERT INTO model_performance (
                            prediction_id,
                            actual_value,
                            predicted_value,
                            error_metrics,
                            metadata
                        ) VALUES ($1, $2, $3, $4, $5)
                    `, [
                        predictionResult.rows[0].id,
                        metadata.actual_seed,
                        analysis.patterns[0]?.[0] || null,
                        JSON.stringify({
                            entropy: analysis.entropy,
                            patternCount: analysis.patterns.length
                        }),
                        JSON.stringify({
                            analysisTimestamp: new Date().toISOString(),
                            modelType: 'pattern_analysis',
                            sequenceLength: sequence.length
                        })
                    ]);
                }

                return {
                    predictionId: predictionResult.rows[0].id,
                    analysis: analysis
                };
            });

            return result;
        } catch (error) {
            logger.error('Fallback processing failed:', error);
            throw error;
        }
    }

    async addJob(data, options = {}) {
        try {
            if (!this.isRedisAvailable) {
                // If Redis isn't available, process immediately
                return await this.processFallback({ data, id: 'fallback_' + Date.now() });
            }
            return await this.queue.add('pattern-analysis', data, options);
        } catch (error) {
            logger.error('Failed to add job:', error);
            // Fallback to immediate processing
            return await this.processFallback({ data, id: 'fallback_' + Date.now() });
        }
    }

    async shutdown() {
        if (this.queue && this.isRedisAvailable) {
            try {
                await this.queue.close();
                logger.info('Queue shutdown complete');
            } catch (error) {
                logger.error('Error during queue shutdown:', error);
            }
        }
    }
}

// Create singleton instance
const analysisQueue = new AnalysisQueue();

// Handle process termination
process.on('SIGTERM', () => analysisQueue.shutdown());
process.on('SIGINT', () => analysisQueue.shutdown());

module.exports = analysisQueue;
