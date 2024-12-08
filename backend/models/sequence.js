const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

class Sequence extends Model {}

Sequence.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  symbol: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0,
      max: 3
    }
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false
  },
  entropy_value: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  pattern_detected: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  pattern_strength: {
    type: DataTypes.FLOAT,
    defaultValue: 0.0
  },
  batch_id: {
    type: DataTypes.UUID,
    allowNull: false,
    index: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  sequelize,
  modelName: 'Sequence',
  tableName: 'sequences',
  timestamps: false,
  indexes: [
    {
      name: 'idx_sequences_batch_id',
      fields: ['batch_id']
    },
    {
      name: 'idx_sequences_created_at',
      fields: ['created_at']
    },
    {
      name: 'idx_sequences_entropy',
      fields: ['entropy_value']
    },
    {
      name: 'idx_sequences_pattern_detected',
      fields: ['pattern_detected']
    }
  ]
});

module.exports = Sequence;
