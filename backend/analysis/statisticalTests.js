const logger = require('../utils/logger');

class StatisticalTests {
  /**
   * Performs a runs test to evaluate randomness
   * @param {Array<number>} sequence - Array of symbols (0-3)
   * @returns {Object} Runs test results and interpretation
   */
  static runsTest(sequence) {
    try {
      const n = sequence.length;
      if (n < 2) return { isRandom: null, pValue: null, reason: 'Sequence too short' };

      // Count runs
      let runs = 1;
      for (let i = 1; i < n; i++) {
        if (sequence[i] !== sequence[i - 1]) runs++;
      }

      // Calculate expected runs and variance
      const uniqueSymbols = new Set(sequence);
      const symbolCounts = Array.from(uniqueSymbols).map(symbol =>
        sequence.filter(s => s === symbol).length
      );
      
      const N = symbolCounts.reduce((a, b) => a + b, 0);
      const expectedRuns = ((N * (N - 1)) / symbolCounts.reduce((a, b) => a + b * b, 0)) + 1;
      const variance = Math.sqrt(expectedRuns * (expectedRuns - 1) / (N - 1));

      // Calculate Z-score
      const zScore = (runs - expectedRuns) / variance;
      const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore)));

      return {
        isRandom: pValue > 0.05,
        pValue: pValue,
        runs: runs,
        expectedRuns: expectedRuns,
        zScore: zScore,
        interpretation: this.interpretRunsTest(pValue, zScore)
      };
    } catch (error) {
      logger.error('Runs test error:', error);
      return { error: 'Failed to perform runs test' };
    }
  }

  /**
   * Calculates autocorrelation at different lags
   * @param {Array<number>} sequence - Array of symbols (0-3)
   * @param {number} maxLag - Maximum lag to check (default: 5)
   * @returns {Object} Autocorrelation results and interpretation
   */
  static autocorrelation(sequence, maxLag = 5) {
    try {
      const n = sequence.length;
      if (n < maxLag + 1) return { correlations: [], interpretation: 'Sequence too short' };

      const mean = sequence.reduce((a, b) => a + b, 0) / n;
      const variance = sequence.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;

      const correlations = [];
      for (let lag = 1; lag <= maxLag; lag++) {
        let correlation = 0;
        for (let i = 0; i < n - lag; i++) {
          correlation += (sequence[i] - mean) * (sequence[i + lag] - mean);
        }
        correlation /= (n - lag) * variance;
        correlations.push({
          lag,
          value: correlation,
          significant: Math.abs(correlation) > 2 / Math.sqrt(n)
        });
      }

      return {
        correlations,
        interpretation: this.interpretAutocorrelation(correlations),
        significanceThreshold: 2 / Math.sqrt(n)
      };
    } catch (error) {
      logger.error('Autocorrelation error:', error);
      return { error: 'Failed to calculate autocorrelation' };
    }
  }

  /**
   * Helper function for normal CDF calculation
   */
  static normalCDF(x) {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  /**
   * Error function approximation
   */
  static erf(x) {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  /**
   * Interpret runs test results
   */
  static interpretRunsTest(pValue, zScore) {
    if (pValue > 0.05) {
      return 'Sequence appears random (fails to reject null hypothesis of randomness)';
    }
    return zScore > 0
      ? 'Too many runs: possible oscillating pattern'
      : 'Too few runs: possible clustering pattern';
  }

  /**
   * Interpret autocorrelation results
   */
  static interpretAutocorrelation(correlations) {
    const significantLags = correlations
      .filter(c => c.significant)
      .map(c => c.lag);

    if (significantLags.length === 0) {
      return 'No significant autocorrelation detected';
    }

    return `Significant autocorrelation at lag(s): ${significantLags.join(', ')}`;
  }
}

module.exports = StatisticalTests;
