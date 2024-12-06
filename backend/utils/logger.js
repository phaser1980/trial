const winston = require('winston');
const { format } = winston;

// Custom format for structured logging
const structuredFormat = format.printf(({ level, message, timestamp, ...metadata }) => {
    const logEntry = {
        timestamp,
        level,
        message,
        ...metadata
    };

    // Add context-specific fields
    if (metadata.context) {
        logEntry.context = {
            action: metadata.context.action,
            component: metadata.context.component,
            function: metadata.context.function
        };
    }

    // Add performance metrics if available
    if (metadata.performance) {
        logEntry.performance = {
            duration: metadata.performance.duration,
            memory: metadata.performance.memory
        };
    }

    // Add error details if present
    if (metadata.error) {
        logEntry.error = {
            code: metadata.error.code,
            stack: metadata.error.stack,
            hint: metadata.error.hint
        };
    }

    return JSON.stringify(logEntry);
});

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        structuredFormat
    ),
    defaultMeta: {
        service: 'sequence-analyzer',
        environment: process.env.NODE_ENV
    },
    transports: [
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        }),
        new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 5242880,
            maxFiles: 5,
            tailable: true
        })
    ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: format.combine(
            format.colorize(),
            format.simple()
        )
    }));
}

// Helper functions for context-specific logging
logger.logAnalysis = (message, data) => {
    logger.info(message, {
        context: {
            action: 'analysis',
            component: 'sequence-analyzer',
            function: data.function
        },
        performance: {
            duration: data.duration,
            memory: process.memoryUsage().heapUsed
        },
        analysis: {
            batchId: data.batchId,
            result: data.result
        }
    });
};

logger.logPrediction = (message, data) => {
    logger.info(message, {
        context: {
            action: 'prediction',
            component: 'sequence-analyzer',
            function: data.function
        },
        prediction: {
            batchId: data.batchId,
            confidence: data.confidence,
            symbol: data.symbol
        }
    });
};

logger.logDatabaseOperation = (message, data) => {
    logger.info(message, {
        context: {
            action: 'database',
            component: data.component,
            function: data.function
        },
        operation: {
            type: data.type,
            table: data.table,
            duration: data.duration
        }
    });
};

logger.logValidation = (message, data) => {
    logger.info(message, {
        context: {
            action: 'validation',
            component: data.component,
            function: data.function
        },
        validation: {
            type: data.type,
            status: data.status,
            details: data.details
        }
    });
};

module.exports = logger;
