const { pool } = require('./initDb');
const logger = require('./utils/logger');

async function inspectSchema() {
    const client = await pool.connect();
    try {
        // Get table structure including constraints
        const schemaQuery = `
            SELECT 
                a.attname as column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
                CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END as is_nullable,
                pg_get_expr(d.adbin, d.adrelid) as column_default,
                CASE 
                    WHEN pc.contype = 'p' THEN 'PRIMARY KEY'
                    WHEN pc.contype = 'f' THEN 'FOREIGN KEY'
                    ELSE NULL 
                END as constraint_type,
                pg_get_constraintdef(pc.oid) as constraint_definition
            FROM pg_attribute a
            LEFT JOIN pg_attrdef d ON (a.attrelid, a.attnum) = (d.adrelid, d.adnum)
            LEFT JOIN pg_constraint pc ON (a.attrelid = pc.conrelid AND a.attnum = ANY(pc.conkey))
            WHERE a.attrelid = 'model_performance'::regclass
            AND a.attnum > 0
            AND NOT a.attisdropped
            ORDER BY a.attnum;
        `;

        const result = await client.query(schemaQuery);
        console.log('Current model_performance table structure:');
        console.log(JSON.stringify(result.rows, null, 2));

        // Get indexes
        const indexQuery = `
            SELECT 
                i.relname as index_name,
                a.attname as column_name,
                am.amname as index_type,
                ix.indisunique as is_unique
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON ix.indexrelid = i.oid
            JOIN pg_am am ON i.relam = am.oid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE t.relname = 'model_performance'
            AND t.relkind = 'r'
            ORDER BY i.relname;
        `;

        const indexResult = await client.query(indexQuery);
        console.log('\nCurrent indexes:');
        console.log(JSON.stringify(indexResult.rows, null, 2));

    } catch (error) {
        console.error('Error inspecting schema:', error);
    } finally {
        client.release();
    }
}

inspectSchema().then(() => process.exit());
