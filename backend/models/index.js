const Sequence = require('./sequence');
const SequenceAnalytics = require('./analytics');
const ModelPrediction = require('./modelPrediction');

// Define associations
Sequence.hasMany(ModelPrediction, {
  foreignKey: 'sequence_id',
  as: 'predictions'
});

ModelPrediction.belongsTo(Sequence, {
  foreignKey: 'sequence_id'
});

module.exports = {
  Sequence,
  SequenceAnalytics,
  ModelPrediction
};
