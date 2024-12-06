import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Typography,
  Grid,
  Container,
  Card,
  CardContent,
  IconButton,
  Tooltip,
  LinearProgress,
  Alert,
  AlertTitle,
  Chip,
  Paper
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import InfoIcon from '@mui/icons-material/Info';
import { v4 as uuidv4 } from 'uuid';
import { SequenceAnalytics, SequenceAnalysis, AnalyticsResponse } from '../types/analytics';

// API Configuration
const API_BASE_URL = 'http://localhost:5000';
const API_ENDPOINTS = {
  SEQUENCES: `${API_BASE_URL}/api/sequences`,
  ANALYTICS: `${API_BASE_URL}/api/sequences/analytics`,
  RECENT: `${API_BASE_URL}/api/sequences/recent`,
  ADD_SYMBOL: `${API_BASE_URL}/api/sequences`,
  UNDO: `${API_BASE_URL}/api/sequences/undo`,
  GENERATE: `${API_BASE_URL}/api/sequences/generate`
};

const GameAnalysisPage: React.FC = () => {
  const [sequences, setSequences] = useState<SequenceAnalysis[]>([]);
  const [analytics, setAnalytics] = useState<SequenceAnalytics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{type: 'error' | 'warning', message: string} | null>(null);
  const [batchId, setBatchId] = useState<string>(uuidv4());
  const [prediction, setPrediction] = useState<number | null>(null);
  const [predictionAccuracy, setPredictionAccuracy] = useState<number>(0);
  const [totalPredictions, setTotalPredictions] = useState<number>(0);

  useEffect(() => {
    loadData();
  }, []);

  const handleError = (message: string) => {
    console.error(message);
    setError({ message, type: 'error' });
  };

  const resetGame = async () => {
    if (loading) {
      console.log("Reset already in progress, skipping");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      console.log("Initiating reset...");
      const response = await fetch(`${API_ENDPOINTS.SEQUENCES}/reset`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      console.log("Reset response:", response.status);

      if (response.status === 409) {
        setError({ type: 'warning', message: 'Reset already in progress, please wait' });
        return;
      }

      if (!response.ok) {
        console.error("Reset failed:", response.status);
        throw new Error(`Failed to reset game: ${response.statusText}`);
      }

      console.log("Reset successful");

      // Reset state immediately
      setBatchId(uuidv4());
      setPrediction(null);
      setPredictionAccuracy(0);
      setTotalPredictions(0);
      setSequences([]);
      setAnalytics([]);

      // Wait a bit before reloading to ensure backend cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      await loadData();
    } catch (error) {
      console.error("Reset error:", error);
      handleError(error instanceof Error ? error.message : 'Failed to reset game');
    } finally {
      setLoading(false);
    }
  };

  const makePrediction = () => {
    if (!sequences || sequences.length < 3) {
      setError({ type: 'warning', message: 'Need at least 3 symbols to make a prediction' });
      return;
    }

    // Simple pattern detection: predict based on last 3 symbols
    const lastThree = sequences.slice(-3).map(s => s.symbol);
    let nextSymbol;
    
    // Check for repeating pattern
    if (lastThree[0] === lastThree[2]) {
      nextSymbol = lastThree[1]; // Predict the middle symbol
    } else if (lastThree[1] === lastThree[2]) {
      nextSymbol = lastThree[1]; // Predict the repeating symbol
    } else {
      // Default to random prediction if no pattern detected
      nextSymbol = Math.floor(Math.random() * 4);
    }

    setPrediction(nextSymbol);
  };

  const loadData = async () => {
    try {
      console.log("Loading data...");
      const [analyticsResponse, recentResponse] = await Promise.all([
        fetch(API_ENDPOINTS.ANALYTICS),
        fetch(API_ENDPOINTS.RECENT)
      ]);

      console.log("Data responses:", {
        analytics: analyticsResponse.status,
        recent: recentResponse.status
      });

      if (!analyticsResponse.ok || !recentResponse.ok) {
        throw new Error('Failed to load data');
      }

      const analyticsData: SequenceAnalytics[] = await analyticsResponse.json();
      const recentData: AnalyticsResponse = await recentResponse.json();

      console.log("Data loaded:", {
        analyticsCount: analyticsData.length,
        sequencesCount: recentData.sequences.length
      });

      setAnalytics(analyticsData);
      setSequences(recentData.sequences);
    } catch (error) {
      console.error("Load error:", error);
      handleError(error instanceof Error ? error.message : 'Failed to load data');
    }
  };

  const addSymbol = async (symbolIndex: number) => {
    try {
      setLoading(true);
      
      // Update prediction accuracy if there was a prediction
      if (prediction !== null) {
        const correct = prediction === symbolIndex;
        const newTotal = totalPredictions + 1;
        const newAccuracy = ((predictionAccuracy * totalPredictions) + (correct ? 1 : 0)) / newTotal;
        setTotalPredictions(newTotal);
        setPredictionAccuracy(newAccuracy);
        setPrediction(null);
      }

      await fetch(API_ENDPOINTS.ADD_SYMBOL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbol: symbolIndex,
          batchId 
        }),
      });
      await loadData();
      
      // Make new prediction after adding symbol
      makePrediction();
    } catch (error) {
      handleError(error instanceof Error ? error.message : 'Failed to add symbol');
    } finally {
      setLoading(false);
    }
  };

  const undoLastSymbol = async () => {
    try {
      await fetch(API_ENDPOINTS.UNDO, {
        method: 'DELETE'
      });
      await loadData();
    } catch (error) {
      handleError(error instanceof Error ? error.message : 'Failed to undo last symbol');
    }
  };

  const generateTestData = async () => {
    try {
      setError(null);
      setLoading(true);
      const newBatchId = uuidv4();
      setBatchId(newBatchId);
      
      await fetch(API_ENDPOINTS.GENERATE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          batchId: newBatchId,
          length: 90
        })
      });
      
      await loadData();
    } catch (error) {
      handleError(error instanceof Error ? error.message : 'Failed to generate test data');
    } finally {
      setLoading(false);
    }
  };

  const formatMetric = (value: number | null, decimals: number = 2): string => {
    return value !== null ? value.toFixed(decimals) : 'N/A';
  };

  const renderAnalytics = () => {
    const latestAnalytics = analytics[0];
    if (!latestAnalytics) return null;

    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Real-time Analytics
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} md={3}>
              <Paper elevation={2} sx={{ p: 2 }}>
                <Typography variant="subtitle2">Sequences</Typography>
                <Typography variant="h4">{latestAnalytics.sequence_count || 0}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} md={3}>
              <Paper elevation={2} sx={{ p: 2 }}>
                <Typography variant="subtitle2">Avg Entropy</Typography>
                <Typography variant="h4">
                  {formatMetric(latestAnalytics.avg_entropy)}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} md={3}>
              <Paper elevation={2} sx={{ p: 2 }}>
                <Typography variant="subtitle2">Patterns Detected</Typography>
                <Typography variant="h4">
                  {latestAnalytics.pattern_distribution?.detected || 0}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} md={3}>
              <Paper elevation={2} sx={{ p: 2 }}>
                <Typography variant="subtitle2">Unique Batches</Typography>
                <Typography variant="h4">{latestAnalytics.unique_batches || 0}</Typography>
              </Paper>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  };

  const renderSequences = () => {
    if (!sequences || sequences.length === 0) return null;

    return (
      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Recent Sequences
              <Tooltip title="Patterns are analyzed in real-time">
                <IconButton size="small">
                  <InfoIcon />
                </IconButton>
              </Tooltip>
            </Typography>
            <Button 
              variant="outlined" 
              color="secondary" 
              onClick={resetGame}
              startIcon={<UndoIcon />}
            >
              Reset Game
            </Button>
          </Box>
          
          {prediction !== null && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <AlertTitle>Prediction</AlertTitle>
              Next symbol predicted to be: {prediction}
              {totalPredictions > 0 && (
                <Typography variant="body2">
                  Accuracy: {(predictionAccuracy * 100).toFixed(1)}% ({totalPredictions} predictions)
                </Typography>
              )}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {sequences.map((seq) => (
              <Tooltip 
                key={seq.id}
                title={`Entropy: ${formatMetric(seq.entropy_value)}`}
              >
                <Chip
                  label={seq.symbol}  
                  color={seq.pattern_detected ? "primary" : "default"}
                  variant={seq.pattern_detected ? "filled" : "outlined"}
                />
              </Tooltip>
            ))}
          </Box>
        </CardContent>
      </Card>
    );
  };

  const renderRNGAnalysis = () => {
    const latestSequence = sequences[0];
    if (!latestSequence?.rng_analysis) return null;

    return (
      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            RNG Analysis
          </Typography>
          <Grid container spacing={2}>
            {Object.entries(latestSequence.rng_analysis).map(([type, patterns]) => (
              <Grid item xs={12} md={4} key={type}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <Typography variant="subtitle2">
                    {type.replace('_analysis', '').toUpperCase()}
                  </Typography>
                  {patterns.map((pattern, idx) => (
                    <Box key={idx} sx={{ mt: 1 }}>
                      <Chip
                        label={`Seed: ${pattern.potential_seed}`}
                        color={pattern.match_quality === 'STRONG' ? 'success' : 
                               pattern.match_quality === 'MODERATE' ? 'warning' : 'default'}
                        size="small"
                      />
                      <Typography variant="caption" display="block">
                        Confidence: {(pattern.confidence * 100).toFixed(1)}%
                      </Typography>
                    </Box>
                  ))}
                </Paper>
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>
    );
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Sequence Analysis
        </Typography>
        
        {error && (
          <Alert severity={error.type} sx={{ mb: 2 }}>
            <AlertTitle>Error</AlertTitle>
            {error.message}
          </Alert>
        )}

        <Box sx={{ mb: 4 }}>
          <Grid container spacing={2}>
            <Grid item>
              <Button
                variant="contained"
                onClick={() => addSymbol(0)}
                disabled={loading}
              >
                0
              </Button>
            </Grid>
            <Grid item>
              <Button
                variant="contained"
                onClick={() => addSymbol(1)}
                disabled={loading}
              >
                1
              </Button>
            </Grid>
            <Grid item>
              <Button
                variant="contained"
                onClick={() => addSymbol(2)}
                disabled={loading}
              >
                2
              </Button>
            </Grid>
            <Grid item>
              <Button
                variant="contained"
                onClick={() => addSymbol(3)}
                disabled={loading}
              >
                3
              </Button>
            </Grid>
            <Grid item>
              <Tooltip title="Undo last symbol">
                <IconButton onClick={undoLastSymbol} disabled={loading}>
                  <UndoIcon />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item>
              <Button
                variant="outlined"
                onClick={generateTestData}
                disabled={loading}
              >
                Generate Test Data
              </Button>
            </Grid>
          </Grid>
        </Box>

        {loading && <LinearProgress sx={{ mb: 2 }} />}

        {renderAnalytics()}
        {renderSequences()}
        {renderRNGAnalysis()}
      </Box>
    </Container>
  );
};

export default GameAnalysisPage;
