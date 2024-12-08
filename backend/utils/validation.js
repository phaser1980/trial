const { Symbol } = require('../models');
const logger = require('./logger');

// Valid symbols for the game (Hearts, Diamonds, Clubs, Spades)
const VALID_SYMBOLS = [0, 1, 2, 3];

/**
 * Validates a sequence object
 * @param {Object} sequence - The sequence object to validate
 * @returns {Object} - The validated sequence object
 * @throws {Error} - If validation fails
 */
function validateSequence(sequence) {
    if (!sequence || typeof sequence !== 'object') {
        throw new Error('Invalid sequence: must be an object');
    }

    if (!VALID_SYMBOLS.includes(sequence.symbol)) {
        throw new Error(`Invalid symbol: ${sequence.symbol}. Must be one of ${VALID_SYMBOLS.join(', ')}`);
    }

    return sequence;
}

/**
 * Validates model prediction data
 * @param {Object} data - The prediction data to validate
 * @returns {Object} - The validated prediction data
 * @throws {Error} - If validation fails
 */
function validatePredictionData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid prediction data: must be an object');
    }

    if (!('predicted_symbol' in data) || !VALID_SYMBOLS.includes(data.predicted_symbol)) {
        throw new Error(`Invalid predicted symbol: ${data?.predicted_symbol}. Must be one of ${VALID_SYMBOLS.join(', ')}`);
    }

    if (data.confidence_score !== undefined) {
        const score = Number(data.confidence_score);
        if (isNaN(score) || score < 0 || score > 1) {
            throw new Error('Confidence score must be a number between 0 and 1');
        }
    }

    return data;
}

/**
 * Validates a model prediction object
 * @param {Object} prediction - The model prediction to validate
 * @returns {Object} - The validated prediction object
 * @throws {Error} - If validation fails
 */
function validateModelPrediction(prediction) {
    if (!prediction || typeof prediction !== 'object') {
        throw new Error('Invalid model prediction: must be an object');
    }

    const requiredFields = ['model_name', 'model_type', 'prediction_data'];
    for (const field of requiredFields) {
        if (!(field in prediction)) {
            throw new Error(`Missing required field in model prediction: ${field}`);
        }
    }

    // Validate prediction data
    prediction.prediction_data = validatePredictionData(prediction.prediction_data);

    if (typeof prediction.model_name !== 'string' || prediction.model_name.trim() === '') {
        throw new Error('Invalid model name: must be a non-empty string');
    }

    if (typeof prediction.model_type !== 'string' || prediction.model_type.trim() === '') {
        throw new Error('Invalid model type: must be a non-empty string');
    }

    return prediction;
}

module.exports = {
    validateSequence,
    validateModelPrediction,
    validatePredictionData,
    VALID_SYMBOLS
};
