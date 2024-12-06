const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const logger = require('./logger');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

class SequenceAnalyzer {
    constructor(batchId, algorithm = 'LCG') {
        this.batchId = batchId;
        this.algorithm = algorithm;
    }

    async analyzePatterns() {
        const [result] = await sequelize.query(
            'SELECT analyze_transition_patterns(:batchId) as analysis',
            {
                replacements: { batchId: this.batchId },
                type: QueryTypes.SELECT
            }
        );
        return result?.analysis || null;
    }

    async findPotentialSeeds(numSimulations = 1000) {
        const cacheKey = `potential_seeds:${this.batchId}`;
        const cached = await redis.get(cacheKey);
        
        if (cached) {
            return JSON.parse(cached);
        }

        const [result] = await sequelize.query(
            'SELECT monte_carlo_seed_search(:batchId, :numSimulations, :algorithm) as simulation',
            {
                replacements: {
                    batchId: this.batchId,
                    numSimulations,
                    algorithm: this.algorithm
                },
                type: QueryTypes.SELECT
            }
        );

        if (result?.simulation) {
            // Cache results for 5 minutes
            await redis.set(cacheKey, JSON.stringify(result.simulation), 'EX', 300);
            return result.simulation;
        }

        return null;
    }

    async compareSeeds(testSeeds) {
        if (!Array.isArray(testSeeds) || testSeeds.length === 0) {
            throw new Error('testSeeds must be a non-empty array');
        }

        const comparisons = await Promise.all(
            testSeeds.map(async (seed) => {
                const [result] = await sequelize.query(
                    'SELECT compare_seed_sequences(:batchId, :seed, :length, :algorithm) as comparison',
                    {
                        replacements: {
                            batchId: this.batchId,
                            seed,
                            length: 100,
                            algorithm: this.algorithm
                        },
                        type: QueryTypes.SELECT
                    }
                );
                return result?.comparison || null;
            })
        );

        return {
            comparisons: comparisons.filter(Boolean),
            bestMatch: comparisons.reduce((best, current) => {
                if (!best || !current) return best || current;
                return (current.confidence_score > best.confidence_score) ? current : best;
            }, null)
        };
    }

    async getPatternStrengthTimeline(window = '1 hour') {
        const cacheKey = `pattern_timeline:${this.batchId}:${window}`;
        const cached = await redis.get(cacheKey);

        if (cached) {
            return JSON.parse(cached);
        }

        const results = await sequelize.query(`
            WITH timeline AS (
                SELECT 
                    date_trunc('minute', sp.created_at) as time_bucket,
                    (analyze_transition_patterns(:batchId)->>'pattern_strength')::float as strength,
                    COUNT(*) as sample_size
                FROM sequences_partitioned sp
                WHERE sp.batch_id = :batchId
                    AND sp.created_at >= NOW() - :window::interval
                GROUP BY date_trunc('minute', sp.created_at)
                ORDER BY time_bucket DESC
            )
            SELECT 
                time_bucket,
                strength as pattern_strength,
                sample_size,
                AVG(strength) OVER (
                    ORDER BY time_bucket
                    ROWS BETWEEN 5 PRECEDING AND CURRENT ROW
                ) as moving_average
            FROM timeline
        `, {
            replacements: { batchId: this.batchId, window },
            type: QueryTypes.SELECT
        });

        if (results.length > 0) {
            // Cache for 1 minute
            await redis.set(cacheKey, JSON.stringify(results), 'EX', 60);
        }

        return results;
    }

    static async getBatchInsights(batchId) {
        const analyzer = new SequenceAnalyzer(batchId);
        const [patterns, timeline] = await Promise.all([
            analyzer.analyzePatterns(),
            analyzer.getPatternStrengthTimeline('15 minutes')
        ]);

        return {
            patterns,
            timeline,
            metadata: {
                batchId,
                timestamp: new Date().toISOString(),
                hasStrongPatterns: patterns?.analysis?.has_strong_pattern || false,
                confidenceLevel: patterns?.analysis?.confidence_level || 'low'
            }
        };
    }
}

module.exports = SequenceAnalyzer;
