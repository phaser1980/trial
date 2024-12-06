const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

async function runMigration() {
    const pool = new Pool({
        user: 'postgres',
        host: 'localhost',
        database: 'sequence_db',
        password: 'postgres',
        port: 5432,
    });

    try {
        const migrationFile = path.join(__dirname, '004_create_sequence_analysis.sql');
        const sql = await fs.readFile(migrationFile, 'utf8');
        
        await pool.query(sql);
        console.log('Migration completed successfully');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
