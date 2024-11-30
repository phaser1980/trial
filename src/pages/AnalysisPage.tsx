import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  CircularProgress,
  Alert,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Divider
} from '@mui/material';

// Assuming `AnalysisData` is the interface with analysis types
interface AnalysisData {
  markovChain?: {
    matrix: Record<string, Record<string, number>>;
    prediction: number | null;
    confidence: number;
    accuracy: number;
  };
  entropy?: {
    entropy: number;
    prediction: number | null;
    confidence: number;
    accuracy: number;
  };
  chiSquare?: {
    chiSquare: number;
    pValue: number;
    prediction: number | null;
    confidence: number;
    accuracy: number;
  };
  monteCarlo?: {
    simulations: number;
    prediction: number | null;
    confidence: number;
    accuracy: number;
  };
}

const renderPredictionCard = (
  title: string,
  prediction: number | null,
  confidence: number,
  accuracy: number,
  extraInfo?: React.ReactNode  // This ensures JSX elements are allowed
) => (
  <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
    <Typography variant="h6" gutterBottom>
      {title}
    </Typography>
    <Box sx={{ mb: 2 }}>
      <Typography variant="body1" color="text.secondary">
        Next Symbol Prediction
      </Typography>
      <Typography variant="h4">
        {prediction !== null ? prediction : 'N/A'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Confidence: {(confidence * 100).toFixed(1)}%
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Historical Accuracy: {(accuracy * 100).toFixed(1)}%
      </Typography>
    </Box>
    {extraInfo}
  </Paper>
);

const AnalysisPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sequences, setSequences] = useState<number[]>([]);
  const [analysisData, setAnalysisData] = useState<AnalysisData>({});

  const renderTransitionMatrix = () => {
    if (!analysisData.markovChain?.matrix) return null; // Check if matrix exists

    const matrix = analysisData.markovChain.matrix;
    const symbols = Array.from(new Set([
      ...Object.keys(matrix),
      ...Object.values(matrix).flatMap(row => Object.keys(row))
    ])).sort();

    return (
      <TableContainer component={Paper} sx={{ mt: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>From ↓ To →</TableCell>
              {symbols.map(symbol => (
                <TableCell key={symbol}>{symbol}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {symbols.map(fromSymbol => (
              <TableRow key={fromSymbol}>
                <TableCell component="th" scope="row">{fromSymbol}</TableCell>
                {symbols.map(toSymbol => (
                  <TableCell key={toSymbol}>
                    {(matrix[fromSymbol]?.[toSymbol] || 0).toFixed(2)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('http://localhost:5000/api/analysis');
      const data = await response.json();

      setSequences(data.symbols || []);
      setAnalysisData(data.analyses || {});
    } catch (err) {
      setError('Failed to fetch analysis data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <Container>
      <Box sx={{ mt: 4, mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4">
          Analysis Dashboard
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Grid container spacing={3}>
        <Grid item xs={12}>
          {analysisData.markovChain && renderPredictionCard(
            'Markov Chain Analysis',
            analysisData.markovChain.prediction,
            analysisData.markovChain.confidence,
            analysisData.markovChain.accuracy,
            <>
              <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>
                Transition Matrix
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                This matrix shows the probability of transitioning from one symbol to another.
                Each cell represents P(column|row) - the probability of getting the column's symbol after seeing the row's symbol.
              </Typography>
              {renderTransitionMatrix()}
            </>
          )}
        </Grid>
      </Grid>
    </Container>
  );
};

export default AnalysisPage;
