const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

class ModelPrediction extends Model {}

ModelPrediction.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sequence_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'sequences',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  model_type: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  prediction_data: {
    type: DataTypes.JSONB,
    allowNull: false
  },
  confidence_score: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  rng_seed: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  rng_type: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  model_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: 'default_model'
  }
}, {
  sequelize,
  modelName: 'ModelPrediction',
  tableName: 'model_predictions',
  timestamps: false,
  indexes: [
    {
      name: 'model_predictions_sequence_id',
      fields: ['sequence_id']
    },
    {
      name: 'idx_model_predictions_type',
      fields: ['model_type']
    },
    {
      name: 'model_predictions_model_name',
      fields: ['model_name']
    },
    {
      name: 'idx_model_predictions_rng',
      fields: ['rng_type', 'rng_seed'],
      where: {
        model_type: 'rng_seed_discovery'
      }
    }
  ]
});

module.exports = ModelPrediction;
