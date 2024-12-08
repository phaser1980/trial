const logger = require('../utils/logger');

class AppError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
    this.timestamp = new Date().toISOString();
  }
}

const errorTypes = {
  DB_FUNCTION_ERROR: {
    hint: 'Check database function definitions and migrations',
    action: 'Review recent database changes and validate functions'
  },
  VALIDATION_ERROR: {
    hint: 'Check input parameters and data types',
    action: 'Verify request payload matches API specification'
  },
  SEQUENCE_ERROR: {
    hint: 'Verify sequence data and batch ID',
    action: 'Ensure sequence exists and is accessible'
  },
  ANALYSIS_ERROR: {
    hint: 'Check analysis parameters and data availability',
    action: 'Verify sufficient data for analysis'
  }
};

const getErrorContext = (error) => {
  const errorType = Object.keys(errorTypes).find(type => 
    error.message.toLowerCase().includes(type.toLowerCase().replace('_', ' '))
  );

  return errorType ? errorTypes[errorType] : {
    hint: 'Internal server error',
    action: 'Contact system administrator'
  };
};

const validateSequence = (req, res, next) => {
  const { sequence, symbol } = req.body;
  
  // Handle single symbol input
  if (symbol !== undefined) {
    if (!Number.isInteger(symbol) || symbol < 0 || symbol > 3) {
      throw new AppError('VALIDATION_ERROR', 'Symbol must be an integer between 0 and 3', 400);
    }
    return next();
  }

  // Handle sequence array input
  if (!Array.isArray(sequence)) {
    throw new AppError('VALIDATION_ERROR', 'Sequence must be an array', 400);
  }

  if (sequence.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Sequence cannot be empty', 400);
  }

  if (sequence.some(s => !Number.isInteger(s) || s < 0 || s > 3)) {
    throw new AppError('VALIDATION_ERROR', 'Sequence must contain integers between 0 and 3', 400);
  }

  next();
};

const errorBoundary = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    logger.error('Route error:', {
      error: error.message,
      stack: error.stack,
      path: req.path
    });

    // Ensure JSON response
    res.setHeader('Content-Type', 'application/json');
    
    if (error instanceof AppError) {
      const context = getErrorContext(error);
      res.status(error.status).json({
        error: error.message,
        code: error.code,
        timestamp: error.timestamp,
        ...context
      });
    } else {
      res.status(500).json({
        error: 'Internal server error',
        message: error.message || 'An unexpected error occurred'
      });
    }
  }
};

module.exports = {
  AppError,
  errorBoundary,
  validateSequence
};
