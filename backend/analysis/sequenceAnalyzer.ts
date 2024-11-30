import { Pool } from 'pg';

interface AnalysisResult {
    markovChain?: {
        predictedNext: number;
        confidence: number;
    };
    entropy?: {
        value: number;
        predictedNext: number;
        confidence: number;
    };
    chiSquare?: {
        value: number;
        predictedNext: number;
        confidence: number;
    };
    monteCarlo?: {
        predictedNext: number;
        confidence: number;
    };
}

export class SequenceAnalyzer {
    private pool: Pool;
    private readonly SEQUENCE_LENGTH = 10; // Length of sequence to analyze

    constructor(pool: Pool) {
        this.pool = pool;
    }

    async analyzeSequence(sessionId: string): Promise<AnalysisResult> {
        // Get recent sequence
        const sequence = await this.getRecentSequence(sessionId);
        
        if (sequence.length < 2) {
            return {}; // Not enough data for analysis
        }

        const [markovResult, entropyResult, chiSquareResult, monteCarloResult] = await Promise.all([
            this.markovChainAnalysis(sequence),
            this.entropyAnalysis(sequence),
            this.chiSquareAnalysis(sequence),
            this.monteCarloAnalysis(sequence)
        ]);

        return {
            markovChain: markovResult,
            entropy: entropyResult,
            chiSquare: chiSquareResult,
            monteCarlo: monteCarloResult
        };
    }

    private async getRecentSequence(sessionId: string): Promise<number[]> {
        const result = await this.pool.query(
            `SELECT symbol 
             FROM sequence_history 
             WHERE session_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2`,
            [sessionId, this.SEQUENCE_LENGTH]
        );
        return result.rows.map(row => row.symbol).reverse();
    }

    private async markovChainAnalysis(sequence: number[]): Promise<{ predictedNext: number; confidence: number }> {
        // Create transition matrix
        const transitionMatrix: number[][] = Array(4).fill(0).map(() => Array(4).fill(0));
        
        for (let i = 0; i < sequence.length - 1; i++) {
            const current = sequence[i];
            const next = sequence[i + 1];
            transitionMatrix[current][next]++;
        }

        // Normalize matrix
        for (let i = 0; i < 4; i++) {
            const rowSum = transitionMatrix[i].reduce((a, b) => a + b, 0);
            if (rowSum > 0) {
                transitionMatrix[i] = transitionMatrix[i].map(count => count / rowSum);
            }
        }

        // Predict next symbol
        const currentSymbol = sequence[sequence.length - 1];
        const probabilities = transitionMatrix[currentSymbol];
        const predictedNext = probabilities.indexOf(Math.max(...probabilities));
        const confidence = probabilities[predictedNext];

        return { predictedNext, confidence };
    }

    private async entropyAnalysis(sequence: number[]): Promise<{ value: number; predictedNext: number; confidence: number }> {
        // Calculate symbol frequencies
        const frequencies = new Array(4).fill(0);
        sequence.forEach(symbol => frequencies[symbol]++);
        
        // Calculate entropy
        const total = sequence.length;
        let entropy = 0;
        frequencies.forEach(freq => {
            if (freq > 0) {
                const p = freq / total;
                entropy -= p * Math.log2(p);
            }
        });

        // Predict next based on frequency
        const predictedNext = frequencies.indexOf(Math.max(...frequencies));
        const confidence = frequencies[predictedNext] / total;

        return { value: entropy, predictedNext, confidence };
    }

    private async chiSquareAnalysis(sequence: number[]): Promise<{ value: number; predictedNext: number; confidence: number }> {
        // Expected frequency for true random
        const expected = sequence.length / 4;
        
        // Calculate observed frequencies
        const observed = new Array(4).fill(0);
        sequence.forEach(symbol => observed[symbol]++);
        
        // Calculate chi-square statistic
        let chiSquare = 0;
        observed.forEach(obs => {
            chiSquare += Math.pow(obs - expected, 2) / expected;
        });

        // Predict next based on deviation from expected
        const deviations = observed.map(obs => Math.abs(obs - expected));
        const predictedNext = deviations.indexOf(Math.min(...deviations));
        const maxDev = Math.max(...deviations);
        const confidence = maxDev > 0 ? deviations[predictedNext] / maxDev : 0.25;

        return { value: chiSquare, predictedNext, confidence };
    }

    private async monteCarloAnalysis(sequence: number[]): Promise<{ predictedNext: number; confidence: number }> {
        const SIMULATION_COUNT = 1000;
        const patternLength = 3;
        
        // Find patterns of length 3
        const patterns: { [key: string]: number[] } = {};
        for (let i = 0; i <= sequence.length - patternLength; i++) {
            const pattern = sequence.slice(i, i + patternLength).join(',');
            const next = sequence[i + patternLength];
            if (next !== undefined) {
                if (!patterns[pattern]) patterns[pattern] = new Array(4).fill(0);
                patterns[pattern][next]++;
            }
        }

        // Run simulations
        const currentPattern = sequence.slice(-patternLength).join(',');
        if (!patterns[currentPattern]) {
            return { predictedNext: Math.floor(Math.random() * 4), confidence: 0.25 };
        }

        const predictions = patterns[currentPattern];
        const total = predictions.reduce((a, b) => a + b, 0);
        const predictedNext = predictions.indexOf(Math.max(...predictions));
        const confidence = total > 0 ? predictions[predictedNext] / total : 0.25;

        return { predictedNext, confidence };
    }
}
