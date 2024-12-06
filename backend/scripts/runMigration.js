const { sequelize } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        const migrationSQL = fs.readFileSync(
            path.join(__dirname, '..', 'migrations', '015_create_tables.sql'),
            'utf8'
        );
        
        await sequelize.query(migrationSQL);
        console.log('Migration completed successfully');
        
        // Initial refresh of materialized view
        await sequelize.query('REFRESH MATERIALIZED VIEW mv_sequence_analytics');
        console.log('Materialized view refreshed');
        
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
