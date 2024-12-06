const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

class SequenceAnalytics extends Model {}

SequenceAnalytics.init({
  id: {
    type: DataTypes.UUID,
    primaryKey: true
  },
  time_bucket: {
    type: DataTypes.DATE,
    allowNull: false
  },
  sequence_count: {
    type: DataTypes.INTEGER,
    get() {
      const rawValue = this.getDataValue('sequence_count');
      return rawValue !== null ? Number(rawValue) : null;
    }
  },
  avg_entropy: {
    type: DataTypes.FLOAT,
    get() {
      const rawValue = this.getDataValue('avg_entropy');
      return rawValue !== null ? Number(rawValue) : null;
    }
  },
  pattern_distribution: {
    type: DataTypes.JSONB,
    get() {
      const rawValue = this.getDataValue('pattern_distribution');
      if (!rawValue) return null;
      return {
        detected: rawValue.detected !== null ? Number(rawValue.detected) : null,
        not_detected: rawValue.not_detected !== null ? Number(rawValue.not_detected) : null
      };
    }
  },
  unique_batches: {
    type: DataTypes.INTEGER,
    get() {
      const rawValue = this.getDataValue('unique_batches');
      return rawValue !== null ? Number(rawValue) : null;
    }
  },
  avg_confidence: {
    type: DataTypes.FLOAT,
    get() {
      const rawValue = this.getDataValue('avg_confidence');
      return rawValue !== null ? Number(rawValue) : null;
    }
  },
  unique_seeds: {
    type: DataTypes.INTEGER,
    get() {
      const rawValue = this.getDataValue('unique_seeds');
      return rawValue !== null ? Number(rawValue) : null;
    }
  }
}, {
  sequelize,
  modelName: 'SequenceAnalytics',
  tableName: 'mv_sequence_analytics',
  timestamps: false,
  indexes: [
    {
      fields: ['time_bucket'],
      unique: true
    }
  ]
});

module.exports = SequenceAnalytics;
