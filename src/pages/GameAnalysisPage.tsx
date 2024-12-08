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
import { 
  Symbol,
  SYMBOL_NAMES,
  LocalSequenceAnalysis,
  LocalModelPrediction,
  BatchProgress,
  transformSequence,
  isNonNullObject
} from '../types/analytics';

// API Configuration
const API_BASE_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:49152';
const API_ENDPOINTS = {
  SEQUENCES: `${API_BASE_URL}/api/sequences`,
  ANALYTICS: `${API_BASE_URL}/api/sequences/analytics`,
  RECENT: `${API_BASE_URL}/api/sequences/recent`,
  ADD_SYMBOL: `${API_BASE_URL}/api/sequences`,
  UNDO: `${API_BASE_URL}/api/sequences/undo`,
  GENERATE: `${API_BASE_URL}/api/sequences/generate`,
  BATCH_STATUS: `${API_BASE_URL}/api/sequences/batch-status`,
  RESET: `${API_BASE_URL}/api/sequences/reset`
};

const GameAnalysisPage: React.FC = () => {
  const [sequences, setSequences] = useState<LocalSequenceAnalysis[]>([]);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [error, setError] = useState<{ type: 'error' | 'warning', message: string } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [batchId, setBatchId] = useState(() => uuidv4());
  const [prediction, setPrediction] = useState<Symbol | null>(null);
  const [predictionAccuracy, setPredictionAccuracy] = useState<number>(0);
  const [totalPredictions, setTotalPredictions] = useState<number>(0);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({
    status: 'idle',
    current: 0,
    total: 0,
    progress: 0
  });
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

  useEffect(() => {
    loadData();
    let intervalId: NodeJS.Timeout;

    const checkStatus = async () => {
      if (batchProgress.status === 'processing') {
        try {
          const response = await fetch(`${API_ENDPOINTS.BATCH_STATUS}?batchId=${batchId}`);
          if (!response.ok) {
            throw new Error('Failed to check batch status');
          }

          const status = await response.json();
          handleBatchProgressUpdate(status);

          if (status.status === 'complete') {
            await loadData();
          }
        } catch (error) {
          console.error('Error checking batch status:', error);
        }
      }
    };

    if (batchProgress.status === 'processing') {
      intervalId = setInterval(checkStatus, 5000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [batchProgress.status, batchId]);

  const handleError = (message: string) => {
    console.error(message);
    setError({ message, type: 'error' });
  };

  const loadData = async () => {
    try {
      const [analyticsResponse, recentResponse] = await Promise.all([
        fetch(API_ENDPOINTS.ANALYTICS),
        fetch(API_ENDPOINTS.RECENT),
      ]);

      // Check content type and status
      for (const response of [analyticsResponse, recentResponse]) {
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Server error: ${response.status} -`, errorText);
          throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error('Invalid response content type:', contentType);
          throw new Error('Server returned a non-JSON response');
        }
      }

      const analyticsData = await analyticsResponse.json();
      const recentData = await recentResponse.json();

      setAnalytics(analyticsData);
      setSequences(
        (recentData.sequences || [])
          .map(transformSequence)
          .filter((seq: LocalSequenceAnalysis | null): seq is LocalSequenceAnalysis => seq !== null)
      );
      setError(null);
    } catch (error) {
      console.error('Error loading data:', error);
      setError({ 
        type: 'error', 
        message: error instanceof Error ? error.message : 'Unknown error occurred' 
      });
    }
  };

  const handleSymbolInput = async (symbol: number) => {
    try {
      if (!(symbol in Symbol)) {
        throw new Error(`Invalid symbol value: ${symbol}`);
      }

      setIsLoading(true);
      const response = await fetch(API_ENDPOINTS.ADD_SYMBOL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });

      if (!response.ok) {
        throw new Error('Failed to add symbol');
      }

      await loadData();
      setSuccessMessage('Symbol added successfully');
    } catch (error: unknown) {
      if (error instanceof Error) {
        setError({ type: 'error', message: error.message });
      } else {
        setError({ type: 'error', message: 'An unknown error occurred' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const undoLastSymbol = async () => {
    try {
      setIsLoading(true);
      await fetch(API_ENDPOINTS.UNDO, { method: 'DELETE' });
      await loadData();
    } catch (error) {
      setError({ type: 'error', message: 'Failed to undo the last symbol' });
    } finally {
      setIsLoading(false);
    }
  };

  const generateTestData = async () => {
    try {
      setError(null);
      setIsLoading(true);
      const newBatchId = uuidv4();
      setBatchId(newBatchId);
      setBatchProgress({
        status: 'processing',
        current: 0,
        total: rngSettings.count,
        progress: 0
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
      setIsLoading(false);
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
                disabled={isLoading || batchProgress.status === 'processing'}
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
            {renderBatchProgress()}
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="h6" gutterBottom>
          Manual Input
        </Typography>
        <Grid container spacing={1}>
          {Object.entries(SYMBOL_NAMES).map(([value, name]) => (
            <Grid item key={value}>
              <Button
                variant="outlined"
                onClick={() => handleSymbolInput(Number(value))}
                disabled={isLoading || batchProgress.status === 'processing'}
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
                disabled={isLoading || batchProgress.status === 'processing'}
              >
                <UndoIcon />
              </IconButton>
            </Tooltip>
          </Grid>
          <Grid item>
            <Button
              variant="outlined"
              color="secondary"
              onClick={handleReset}
              disabled={isLoading || batchProgress.status === 'processing'}
            >
              Reset Database
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );

  const handleBatchProgressUpdate = (status: Partial<BatchProgress>) => {
    setBatchProgress(prev => ({
      ...prev,
      current: status.current ?? prev.current,
      total: status.total ?? prev.total,
      progress: Math.round(((status.current || 0) / (status.total || 1)) * 100),
      status: status.status || prev.status
    }));
  };

  const renderPredictions = () => {
    if (!sequences.length) return null;

    const latestSequence = sequences[sequences.length - 1];
    if (!latestSequence.model_predictions?.length) return null;

    return (
      <>
        {prediction === null && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <AlertTitle>Individual Model Predictions</AlertTitle>
            {latestSequence.model_predictions.map((pred, idx) => (
              <div key={idx}>
                {pred.model_name}: {SYMBOL_NAMES[pred.prediction_data.predicted_symbol]}
                ({(pred.confidence_score * 100).toFixed(1)}% confidence)
                {pred.prediction_data.details && (
                  <Typography variant="caption" display="block" sx={{ ml: 2 }}>
                    {Object.entries(pred.prediction_data.details)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(', ')}
                  </Typography>
                )}
              </div>
            ))}
          </Alert>
        )}
        {prediction !== null && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <AlertTitle>Ensemble Prediction</AlertTitle>
            <Typography variant="body1">
              Next predicted symbol: {prediction !== null ? SYMBOL_NAMES[prediction] : 'None'}
            </Typography>
            <Typography variant="body2">
              Accuracy: {(predictionAccuracy * 100).toFixed(1)}% 
              ({totalPredictions} predictions)
            </Typography>
          </Alert>
        )}
      </>
    );
  };

  const renderSymbol = (symbol: Symbol) => (
    <span className="symbol">{SYMBOL_NAMES[symbol]}</span>
  );

  const renderPredictionDetails = (prediction: LocalModelPrediction) => (
    <div className="prediction-details">
      <strong>{prediction.model_name}</strong>: {renderSymbol(prediction.prediction_data.predicted_symbol)}
      {prediction.prediction_data.details && (
        <div className="details">
          {Object.entries(prediction.prediction_data.details).map(([key, value]) => (
            <div key={key}>
              {key}: {typeof value === 'number' ? value.toFixed(4) : String(value)}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderSequenceTooltip = (seq: LocalSequenceAnalysis) => (
    <Box sx={{ p: 1 }}>
      <Typography variant="body2">
        Symbol: {SYMBOL_NAMES[seq.symbol]}
      </Typography>
      {seq.model_predictions.map((pred, idx) => (
        <div key={idx}>
          {renderPredictionDetails(pred)}
        </div>
      ))}
    </Box>
  );

  const renderBatchProgress = () => {
    if (batchProgress.status === 'processing') {
      return (
        <Box sx={{ width: '100%', mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Processing batch {batchProgress.current} of {batchProgress.total} 
            ({batchProgress.progress}% complete)
          </Typography>
          <LinearProgress 
            variant="determinate" 
            value={batchProgress.progress} 
            sx={{ mt: 1 }} 
          />
        </Box>
      );
    }
    return null;
  };

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
    if (!sequences.length) return null;

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
          
          {renderPredictions()}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {sequences.map((seq) => (
              <Tooltip 
                key={seq.id}
                title={renderSequenceTooltip(seq)}
              >
                <Chip
                  label={SYMBOL_NAMES[seq.symbol]}
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

  useEffect(() => {
    if (sequences.length > 0) {
      console.log('Loaded sequences with predictions:', 
        sequences.map(seq => ({
          symbol: seq.symbol,
          predictions: seq.model_predictions?.map(p => ({
            model: p.model_name,
            prediction: p.prediction_data.predicted_symbol,
            confidence: p.confidence_score
          }))
        }))
      );
    }
  }, [sequences]);

  const handleReset = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setSuccessMessage(null);

      const response = await fetch(API_ENDPOINTS.RESET, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to reset database');
      }

      await loadData(); // Reload data after reset
      setSuccessMessage('Database reset successfully');
    } catch (error) {
      console.error('Error resetting database:', error);
      setError({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to reset database'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ my: 4 }}>
        <>
          <Typography variant="h4" component="h1" gutterBottom>
            Game Analysis
          </Typography>

          {/* Error and Success Messages */}
          {error && (
            <Alert severity={error.type} sx={{ mb: 2 }} onClose={() => setError(null)}>
              <AlertTitle>{error.type === 'error' ? 'Error' : 'Warning'}</AlertTitle>
              {error.message}
            </Alert>
          )}
          {successMessage && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage(null)}>
              <AlertTitle>Success</AlertTitle>
              {successMessage}
            </Alert>
          )}
          
          {/* Control Panel */}
          {renderControls()}
          {renderAnalytics()}
          {renderModelDebug()}
          {renderSequences()}
          {isLoading && <LinearProgress sx={{ mt: 2 }} />}
        </>
      </Box>
    </Container>
  );
};

export default GameAnalysisPage;
