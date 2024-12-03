const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:Redman1303!@localhost:5432/postgres'
});

async function inspectDatabase() {
  const client = await pool.connect();
  try {
    // Get all tables
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log('Tables in database:');
    console.log(tables.rows);

    // For each table, get its structure
    for (const table of tables.rows) {
      const columns = await client.query(`
        SELECT column_name, data_type, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = $1
      `, [table.table_name]);
      
      console.log(`\nStructure of ${table.table_name}:`);
      console.log(columns.rows);
    }
  } finally {
    client.end();
  }
}

inspectDatabase().catch(console.error);
