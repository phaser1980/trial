const logger = require('../utils/logger');

class AppError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const errorCodes = {
  INVALID_SEQUENCE: {
    message: 'Invalid sequence format or values',
    status: 400
  },
  TRANSACTION_TIMEOUT: {
    message: 'Operation timed out',
    status: 408
  },
  MEMORY_THRESHOLD: {
    message: 'Server is busy, please try again later',
    status: 503
  },
  DATABASE_ERROR: {
    message: 'Database operation failed',
    status: 500
  }
};

const errorBoundary = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    // Handle known error types
    if (error instanceof AppError) {
      logger.warn('Known error occurred:', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      
      return res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    // Handle PostgreSQL specific errors
    if (error.code) {
      switch (error.code) {
        case '40P01': // Deadlock
          logger.error('Deadlock detected:', error);
          return res.status(409).json({
            error: {
              code: 'DEADLOCK_DETECTED',
              message: 'Resource conflict, please try again'
            }
          });
        case '57014': // Query canceled
          logger.error('Query canceled:', error);
          return res.status(408).json({
            error: {
              code: 'QUERY_TIMEOUT',
              message: 'Operation timed out'
            }
          });
      }
    }

    // Log unknown errors
    logger.error('Unhandled error:', {
      error: error.message,
      stack: error.stack
    });

    // Generic error response
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
};

// Middleware to validate sequence input
const validateSequence = (req, res, next) => {
  const { symbol, sequence } = req.body;

  // Handle single symbol input
  if (symbol !== undefined) {
    if (!Number.isInteger(symbol) || symbol < 0 || symbol > 3) {
      throw new AppError(
        'INVALID_SYMBOL',
        'Symbol must be an integer between 0 and 3',
        400
      );
    }
    return next();
  }

  // Handle sequence array input
  if (sequence !== undefined) {
    if (!Array.isArray(sequence)) {
      throw new AppError(
        'INVALID_SEQUENCE',
        'Sequence must be an array',
        400
      );
    }
    
    if (sequence.length > 10000) {
      throw new AppError(
        'SEQUENCE_TOO_LONG',
        'Sequence exceeds maximum length',
        400
      );
    }
    
    if (!sequence.every(num => Number.isInteger(num) && num >= 0 && num <= 3)) {
      throw new AppError(
        'INVALID_SEQUENCE_VALUES',
        'Sequence values must be integers between 0 and 3',
        400
      );
    }
  } else {
    throw new AppError(
      'MISSING_INPUT',
      'Request must include either a symbol or sequence',
      400
    );
  }
  
  next();
};

module.exports = {
  errorBoundary,
  AppError,
  errorCodes,
  validateSequence
};
