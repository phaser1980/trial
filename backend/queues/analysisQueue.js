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
        logger.info('Processing analysis job:', { jobId: job.id });
        const { sequenceId, symbols, timestamp, metadata = {} } = job.data;
        
        try {
            // Verify sequence exists first
            const sequenceExists = await DatabaseManager.withTransaction(async (client) => {
                const result = await client.query(
                    'SELECT 1 FROM sequences WHERE id = $1',
                    [sequenceId]
                );
                return result.rowCount > 0;
            });

            if (!sequenceExists) {
                logger.error('Sequence not found:', { sequenceId });
                throw new Error(`Sequence ${sequenceId} not found`);
            }

            const analyzer = new PatternAnalyzer();
            const analysis = await analyzer.analyzeSequence(symbols);
            
            // Store results in database
            await DatabaseManager.withTransaction(async (client) => {
                // Store prediction
                await client.query(`
                    INSERT INTO model_predictions (
                        sequence_id,
                        model_type,
                        prediction_data,
                        confidence_score,
                        metadata,
                        created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (sequence_id, model_type) 
                    DO UPDATE SET
                        prediction_data = EXCLUDED.prediction_data,
                        confidence_score = EXCLUDED.confidence_score,
                        metadata = EXCLUDED.metadata,
                        updated_at = NOW()
                `, [
                    sequenceId,
                    'pattern_analysis',
                    JSON.stringify(analysis.patterns),
                    analysis.entropy,
                    JSON.stringify({
                        timestamp,
                        transitions: analysis.transitions,
                        uniqueSymbols: analysis.metadata.uniqueSymbols,
                        ...metadata
                    }),
                    timestamp
                ]);

                logger.info('Analysis stored successfully', { 
                    jobId: job.id,
                    sequenceId,
                    type: 'pattern_analysis'
                });
            });

            return {
                success: true,
                sequenceId,
                jobId: job.id,
                analysisType: 'pattern_analysis'
            };
        } catch (error) {
            logger.error('Analysis failed:', { 
                error: error.message,
                jobId: job.id,
                sequenceId
            });
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
