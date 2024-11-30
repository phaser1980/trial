const tf = require('@tensorflow/tfjs');

class QLearningOptimizer {
    constructor() {
        this.learningRate = 0.1;
        this.discountFactor = 0.9;
        this.explorationRate = 0.2;
        this.minExplorationRate = 0.01;
        this.explorationDecay = 0.995;
        
        // Q-table: model -> state -> action -> value
        this.qTable = new Map();
        
        // State features
        this.stateFeatures = {
            recentAccuracy: [], // Discretized accuracy levels
            confidenceTrend: [], // Trend directions
            sequenceLength: [] // Sequence length buckets
        };
        
        this.initializeStateSpace();
    }

    initializeStateSpace() {
        // Initialize accuracy levels
        this.stateFeatures.recentAccuracy = [0.2, 0.4, 0.6, 0.8];
        
        // Initialize confidence trends
        this.stateFeatures.confidenceTrend = [-1, 0, 1]; // Decreasing, Stable, Increasing
        
        // Initialize sequence length buckets
        this.stateFeatures.sequenceLength = [100, 200, 300, 400, 500];
    }

    // Initialize Q-table for a model
    initializeModel(modelName) {
        if (!this.qTable.has(modelName)) {
            const modelQTable = new Map();
            
            // Generate all possible states
            for (const acc of this.stateFeatures.recentAccuracy) {
                for (const trend of this.stateFeatures.confidenceTrend) {
                    for (const length of this.stateFeatures.sequenceLength) {
                        const state = this.encodeState(acc, trend, length);
                        modelQTable.set(state, {
                            increaseWeight: 0,
                            decreaseWeight: 0,
                            maintainWeight: 0
                        });
                    }
                }
            }
            
            this.qTable.set(modelName, modelQTable);
        }
    }

    // Encode state features into a state string
    encodeState(accuracy, trend, length) {
        return `${accuracy}_${trend}_${length}`;
    }

    // Get current state for a model
    getCurrentState(modelMetrics, sequenceLength) {
        // Discretize accuracy
        const accuracy = this.stateFeatures.recentAccuracy.find(
            level => modelMetrics.recentAccuracy <= level
        ) || this.stateFeatures.recentAccuracy[this.stateFeatures.recentAccuracy.length - 1];

        // Discretize confidence trend
        const trend = Math.sign(modelMetrics.confidenceTrend);

        // Discretize sequence length
        const length = this.stateFeatures.sequenceLength.find(
            level => sequenceLength <= level
        ) || this.stateFeatures.sequenceLength[this.stateFeatures.sequenceLength.length - 1];

        return this.encodeState(accuracy, trend, length);
    }

    // Get action with highest Q-value
    getBestAction(modelName, state) {
        const actions = this.qTable.get(modelName).get(state);
        return Object.entries(actions).reduce((a, b) => a[1] > b[1] ? a : b)[0];
    }

    // Choose action using epsilon-greedy policy
    chooseAction(modelName, state) {
        if (Math.random() < this.explorationRate) {
            const actions = ['increaseWeight', 'decreaseWeight', 'maintainWeight'];
            return actions[Math.floor(Math.random() * actions.length)];
        }
        return this.getBestAction(modelName, state);
    }

    // Update Q-value based on reward
    updateQValue(modelName, state, action, reward, nextState) {
        const qTable = this.qTable.get(modelName);
        const currentQ = qTable.get(state)[action];
        const nextMaxQ = Math.max(...Object.values(qTable.get(nextState)));
        
        // Q-learning update formula
        const newQ = currentQ + this.learningRate * (
            reward + this.discountFactor * nextMaxQ - currentQ
        );
        
        // Update Q-value
        qTable.get(state)[action] = newQ;
        
        // Decay exploration rate
        this.explorationRate = Math.max(
            this.minExplorationRate,
            this.explorationRate * this.explorationDecay
        );
    }

    // Calculate reward based on prediction outcome
    calculateReward(prediction, actual, confidence) {
        const correct = prediction === actual;
        const confidenceFactor = confidence / 0.95; // Normalize confidence
        
        if (correct) {
            return confidenceFactor; // Higher reward for correct predictions with high confidence
        } else {
            return -confidenceFactor; // Higher penalty for incorrect predictions with high confidence
        }
    }

    // Get weight adjustment factor based on action
    getWeightAdjustment(action) {
        switch (action) {
            case 'increaseWeight':
                return 1.1;
            case 'decreaseWeight':
                return 0.9;
            default:
                return 1.0;
        }
    }
}

module.exports = QLearningOptimizer;
