const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

class Sequence extends Model {}

Sequence.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
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
  tableName: 'sequences_partitioned',
  timestamps: false,
  indexes: [
    {
      fields: ['created_at'],
      using: 'BRIN'
    },
    {
      fields: ['batch_id'],
      using: 'HASH'
    },
    {
      fields: ['entropy_value'],
      using: 'BTREE'
    }
  ]
});

module.exports = Sequence;
