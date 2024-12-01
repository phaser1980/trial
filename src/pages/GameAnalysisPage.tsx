import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Grid,
  Button,
  Typography,
  Box,
  Paper,
  Alert,
  CircularProgress,
  ButtonGroup,
  IconButton,
  Tooltip,
  Card,
  LinearProgress,
  Switch,
  Chip
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import InfoIcon from '@mui/icons-material/Info';
import { v4 as uuidv4 } from 'uuid';

interface SequenceItem {
  symbol: number;
  created_at: string;
}

interface ErrorState {
  message: string;
  type: 'error' | 'warning' | 'info';
}

// Base type for all analyses
interface BaseAnalysis {
  predictedNext?: number;
  confidence: number;
  error?: string;
}

// Individual analysis types
interface MarkovChainAnalysis extends BaseAnalysis {
  matrix?: number[][];
}

interface EntropyAnalysis extends BaseAnalysis {
  value?: number;
}

interface ChiSquareAnalysis extends BaseAnalysis {
  value?: number;
}

interface MonteCarloAnalysis extends BaseAnalysis {
  probabilities?: Record<string, number>;
  debug?: {
    type: string;
    transition_matrix?: {
      raw: Record<string, Record<string, number>>;
      normalized: Record<string, Record<string, number>>;
      counts: Record<string, number>;
    };
    patterns?: {
      significant: Array<{
        pattern: string;
        count: number;
        positions: number[];
        frequency: number;
      }>;
      expectedFrequency: number;
    };
    simulations?: {
      total: number;
      valid: number;
      examples: Array<{
        simulation: number;
        sequence: string[];
        steps: Array<{
          current: string;
          next: string;
          probabilities: Record<string, number>;
          random: number;
        }>;
      }>;
    };
    prediction?: {
      probabilities: Record<string, number>;
      entropy: {
        raw: number;
        normalized: number;
        confidence: number;
      };
      pattern: {
        maxMatch: number;
        confidence: number;
      };
      final: {
        prediction: string;
        confidence: number;
        components: {
          probability: number;
          entropy: number;
          pattern: number;
        };
      };
    };
  };
}

interface ARIMAAnalysis extends BaseAnalysis {
  params?: {
    ar: number[];
    d: number;
    ma: number[];
  };
}

interface LSTMAnalysis extends BaseAnalysis {
  probabilities?: number[];
  isTraining?: boolean;
}

interface HMMAnalysis extends BaseAnalysis {
  stateSequence?: number[];
}

// Combined analysis data type
interface AnalysisData {
  markovChain?: MarkovChainAnalysis;
  entropy?: EntropyAnalysis;
  chiSquare?: ChiSquareAnalysis;
  monteCarlo?: MonteCarloAnalysis;
  arima?: ARIMAAnalysis;
  lstm?: LSTMAnalysis;
  hmm?: HMMAnalysis;
}

interface SequenceResponse {
  success: boolean;
  batchId: string;
  sequence: SequenceItem[];
}

interface ModelPerformance {
  accuracy: number;
  confidence: number;
  totalPredictions: number;
  correctPredictions: number;
  lastPrediction?: number;
  lastActual?: number;
  wasCorrect?: boolean;
}

interface ModelState {
  performance: ModelPerformance;
  needsRetraining: boolean;
  lastTrainingTime?: string;
  error?: string;
  enabled: boolean;
}

interface TransitionMatrixEntry {
  raw: Record<string, Record<string, number>>;
  normalized: Record<string, Record<string, number>>;
  counts: Record<string, number>;
}

interface Pattern {
  pattern: string;
  count: number;
  positions: number[];
  frequency: number;
}

interface SimulationStep {
  current: string;
  next: string;
  probabilities: Record<string, number>;
  random: number;
}

interface SimulationExample {
  simulation: number;
  sequence: string[];
  steps: SimulationStep[];
}

interface MonteCarloDebug {
  type: string;
  transition_matrix?: TransitionMatrixEntry;
  patterns?: {
    significant: Pattern[];
    expectedFrequency: number;
  };
  simulations?: {
    total: number;
    valid: number;
    examples: SimulationExample[];
  };
  prediction?: {
    probabilities: Record<string, number>;
    entropy: {
      raw: number;
      normalized: number;
      confidence: number;
    };
    pattern: {
      maxMatch: number;
      confidence: number;
    };
    final: {
      prediction: string;
      confidence: number;
      components: {
        probability: number;
        entropy: number;
        pattern: number;
      };
    };
  };
}

// Backend API response interface
interface BackendAnalysis {
  symbols: number;
  tools: string[];
  analyses: {
    markovChain: {
      matrix: { [key: string]: { [key: string]: number } };
      prediction?: number;
      confidence: number;
    };
    entropy: {
      entropy: number;
      prediction?: number;
      confidence: number;
    };
    chiSquare: {
      chiSquare: number;
      prediction?: number;
      confidence: number;
    };
    monteCarlo: {
      prediction?: number;
      confidence: number;
    };
    arima: {
      prediction?: number;
      confidence: number;
      params?: {
        ar: number[];
        d: number;
        ma: number[];
      };
      error?: string;
    };
    lstm: {
      prediction?: number;
      confidence: number;
      probabilities?: number[];
      isTraining?: boolean;
    };
    hmm: {
      prediction?: number;
      confidence: number;
      stateSequence?: number[];
    };
  };
}

// API Configuration
const API_BASE_URL = 'http://localhost:5000';
const API_ENDPOINTS = {
  SEQUENCES: `${API_BASE_URL}/api/sequences`,
  ANALYSIS: `${API_BASE_URL}/api/analysis`,
  ADD_SYMBOL: `${API_BASE_URL}/api/sequences/symbol`,
  UNDO: `${API_BASE_URL}/api/sequences/undo`,
  GENERATE: `${API_BASE_URL}/api/sequences/generate-test-data`,
  RESET: `${API_BASE_URL}/api/sequences/reset`
};

// Debug fetch wrapper
const debugFetch = async (url: string, options: RequestInit = {}) => {
  console.group(`API Call: ${options.method || 'GET'} ${url}`);
  console.log('Request Options:', options);
  
  try {
    const response = await fetch(url, options);
    console.log('Response Status:', response.status);
    
    if (!response.ok) {
      console.error('Response Error:', response.statusText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Response Data:', data);
    return data;
  } catch (error) {
    console.error('Fetch Error:', error);
    throw error;
  } finally {
    console.groupEnd();
  }
};

// Matrix transformation helper
const transformMatrix = (matrixRecord: { [key: string]: { [key: string]: number } } | undefined): number[][] => {
  if (!matrixRecord) return [];
  
  const keys = Object.keys(matrixRecord).sort((a, b) => Number(a) - Number(b));
  return keys.map(row => 
    keys.map(col => matrixRecord[row][col] || 0)
  );
};

// Transform functions
function transformPrediction(data: any): BaseAnalysis {
  return {
    predictedNext: data.prediction !== undefined ? data.prediction : data.predictedNext,
    confidence: data.confidence || 0,
    error: data.error
  };
}

function transformAnalysisData(backendData: any): AnalysisData {
  if (!backendData?.analyses) return {};

  return {
    markovChain: backendData.analyses.markovChain ? {
      ...transformPrediction(backendData.analyses.markovChain),
      matrix: backendData.analyses.markovChain.matrix
    } : undefined,
    
    entropy: backendData.analyses.entropy ? {
      ...transformPrediction(backendData.analyses.entropy),
      value: backendData.analyses.entropy.value
    } : undefined,
    
    chiSquare: backendData.analyses.chiSquare ? {
      ...transformPrediction(backendData.analyses.chiSquare),
      value: backendData.analyses.chiSquare.value
    } : undefined,
    
    monteCarlo: backendData.analyses.monteCarlo ? {
      ...transformPrediction(backendData.analyses.monteCarlo),
      probabilities: backendData.analyses.monteCarlo.probabilities,
      debug: backendData.analyses.monteCarlo.debug
    } : undefined,
    
    arima: backendData.analyses.arima ? {
      ...transformPrediction(backendData.analyses.arima),
      params: backendData.analyses.arima.params
    } : undefined,
    
    lstm: backendData.analyses.lstm ? {
      ...transformPrediction(backendData.analyses.lstm),
      probabilities: backendData.analyses.lstm.probabilities,
      isTraining: backendData.analyses.lstm.isTraining
    } : undefined,
    
    hmm: backendData.analyses.hmm ? {
      ...transformPrediction(backendData.analyses.hmm),
      stateSequence: backendData.analyses.hmm.stateSequence
    } : undefined
  };
}

const GameAnalysisPage: React.FC = () => {
  const [sequence, setSequence] = useState<SequenceItem[]>([]);
  const [analysisData, setAnalysisData] = useState<AnalysisData>({});
  const [modelStates, setModelStates] = useState<Record<string, ModelState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);

  // Frontend symbol mapping (0=Spades, 1=Hearts, 2=Diamonds, 3=Clubs)
  const symbols = ['♠', '♥', '♦', '♣'];

  useEffect(() => {
    loadData();
    // Initialize model states
    setModelStates({
      markovChain: { performance: { accuracy: 0, confidence: 0, totalPredictions: 0, correctPredictions: 0 }, needsRetraining: false, enabled: true },
      entropy: { performance: { accuracy: 0, confidence: 0, totalPredictions: 0, correctPredictions: 0 }, needsRetraining: false, enabled: true },
      chiSquare: { performance: { accuracy: 0, confidence: 0, totalPredictions: 0, correctPredictions: 0 }, needsRetraining: false, enabled: true },
      monteCarlo: { performance: { accuracy: 0, confidence: 0, totalPredictions: 0, correctPredictions: 0 }, needsRetraining: false, enabled: true },
      arima: { performance: { accuracy: 0, confidence: 0, totalPredictions: 0, correctPredictions: 0 }, needsRetraining: false, enabled: true },
      lstm: { performance: { accuracy: 0, confidence: 0, totalPredictions: 0, correctPredictions: 0 }, needsRetraining: false, enabled: true },
      hmm: { performance: { accuracy: 0, confidence: 0, totalPredictions: 0, correctPredictions: 0 }, needsRetraining: false, enabled: true }
    });
  }, []);

  const handleError = (message: string) => {
    console.error(message);
    setError({ message, type: 'error' });
  };

  const loadData = async () => {
    try {
      setLoading(true);

      const [sequenceData, analysisData] = await Promise.all([
        debugFetch(API_ENDPOINTS.SEQUENCES),
        debugFetch(API_ENDPOINTS.ANALYSIS)
      ]);

      console.log('Raw Analysis Response:', analysisData);

      if (sequenceData.sequence) {
        setSequence(sequenceData.sequence);
      }

      setAnalysisData(transformAnalysisData(analysisData));

    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const addSymbol = async (symbolIndex: number) => {
    try {
      setLoading(true);
      await debugFetch(API_ENDPOINTS.ADD_SYMBOL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbolIndex }),
      });
      await loadData();
    } catch (error) {
      console.error('Error adding symbol:', error);
    } finally {
      setLoading(false);
    }
  };

  const undoLastSymbol = async () => {
    try {
      await debugFetch(API_ENDPOINTS.UNDO, {
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
      
      await debugFetch(API_ENDPOINTS.GENERATE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      await loadData();
    } catch (error) {
      handleError(error instanceof Error ? error.message : 'Failed to generate test data');
    } finally {
      setLoading(false);
    }
  };

  const resetDatabase = async () => {
    try {
      await debugFetch(API_ENDPOINTS.RESET, {
        method: 'POST'
      });
      await loadData();
      console.log('Database reset successfully');
    } catch (error) {
      console.error('Failed to reset database:', error);
    }
  };

  const fetchAnalysis = useCallback(async () => {
    if (sequence.length < 10) return;

    setLoading(true);
    try {
      const response = await fetch('/api/analysis/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sequence }),
      });

      if (!response.ok) {
        throw new Error('Analysis request failed');
      }

      const data = await response.json();
      setAnalysisData(transformAnalysisData(data));
      setModelStates(data.modelStates);
    } catch (error) {
      console.error('Analysis error:', error);
      setError({ 
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  }, [sequence]);

  const renderAnalysisCard = (type: string, data: any) => {
    if (!data || data.error) return null;

    const displayName = {
      markovChain: 'Markov Chain',
      entropy: 'Entropy Analysis',
      chiSquare: 'Chi-Square Test',
      monteCarlo: 'Monte Carlo',
      arima: 'ARIMA',
      lstm: 'LSTM',
      hmm: 'HMM'
    }[type] || type;

    return (
      <Card sx={{ mb: 2, p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" component="div">
            {displayName}
          </Typography>
          {modelStates[type]?.enabled !== undefined && (
            <Switch
              checked={modelStates[type]?.enabled}
              onChange={(e) => handleModelToggle(type, e.target.checked)}
              size="small"
            />
          )}
        </Box>

        {/* Prediction Display */}
        <Box sx={{ mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Prediction:
          </Typography>
          <Typography variant="h4" component="div" sx={{ fontFamily: 'monospace' }}>
            {data.predictedNext !== undefined && data.predictedNext !== null
              ? symbols[data.predictedNext]
              : 'N/A'}
          </Typography>
        </Box>

        {/* Confidence Bar */}
        <Box sx={{ mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Confidence: {(data.confidence * 100).toFixed(1)}%
          </Typography>
          <LinearProgress
            variant="determinate"
            value={data.confidence * 100}
            sx={{
              height: 8,
              borderRadius: 1,
              bgcolor: 'background.default',
              '& .MuiLinearProgress-bar': {
                bgcolor: data.confidence > 0.7 ? 'success.main' : data.confidence > 0.4 ? 'warning.main' : 'error.main',
              },
            }}
          />
        </Box>

        {/* Symbol Probabilities */}
        {type === 'monteCarlo' && data.debug?.prediction?.probabilities && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2">Symbol Probabilities</Typography>
            <Box sx={{ 
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              mt: 1
            }}>
              {Object.entries(data.debug.prediction.probabilities as Record<string, number>).map(([symbol, prob]) => (
                <Chip
                  key={symbol}
                  label={`${symbol}: ${(prob * 100).toFixed(1)}%`}
                  size="small"
                  sx={{
                    bgcolor: 'background.default',
                    fontFamily: 'monospace'
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Monte Carlo Debug Info */}
        {type === 'monteCarlo' && data.debug && (
          <Box sx={{ mt: 2 }}>
            {/* Transition Matrix */}
            {data.debug.transition_matrix && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2">Transition Matrix</Typography>
                <Box sx={{ 
                  p: 1, 
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  maxHeight: '100px',
                  overflow: 'auto'
                }}>
                  {Object.entries(data.debug.transition_matrix.normalized).map(([from, to]) => (
                    <div key={from}>
                      {symbols[parseInt(from)]} → {
                        Object.entries(to as Record<string, number>)
                          .map(([sym, prob]) => `${symbols[parseInt(sym)]}: ${(prob * 100).toFixed(1)}%`)
                          .join(' | ')
                      }
                    </div>
                  ))}
                </Box>
              </Box>
            )}

            {/* Patterns */}
            {data.debug.patterns?.significant.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2">Significant Patterns</Typography>
                <Box sx={{ 
                  p: 1, 
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  maxHeight: '100px',
                  overflow: 'auto'
                }}>
                  {data.debug.patterns.significant.slice(0, 3).map((pattern: any, i: number) => (
                    <div key={i}>
                      {pattern.pattern}: {pattern.count}x ({(pattern.frequency * 100).toFixed(1)}%)
                    </div>
                  ))}
                </Box>
              </Box>
            )}

            {/* Simulation Examples */}
            {data.debug.simulations && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2">
                  Simulations ({data.debug.simulations.valid}/{data.debug.simulations.total} valid)
                </Typography>
                <Box sx={{ 
                  p: 1, 
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  maxHeight: '100px',
                  overflow: 'auto'
                }}>
                  {data.debug.simulations.examples.slice(0, 3).map((sim: any, i: number) => (
                    <div key={i}>
                      #{sim.simulation}: {sim.sequence.join(' → ')}
                    </div>
                  ))}
                </Box>
              </Box>
            )}

            {/* Prediction Components */}
            {data.debug.prediction && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle2">Confidence Components</Typography>
                <Box sx={{ 
                  p: 1, 
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem'
                }}>
                  <div>Probability: {(data.debug.prediction.components.probability * 100).toFixed(1)}%</div>
                  <div>Entropy: {(data.debug.prediction.components.entropy * 100).toFixed(1)}%</div>
                  <div>Pattern: {(data.debug.prediction.components.pattern * 100).toFixed(1)}%</div>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Model-specific details */}
        {type === 'lstm' && data.isTraining && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="warning.main">
              Model is currently training...
            </Typography>
          </Box>
        )}

        {type === 'arima' && data.params && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Parameters: AR({data.params.ar.join(',')}), I({data.params.d}), MA({data.params.ma.join(',')})
            </Typography>
          </Box>
        )}

        {data.error && (
          <Typography variant="body2" color="error">
            Error: {data.error}
          </Typography>
        )}
      </Card>
    );
  };

  const handleModelToggle = (type: string, checked: boolean) => {
    setModelStates(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        enabled: checked
      }
    }));
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {error && (
        <Alert 
          severity={error.type === 'error' ? 'error' : 'warning'}
          onClose={() => setError(null)}
          sx={{ mb: 2 }}
        >
          {error.message}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Game Controls */}
        <Grid item xs={12} md={4}>
          <Paper elevation={3} sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              Game Controls
            </Typography>
            <Box sx={{ mb: 3 }}>
              <ButtonGroup 
                variant="contained" 
                size="large"
                sx={{ 
                  mb: 2,
                  '& .MuiButton-root': {
                    fontSize: '1.5rem',
                    padding: '12px 24px',
                  }
                }}
              >
                {symbols.map((symbol, index) => (
                  <Button
                    key={symbol}
                    onClick={() => addSymbol(index)}
                    disabled={loading}
                  >
                    {symbol}
                  </Button>
                ))}
              </ButtonGroup>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
              <Button
                variant="contained"
                onClick={generateTestData}
                disabled={loading}
                sx={{ mr: 2 }}
              >
                Generate Test Data
              </Button>
              <IconButton 
                onClick={undoLastSymbol}
                disabled={loading || sequence.length === 0}
                color="primary"
                size="large"
              >
                <UndoIcon fontSize="large" />
              </IconButton>
              <Button
                variant="outlined"
                color="error"
                onClick={resetDatabase}
                disabled={loading}
                sx={{ ml: 2 }}
              >
                Reset DB
              </Button>
            </Box>
            <Typography variant="h6">
              Total Symbols: {sequence.length}
            </Typography>
          </Paper>
        </Grid>

        {/* Analysis Results */}
        <Grid item xs={12} md={8}>
          <Grid container spacing={2}>
            {/* Basic Models (Always Show) */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Basic Analysis Models
              </Typography>
              <Grid container spacing={2}>
                {Object.entries({
                  'Markov Chain': { type: 'markov', ...analysisData.markovChain },
                  'Entropy': { type: 'entropy', ...analysisData.entropy },
                  'Chi-Square': { type: 'chiSquare', ...analysisData.chiSquare }
                } as Record<string, any>).map(([name, data]) => (
                  <Grid item xs={12} sm={6} md={4} key={name}>
                    {renderAnalysisCard(name, data)}
                  </Grid>
                ))}
              </Grid>
            </Grid>

            {/* Advanced Models (Show based on sequence length) */}
            {sequence.length >= 100 && (
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>
                  Advanced Analysis Models
                </Typography>
                <Grid container spacing={2}>
                  {Object.entries({
                    ...(sequence.length >= 100 ? {
                      'Monte Carlo': { type: 'monteCarlo', ...analysisData.monteCarlo }
                    } : {}),
                    ...(sequence.length >= 150 ? {
                      'ARIMA': { type: 'arima', ...analysisData.arima }
                    } : {}),
                    ...(sequence.length >= 200 ? {
                      'LSTM': { type: 'lstm', ...analysisData.lstm }
                    } : {}),
                    ...(sequence.length >= 300 ? {
                      'HMM': { type: 'hmm', ...analysisData.hmm }
                    } : {})
                  } as Record<string, any>).map(([name, data]) => (
                    <Grid item xs={12} sm={6} md={4} key={name}>
                      {renderAnalysisCard(name, data)}
                    </Grid>
                  ))}
                </Grid>
              </Grid>
            )}
          </Grid>
        </Grid>
      </Grid>
    </Container>
  );
};

export default GameAnalysisPage;
