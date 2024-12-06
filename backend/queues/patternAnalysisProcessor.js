const PatternAnalyzer = require('../utils/patternAnalysis');
const DatabaseManager = require('../utils/dbManager');
const logger = require('../utils/logger');

async function processPatternAnalysis(job) {
    const { sequenceId, symbols, timestamp } = job.data;
    logger.info(`Processing pattern analysis for sequence ${sequenceId}`, {
        jobId: job.id,
        symbolCount: symbols.length
    });

    try {
        // Update job progress
        await job.progress(10);

        const analyzer = new PatternAnalyzer();
        const analysis = await analyzer.analyzeSequence(symbols);

        await job.progress(50);

        // Store analysis results in database
        await DatabaseManager.withTransaction(async (client) => {
            await client.query(`
                INSERT INTO sequence_analysis (
                    sequence_id,
                    entropy,
                    patterns,
                    transitions,
                    analyzed_at
                ) VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (sequence_id) 
                DO UPDATE SET 
                    entropy = EXCLUDED.entropy,
                    patterns = EXCLUDED.patterns,
                    transitions = EXCLUDED.transitions,
                    analyzed_at = NOW()
            `, [
                sequenceId,
                analysis.entropy,
                JSON.stringify(analysis.patterns),
                JSON.stringify(analysis.transitions)
            ]);

            // Update performance metrics
            await client.query(`
                INSERT INTO model_performance (
                    model_name, 
                    correct_predictions,
                    total_predictions,
                    last_updated
                )
                SELECT m.name, 0, 1, CURRENT_TIMESTAMP
                FROM (VALUES ('patternAnalysis')) AS m(name)
                ON CONFLICT (model_name) 
                DO UPDATE SET
                    total_predictions = model_performance.total_predictions + 1,
                    last_updated = CURRENT_TIMESTAMP
            `);
        });

        await job.progress(100);

        // Notify clients through WebSocket
        if (global.wsManager) {
            global.wsManager.broadcast('analysis_complete', {
                sequenceId,
                jobId: job.id,
                analysis: {
                    entropy: analysis.entropy,
                    patterns: analysis.patterns,
                    transitions: analysis.transitions
                },
                timestamp: new Date().toISOString()
            });
        }

        logger.info(`Completed pattern analysis for sequence ${sequenceId}`, {
            jobId: job.id,
            duration: Date.now() - new Date(timestamp).getTime()
        });

        return analysis;
    } catch (error) {
        logger.error(`Error processing pattern analysis for sequence ${sequenceId}`, {
            jobId: job.id,
            error: error.message,
            stack: error.stack
        });
        throw error; // Rethrow to trigger Bull.js retry mechanism
    }
}

module.exports = processPatternAnalysis;
