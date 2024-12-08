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
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Divider,
  CircularProgress
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
  GENERATE: `${API_BASE_URL}/api/sequences/generate`,
  BATCH_STATUS: `${API_BASE_URL}/api/sequences/batch-status`
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
  const [batchProgress, setBatchProgress] = useState<{
    processed: number;
    total: number;
    remaining: number;
    status: 'idle' | 'processing' | 'complete';
  }>({ processed: 0, total: 0, remaining: 0, status: 'idle' });
  const [modelDebug, setModelDebug] = useState<{
    modelName: string;
    predictions: number;
    accuracy: number;
    confidence: number;
  }[]>([]);
  const [rngSettings, setRngSettings] = useState({
    algorithm: 'LCG',
    seed: Date.now(),
    count: 100,
    batchSize: 5,
    delayMs: 2000
  });

  const symbolNames = {
    0: '♥️ Heart',
    1: '♦️ Diamond',
    2: '♣️ Club',
    3: '♠️ Spade'
  };

  useEffect(() => {
    loadData();
    // Set up polling for batch status when processing
    let pollInterval: NodeJS.Timeout;
    if (batchProgress.status === 'processing') {
      pollInterval = setInterval(checkBatchStatus, 1000);
    }
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [batchProgress.status]);

  const checkBatchStatus = async () => {
    try {
      const response = await fetch(`${API_ENDPOINTS.BATCH_STATUS}?batchId=${batchId}`);
      if (!response.ok) return;
      
      const status = await response.json();
      setBatchProgress(status);
      
      if (status.status === 'complete') {
        await loadData();
      }
    } catch (error) {
      console.error('Failed to check batch status:', error);
    }
  };

  const handleError = (message: string) => {
    console.error(message);
    setError({ message, type: 'error' });
  };

  // ... (keep existing resetGame, loadData, addSymbol, and undoLastSymbol functions)

  const generateTestData = async () => {
    try {
      setError(null);
      setLoading(true);
      const newBatchId = uuidv4();
      setBatchId(newBatchId);
      setBatchProgress({
        processed: 0,
        total: rngSettings.count,
        remaining: rngSettings.count,
        status: 'processing'
      });
      
      console.log('Generating test data with settings:', rngSettings);
      
      const response = await fetch(API_ENDPOINTS.GENERATE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          batchId: newBatchId,
          ...rngSettings
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to generate data: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Generation started:', result);

    } catch (error) {
      console.error('Generation error:', error);
      handleError(error instanceof Error ? error.message : 'Failed to generate test data');
      setBatchProgress(prev => ({ ...prev, status: 'idle' }));
    } finally {
      setLoading(false);
    }
  };

  const formatMetric = (value: number | null, decimals: number = 2): string => {
    return value !== null ? value.toFixed(decimals) : 'N/A';
  };

  const renderAnalytics = () => {
    // ... (keep existing renderAnalytics implementation)
  };

  const renderControls = () => (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Game Controls
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>RNG Algorithm</InputLabel>
              <Select
                value={rngSettings.algorithm}
                onChange={(e) => setRngSettings(prev => ({ ...prev, algorithm: e.target.value }))}
              >
                <MenuItem value="LCG">Linear Congruential</MenuItem>
                <MenuItem value="XORShift">XOR Shift</MenuItem>
                <MenuItem value="MSWS">Middle Square Weyl</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              label="Seed Value"
              type="number"
              value={rngSettings.seed}
              onChange={(e) => setRngSettings(prev => ({ ...prev, seed: Number(e.target.value) }))}
              helperText="Controls sequence predictability"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              label="Sequence Length"
              type="number"
              value={rngSettings.count}
              onChange={(e) => setRngSettings(prev => ({ ...prev, count: Number(e.target.value) }))}
              inputProps={{ min: 1, max: 10000 }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              label="Batch Size"
              type="number"
              value={rngSettings.batchSize}
              onChange={(e) => setRngSettings(prev => ({ ...prev, batchSize: Number(e.target.value) }))}
              inputProps={{ min: 1, max: 20 }}
              helperText="Symbols per batch"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              label="Delay (ms)"
              type="number"
              value={rngSettings.delayMs}
              onChange={(e) => setRngSettings(prev => ({ ...prev, delayMs: Number(e.target.value) }))}
              inputProps={{ min: 500, max: 10000, step: 500 }}
              helperText="Delay between batches"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                fullWidth
                variant="contained"
                onClick={generateTestData}
                disabled={loading || batchProgress.status === 'processing'}
              >
                {batchProgress.status === 'processing' ? (
                  <>
                    Processing...
                    <CircularProgress size={20} sx={{ ml: 1 }} />
                  </>
                ) : 'Generate Test Data'}
              </Button>
            </Box>
          </Grid>
        </Grid>

        {batchProgress.status === 'processing' && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress 
              variant="determinate" 
              value={(batchProgress.processed / batchProgress.total) * 100} 
            />
            <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
              Processing batch {batchProgress.processed + 1} of {batchProgress.total}
              {' '}({((batchProgress.processed / batchProgress.total) * 100).toFixed(1)}% complete)
            </Typography>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="h6" gutterBottom>
          Manual Input
        </Typography>
        <Grid container spacing={1}>
          {Object.entries(symbolNames).map(([value, name]) => (
            <Grid item key={value}>
              <Button
                variant="outlined"
                onClick={() => addSymbol(Number(value))}
                disabled={loading || batchProgress.status === 'processing'}
                startIcon={name.split(' ')[0]}
              >
                {name.split(' ')[1]}
              </Button>
            </Grid>
          ))}
          <Grid item>
            <Tooltip title="Undo last symbol">
              <IconButton 
                onClick={undoLastSymbol} 
                disabled={loading || batchProgress.status === 'processing'}
              >
                <UndoIcon />
              </IconButton>
            </Tooltip>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );

  const renderModelDebug = () => {
    if (!modelDebug.length) return null;

    return (
      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Model Performance
          </Typography>
          <Grid container spacing={2}>
            {modelDebug.map((model) => (
              <Grid item xs={12} md={3} key={model.modelName}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <Typography variant="subtitle2">{model.modelName}</Typography>
                  <Typography variant="body2">
                    Predictions: {model.predictions}
                  </Typography>
                  <Typography variant="body2">
                    Accuracy: {(model.accuracy * 100).toFixed(1)}%
                  </Typography>
                  <Typography variant="body2">
                    Avg. Confidence: {(model.confidence * 100).toFixed(1)}%
                  </Typography>
                </Paper>
              </Grid>
            ))}
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
          </Box>
          
          {prediction !== null && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <AlertTitle>Next Symbol Prediction</AlertTitle>
              {symbolNames[prediction as keyof typeof symbolNames]}
              {totalPredictions > 0 && (
                <Typography variant="body2">
                  Prediction Accuracy: {(predictionAccuracy * 100).toFixed(1)}% ({totalPredictions} predictions)
                </Typography>
              )}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {sequences.map((seq) => (
              <Tooltip 
                key={seq.id}
                title={
                  <>
                    Entropy: {formatMetric(seq.entropy_value)}
                    <br />
                    Pattern: {seq.pattern_detected ? 'Yes' : 'No'}
                    {seq.model_predictions?.map(pred => (
                      <div key={pred.model}>
                        {pred.model}: {(pred.confidence * 100).toFixed(1)}% confident
                      </div>
                    ))}
                  </>
                }
              >
                <Chip
                  label={symbolNames[seq.symbol as keyof typeof symbolNames]}
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

  return (
    <Container maxWidth="lg">
      {error && (
        <Alert severity={error.type} sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error.message}
        </Alert>
      )}
      
      {renderControls()}
      {renderAnalytics()}
      {renderModelDebug()}
      {renderSequences()}
      
      {loading && <LinearProgress sx={{ mt: 2 }} />}
    </Container>
  );
};

export default GameAnalysisPage;
