const express = require('express');
const router = express.Router();
const pool = require('../db');
const { performThresholdAnalysis } = require('../utils/thresholdAnalysis');

// Drop and recreate tables to fix schema
(async () => {
  try {
    // Drop existing table
    await pool.query('DROP TABLE IF EXISTS sequences');
    
    // Create table with correct schema
    await pool.query(`
      CREATE TABLE sequences (
        id SERIAL PRIMARY KEY,
        symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol <= 3),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database schema updated successfully');
  } catch (err) {
    console.error('Error updating database schema:', err);
  }
})();

// Check table structure
router.get('/debug/schema', async (req, res) => {
  try {
    const result = await pool.query(`
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
    const result = await pool.query(
      'SELECT symbol, created_at FROM sequences ORDER BY created_at ASC'
    );
    
    const sequence = result.rows.map(row => ({
      symbol: row.symbol,
      created_at: row.created_at.toISOString()
    }));
    
    res.json({ sequence });
  } catch (err) {
    console.error('Error fetching sequences:', err);
    res.json({ sequence: [] });
  }
});

// Add new symbol
router.post('/symbol', async (req, res) => {
  try {
    const { symbol } = req.body;
    
    if (typeof symbol !== 'number' || symbol < 0 || symbol > 3) {
      return res.status(400).json({ error: 'Invalid symbol value' });
    }

    const result = await pool.query(
      'INSERT INTO sequences (symbol) VALUES ($1) RETURNING created_at',
      [symbol]
    );

    res.json({ 
      success: true,
      created_at: result.rows[0].created_at.toISOString()
    });
  } catch (err) {
    console.error('Error adding symbol:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Undo last symbol
router.delete('/undo', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM sequences WHERE id = (SELECT id FROM sequences ORDER BY created_at DESC LIMIT 1)'
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error undoing last symbol:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generate test data
router.post('/generate-test-data', async (req, res) => {
  const client = await pool.connect();
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
    
    res.json({ success: true });
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE sequences');
    await client.query('COMMIT');
    res.json({ success: true, message: 'Database reset successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error resetting database:', error);
    res.status(500).json({ error: 'Failed to reset database' });
  } finally {
    client.release();
  }
});

module.exports = router;
