import express from 'express';
import { WebSocket } from 'ws';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { SequenceAnalyzer } from '../analysis/sequenceAnalyzer';

const router = express.Router();
const pool = new Pool(); // Configure with your PostgreSQL credentials
const analyzer = new SequenceAnalyzer(pool);

// WebSocket connections store
const clients = new Map<string, WebSocket>();

// Sequence submission endpoint
router.post('/sequence', async (req, res) => {
    const { sessionId, symbol } = req.body;
    const batchId = uuidv4();

    try {
        // Insert new sequence
        await pool.query(
            'INSERT INTO sequence_history (session_id, symbol, batch_id) VALUES ($1, $2, $3)',
            [sessionId, symbol, batchId]
        );

        // Run analysis
        const analysisResults = await analyzer.analyzeSequence(sessionId);
        
        // Store analysis results
        await pool.query(
            `INSERT INTO model_results 
             (session_id, model_type, prediction, confidence, metadata) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
                sessionId,
                'combined',
                analysisResults.markovChain?.predictedNext ?? null,
                analysisResults.markovChain?.confidence ?? 0,
                JSON.stringify(analysisResults)
            ]
        );
        
        // Notify connected clients
        broadcastUpdate(sessionId, {
            type: 'sequence_update',
            data: {
                symbol,
                analysisResults: {
                    markovChain: analysisResults.markovChain?.predictedNext,
                    entropy: analysisResults.entropy?.value,
                    chiSquare: analysisResults.chiSquare?.value,
                    monteCarlo: analysisResults.monteCarlo?.predictedNext,
                    predictedNext: analysisResults.markovChain?.predictedNext ?? 
                                 analysisResults.monteCarlo?.predictedNext ?? 
                                 analysisResults.entropy?.predictedNext ?? 
                                 analysisResults.chiSquare?.predictedNext,
                    confidence: analysisResults.markovChain?.confidence ?? 0.25
                }
            }
        });

        res.json({ 
            success: true, 
            batchId,
            sequence: {
                symbol,
                created_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error saving sequence:', error);
        res.status(500).json({ error: 'Failed to save sequence' });
    }
});

// Get analysis results
router.get('/analysis/:sessionId', async (req, res) => {
    const { sessionId } = req.params;

    try {
        const results = await analyzer.analyzeSequence(sessionId);
        res.json(results);
    } catch (error) {
        console.error('Error fetching analysis:', error);
        res.status(500).json({ error: 'Failed to fetch analysis' });
    }
});

// Get pattern predictions
router.get('/predict/:sessionId', async (req, res) => {
    const { sessionId } = req.params;

    try {
        const predictions = await generatePredictions(sessionId);
        res.json(predictions);
    } catch (error) {
        console.error('Error generating predictions:', error);
        res.status(500).json({ error: 'Failed to generate predictions' });
    }
});

// WebSocket connection handler
export const handleWebSocket = (ws: WebSocket, sessionId: string) => {
    clients.set(sessionId, ws);

    ws.on('close', () => {
        clients.delete(sessionId);
    });
};

function broadcastUpdate(sessionId: string, data: any) {
    const client = clients.get(sessionId);
    if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
    }
}

async function generatePredictions(sessionId: string) {
    // Implement your prediction logic here
    return {};
}

export default router;
