import React, { useState, useEffect } from 'react';
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
  Tooltip
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import InfoIcon from '@mui/icons-material/Info';
import { v4 as uuidv4 } from 'uuid';

interface SequenceItem {
  symbol: number;
  created_at: string;
}

interface AnalysisData {
  markovChain?: {
    matrix?: number[][];
    predictedNext?: number;
    confidence: number;
  };
  entropy?: {
    value?: number;
    predictedNext?: number;
    confidence: number;
  };
  chiSquare?: {
    value?: number;
    predictedNext?: number;
    confidence: number;
  };
  monteCarlo?: {
    predictedNext?: number;
    confidence: number;
    probabilities?: Record<string, number>;
    debug?: MonteCarloDebug;
  };
  arima?: {
    predictedNext?: number;
    confidence: number;
    params?: {
      ar: number[];
      d: number;
      ma: number[];
    };
    error?: string;
  };
  lstm?: {
    predictedNext?: number;
    confidence: number;
    probabilities?: number[];
    isTraining?: boolean;
  };
  hmm?: {
    predictedNext?: number;
    confidence: number;
    stateSequence?: number[];
  };
}

interface SequenceResponse {
  success: boolean;
  batchId: string;
  sequence: SequenceItem;
}

interface ErrorState {
  message: string;
  type: 'error' | 'warning' | 'info';
  timestamp: number;
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

// Analysis data transformer
function transformAnalysisData(backendData: BackendAnalysis | null): AnalysisData {
  if (!backendData) return {};

  const defaultConfidence = 0;

  // Helper function to transform prediction data
  const transformPrediction = (data: { prediction?: number | null, confidence?: number | null }) => ({
    predictedNext: data.prediction !== null ? data.prediction : undefined,
    confidence: data.confidence ?? defaultConfidence
  });

  return {
    markovChain: {
      matrix: backendData.analyses.markovChain?.matrix ? transformMatrix(backendData.analyses.markovChain.matrix) : undefined,
      ...transformPrediction(backendData.analyses.markovChain || {})
    },
    entropy: {
      value: backendData.analyses.entropy?.entropy,
      ...transformPrediction(backendData.analyses.entropy || {})
    },
    chiSquare: {
      value: backendData.analyses.chiSquare?.chiSquare,
      ...transformPrediction(backendData.analyses.chiSquare || {})
    },
    monteCarlo: transformPrediction(backendData.analyses.monteCarlo || {}),
    arima: {
      ...transformPrediction(backendData.analyses.arima || {}),
      params: backendData.analyses.arima?.params,
      error: backendData.analyses.arima?.error
    },
    lstm: {
      ...transformPrediction(backendData.analyses.lstm || {}),
      probabilities: backendData.analyses.lstm?.probabilities,
      isTraining: backendData.analyses.lstm?.isTraining
    },
    hmm: {
      ...transformPrediction(backendData.analyses.hmm || {}),
      stateSequence: backendData.analyses.hmm?.stateSequence
    }
  };
}

// Model performance tracking interface
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
  }, []);

  const handleError = (message: string) => {
    console.error(message);
    setError({ message, type: 'error', timestamp: Date.now() });
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

  const renderModelBox = (name: string, data: any, performance?: ModelPerformance) => {
    const getAccuracyColor = (accuracy: number) => {
      if (accuracy >= 0.7) return 'success.main';
      if (accuracy >= 0.5) return 'warning.main';
      return 'error.main';
    };

    const getConfidenceIndicator = (confidence: number) => {
      const bars = Math.floor(confidence * 5);
      return Array(5).fill('▢').map((char, i) => 
        i < bars ? '▣' : char
      ).join('');
    };

    const formatPrediction = (pred: number | undefined) => {
      if (pred === undefined || pred === null) return 'N/A';
      return symbols[pred] || '?';
    };

    const formatConfidence = (conf: number) => {
      if (conf === undefined || conf === null) return 0;
      return Math.max(0, Math.min(1, conf));
    };

    return (
      <Paper 
        elevation={3} 
        sx={{ 
          p: 2,
          height: '100%',
          backgroundColor: data.type === 'lstm' && (data as any).isTraining ? 
            'rgba(25, 118, 210, 0.04)' : 'background.paper',
          border: '1px solid',
          borderColor: performance?.wasCorrect ? 'success.light' : 
            performance?.wasCorrect === false ? 'error.light' : 'divider'
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" component="h3">
            {name}
          </Typography>
          {performance && (
            <Typography 
              variant="body2" 
              sx={{ 
                color: getAccuracyColor(performance.accuracy),
                fontWeight: 'bold'
              }}
            >
              {(performance.accuracy * 100).toFixed(1)}%
            </Typography>
          )}
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="body1" sx={{ mb: 0.5 }}>
            Prediction: <strong>{formatPrediction(data.predictedNext)}</strong>
          </Typography>
          <Typography 
            variant="caption" 
            sx={{ 
              display: 'block',
              fontFamily: 'monospace',
              color: formatConfidence(data.confidence) > 0.7 ? 'success.main' : 
                formatConfidence(data.confidence) > 0.4 ? 'warning.main' : 'text.secondary'
            }}
          >
            Confidence: {getConfidenceIndicator(formatConfidence(data.confidence))}
            {' '}({(formatConfidence(data.confidence) * 100).toFixed(0)}%)
          </Typography>
          {data.error && (
            <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 1 }}>
              Error: {data.error}
            </Typography>
          )}
        </Box>

        {/* Model-specific details */}
        {data.type === 'monteCarlo' && data.debug && (
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
            {data.debug.patterns && data.debug.patterns.significant.length > 0 && (
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
                  {data.debug.patterns.significant.slice(0, 3).map((pattern: Pattern, i: number) => (
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
                  {data.debug.simulations.examples.slice(0, 3).map((sim: SimulationExample, i: number) => (
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

        {data.type === 'lstm' && (
          <Box sx={{ mt: 1 }}>
            {(data as any).isTraining ? (
              <Typography variant="body2" color="primary.main">
                Training in progress...
              </Typography>
            ) : (
              (data as any).probabilities && (
                <Box sx={{ 
                  mt: 1, 
                  p: 1, 
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem'
                }}>
                  {symbols.map((s, i) => (
                    <div key={i}>
                      {s}: {((data as any).probabilities[i] * 100).toFixed(1)}%
                    </div>
                  ))}
                </Box>
              )
            )}
          </Box>
        )}

        {data.type === 'arima' && (data as any).params && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
              AR: [{(data as any).params.ar.map((v: number) => v.toFixed(2)).join(', ')}]
              <br/>
              MA: [{(data as any).params.ma.map((v: number) => v.toFixed(2)).join(', ')}]
            </Typography>
          </Box>
        )}

        {data.type === 'hmm' && (data as any).stateSequence && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
              States: {(data as any).stateSequence.slice(-3).join(' → ')}
            </Typography>
          </Box>
        )}

        {/* Performance metrics */}
        {performance && (
          <Box 
            sx={{ 
              mt: 2,
              pt: 1,
              borderTop: '1px solid',
              borderColor: 'divider'
            }}
          >
            <Typography variant="caption" display="block" color="text.secondary">
              Total Predictions: {performance.totalPredictions}
            </Typography>
            <Typography variant="caption" display="block" color="text.secondary">
              Correct: {performance.correctPredictions}
            </Typography>
            {performance.lastPrediction !== undefined && (
              <Typography 
                variant="caption" 
                display="block" 
                sx={{ 
                  color: performance.wasCorrect ? 'success.main' : 'error.main',
                  fontWeight: 'medium'
                }}
              >
                Last: {symbols[performance.lastPrediction]} → {
                  performance.lastActual !== undefined ? 
                    symbols[performance.lastActual] : '?'
                }
              </Typography>
            )}
          </Box>
        )}
      </Paper>
    );
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {error && (
        <Alert 
          severity={error.type}
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
                    {renderModelBox(name, data, modelStates[name]?.performance)}
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
                      {renderModelBox(name, data, modelStates[name]?.performance)}
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
