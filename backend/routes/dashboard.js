const express = require('express');
const router = express.Router();
const Cache = require('../utils/cache');
const { errorBoundary } = require('../middleware/errorBoundary');
const RNGGenerator = require('../utils/RNGGenerator');
const StatisticalTests = require('../analysis/statisticalTests');
const logger = require('../utils/logger');

// Get dashboard metrics
router.get('/', errorBoundary(async (req, res) => {
  const { sessionId } = req.query;

  try {
    // Get RNG metrics
    const rngMetrics = await getRNGMetrics(sessionId);
    
    // Get cache performance
    const cacheMetrics = await getCacheMetrics();
    
    // Get recent sequences
    const recentSequences = await getRecentSequences(sessionId);
    
    // Get statistical analysis
    const statistics = await getStatistics(recentSequences.sequences);

    res.json({
      rng: rngMetrics,
      cache: cacheMetrics,
      recent: recentSequences,
      statistics
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    throw error;
  }
}));

async function getRNGMetrics(sessionId) {
  const cacheKey = Cache.getSequenceKey(sessionId);
  const rngState = await Cache.get(cacheKey) || {};
  
  return {
    algorithm: rngState.algorithm || 'unknown',
    weights: rngState.weights || {},
    entropy: rngState.entropy || 0,
    transitionMatrix: rngState.transitionMatrix || [],
    lastUpdate: rngState.lastUpdate || null
  };
}

async function getCacheMetrics() {
  const stats = {
    keys: 0,
    hitRate: 0,
    missRate: 0,
    ttlStats: {
      min: Infinity,
      max: -Infinity,
      avg: 0
    }
  };

  try {
    const keys = await redis.keys('*');
    stats.keys = keys.length;

    // Get TTL for each key
    const ttls = await Promise.all(
      keys.map(key => redis.ttl(key))
    );

    // Calculate TTL stats
    const validTtls = ttls.filter(ttl => ttl > 0);
    if (validTtls.length > 0) {
      stats.ttlStats = {
        min: Math.min(...validTtls),
        max: Math.max(...validTtls),
        avg: validTtls.reduce((a, b) => a + b, 0) / validTtls.length
      };
    }

    // Get hit/miss rates from cache stats
    const hits = parseInt(await redis.get('stats:hits') || '0');
    const misses = parseInt(await redis.get('stats:misses') || '0');
    const total = hits + misses;
    
    if (total > 0) {
      stats.hitRate = hits / total;
      stats.missRate = misses / total;
    }

  } catch (error) {
    logger.error('Cache metrics error:', error);
  }

  return stats;
}

async function getRecentSequences(sessionId) {
  try {
    const sequences = await Sequence.findAll({
      where: { sessionId },
      order: [['createdAt', 'DESC']],
      limit: 5,
      raw: true
    });

    return {
      sequences: sequences.map(s => s.value),
      total: await Sequence.count({ where: { sessionId } })
    };
  } catch (error) {
    logger.error('Recent sequences error:', error);
    return { sequences: [], total: 0 };
  }
}

async function getStatistics(sequences) {
  if (!sequences.length) return null;

  const combinedSequence = sequences.flat();
  return {
    runsTest: StatisticalTests.runsTest(combinedSequence),
    autocorrelation: StatisticalTests.autocorrelation(combinedSequence),
    entropy: calculateEntropy(combinedSequence)
  };
}

function calculateEntropy(sequence) {
  const counts = sequence.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});

  const n = sequence.length;
  return Object.values(counts).reduce((entropy, count) => {
    const p = count / n;
    return entropy - p * Math.log2(p);
  }, 0);
}

module.exports = router;
