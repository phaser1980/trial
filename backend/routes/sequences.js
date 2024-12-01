const express = require('express');
const router = express.Router();
const db = require('../db');
const { performThresholdAnalysis } = require('../utils/thresholdAnalysis');

// Initialize database schema
(async () => {
  const client = await db.getClient();
  try {
    console.log('[DB] Initializing sequences table schema');
    
    await client.query('BEGIN');

    // Drop existing table if it exists
    await client.query('DROP TABLE IF EXISTS sequences CASCADE');
    
    // Create table with correct schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS sequences (
        id SERIAL PRIMARY KEY,
        symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol <= 3),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query('COMMIT');
    console.log('[DB] Sequences table schema initialized successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error updating database schema:', error);
  } finally {
    client.release();
  }
})().catch(error => {
  console.error('[DB] Fatal error during schema initialization:', error);
});

// Check table structure
router.get('/debug/schema', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'sequences'
      ORDER BY ordinal_position;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error checking schema:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all sequences
router.get('/', async (req, res) => {
  try {
    console.log('[DB] Fetching all sequences');
    const result = await db.query(
      'SELECT symbol, created_at FROM sequences ORDER BY created_at ASC'
    );
    
    const sequence = result.rows.map(row => ({
      symbol: row.symbol,
      created_at: row.created_at.toISOString()
    }));
    
    console.log('[DB] Retrieved sequences:', {
      count: sequence.length,
      first: sequence[0],
      last: sequence[sequence.length - 1]
    });
    
    res.json({ sequence });
  } catch (err) {
    console.error('[DB] Error fetching sequences:', err);
    res.json({ sequence: [] });
  }
});

// Add new symbol
router.post('/symbol', async (req, res) => {
  try {
    const { symbol } = req.body;
    
    console.log('[DB] Attempting to insert symbol:', symbol);
    
    if (typeof symbol !== 'number' || symbol < 0 || symbol > 3) {
      console.error('[DB] Invalid symbol value:', symbol);
      return res.status(400).json({ error: 'Invalid symbol value' });
    }

    const result = await db.query(
      'INSERT INTO sequences (symbol) VALUES ($1) RETURNING *',
      [symbol]
    );

    console.log('[DB] Successfully inserted symbol:', {
      symbol: result.rows[0].symbol,
      id: result.rows[0].id,
      created_at: result.rows[0].created_at
    });

    // Verify data after insertion
    const verification = await db.query(
      'SELECT COUNT(*) FROM sequences'
    );
    console.log('[DB] Total sequences after insertion:', verification.rows[0].count);

    res.json({ 
      success: true,
      created_at: result.rows[0].created_at.toISOString(),
      total_sequences: verification.rows[0].count
    });
  } catch (err) {
    console.error('[DB] Error adding symbol:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Undo last symbol
router.delete('/undo', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // Get the last symbol before deleting
    const lastSymbol = await client.query(
      'SELECT * FROM sequences ORDER BY created_at DESC LIMIT 1'
    );
    
    console.log('[DB] Attempting to undo last symbol:', lastSymbol.rows[0]);
    
    await client.query(
      'DELETE FROM sequences WHERE id = (SELECT id FROM sequences ORDER BY created_at DESC LIMIT 1)'
    );
    
    // Verify deletion
    const verification = await client.query(
      'SELECT COUNT(*) FROM sequences'
    );
    
    console.log('[DB] Sequences after undo:', verification.rows[0].count);
    
    await client.query('COMMIT');
    res.json({ 
      success: true,
      removed: lastSymbol.rows[0],
      remaining: verification.rows[0].count
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB] Error undoing last symbol:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Generate test data
router.post('/generate-test-data', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // Generate 90 random symbols
    const values = Array.from({ length: 90 }, (_, i) => {
      const symbol = Math.floor(Math.random() * 4);
      const timestamp = new Date(Date.now() + i * 1000);
      return `(${symbol}, '${timestamp.toISOString()}')`;
    }).join(',');
    
    await client.query(`
      INSERT INTO sequences (symbol, created_at)
      VALUES ${values}
    `);
    
    await client.query('COMMIT');
    res.json({ message: 'Test data generated successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error generating test data:', error);
    res.status(500).json({ error: 'Failed to generate test data' });
  } finally {
    client.release();
  }
});

// Reset database
router.post('/reset', async (req, res) => {
  const client = await db.getClient();
  try {
    console.log('[DB] Starting database reset');
    
    // Get count before reset
    const beforeCount = await client.query('SELECT COUNT(*) FROM sequences');
    console.log('[DB] Sequences before reset:', beforeCount.rows[0].count);
    
    await client.query('BEGIN');
    await client.query('TRUNCATE sequences');
    
    // Verify reset
    const afterCount = await client.query('SELECT COUNT(*) FROM sequences');
    console.log('[DB] Sequences after reset:', afterCount.rows[0].count);
    
    await client.query('COMMIT');
    res.json({ message: 'Database reset successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error resetting database:', error);
    res.status(500).json({ error: 'Failed to reset database' });
  } finally {
    client.release();
  }
});

module.exports = router;
