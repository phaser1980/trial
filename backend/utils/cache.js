const Redis = require('ioredis');
const logger = require('./logger');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const DEFAULT_TTL = 300; // 5 minutes

class Cache {
  static async get(key) {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis get error:', error);
      return null;
    }
  }

  static async set(key, value, ttl = DEFAULT_TTL) {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttl);
      return true;
    } catch (error) {
      logger.error('Redis set error:', error);
      return false;
    }
  }

  static async del(key) {
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      logger.error('Redis delete error:', error);
      return false;
    }
  }

  static async flush() {
    try {
      await redis.flushdb();
      logger.info('Redis cache flushed');
      return true;
    } catch (error) {
      logger.error('Redis flush error:', error);
      return false;
    }
  }

  // Helper for analytics caching
  static getAnalyticsKey(sessionId, timeframe) {
    return `analytics:${sessionId}:${timeframe}`;
  }

  // Helper for sequence caching
  static getSequenceKey(sessionId) {
    return `sequence:${sessionId}`;
  }
}

module.exports = Cache;
