const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

// Database configuration
const config = {
  development: {
    username: process.env.DB_USER || 'postgres',
    password: 'Redman1303!',  // Using the correct password directly
    database: process.env.DB_NAME || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    dialect: 'postgres',
    logging: (msg) => logger.debug(msg),
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  },
  test: {
    username: process.env.DB_USER || 'postgres',
    password: 'Redman1303!',  // Using the correct password directly
    database: process.env.DB_NAME || 'trial_test',
    host: process.env.DB_HOST || 'localhost',
    dialect: 'postgres',
    logging: false
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    dialect: 'postgres',
    logging: false,
    pool: {
      max: 10,
      min: 2,
      acquire: 30000,
      idle: 10000
    }
  }
};

// Initialize Sequelize with the environment-specific configuration
const env = process.env.NODE_ENV || 'development';
const sequelize = new Sequelize(config[env]);

// Test database connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established successfully.');
    return true;
  } catch (error) {
    logger.error('Unable to connect to the database:', error);
    return false;
  }
};

module.exports = {
  sequelize,
  testConnection,
  config: config[env]
};
