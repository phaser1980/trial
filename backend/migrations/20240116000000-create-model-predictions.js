module.exports = {
  up: async (queryInterface, Sequelize) => {
    // First check if table exists
    const tableExists = await queryInterface.showAllTables()
      .then(tables => tables.includes('model_predictions'));

    if (!tableExists) {
      // Create the table if it doesn't exist
      await queryInterface.createTable('model_predictions', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        sequence_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'sequences',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        model_name: {
          type: Sequelize.STRING,
          allowNull: false
        },
        predicted_symbol: {
          type: Sequelize.INTEGER,
          allowNull: false
        },
        confidence: {
          type: Sequelize.FLOAT,
          allowNull: false
        },
        debug_info: {
          type: Sequelize.JSONB,
          defaultValue: {}
        },
        created_at: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW
        }
      }, {
        timestamps: false
      });
    } else {
      // If table exists, check if model_name column exists
      const tableDescription = await queryInterface.describeTable('model_predictions');
      if (!tableDescription.model_name) {
        // Add model_name column if it doesn't exist
        await queryInterface.addColumn('model_predictions', 'model_name', {
          type: Sequelize.STRING,
          allowNull: false,
          defaultValue: 'default_model' // Providing a default value for existing rows
        });
      }
    }

    // Add indexes if they don't exist
    await queryInterface.addIndex('model_predictions', ['sequence_id'])
      .catch(err => {
        if (!err.message.includes('already exists')) throw err;
      });
    
    await queryInterface.addIndex('model_predictions', ['model_name'])
      .catch(err => {
        if (!err.message.includes('already exists')) throw err;
      });
  },

  down: async (queryInterface, Sequelize) => {
    // Don't drop the table in down migration if it existed before
    const tableExists = await queryInterface.showAllTables()
      .then(tables => tables.includes('model_predictions'));
    
    if (tableExists) {
      const tableDescription = await queryInterface.describeTable('model_predictions');
      if (tableDescription.model_name) {
        await queryInterface.removeColumn('model_predictions', 'model_name');
      }
    } else {
      await queryInterface.dropTable('model_predictions');
    }
  }
};
