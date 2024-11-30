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

  return {
    markovChain: backendData.analyses.markovChain ? {
      matrix: transformMatrix(backendData.analyses.markovChain.matrix),
      predictedNext: backendData.analyses.markovChain.prediction,
      confidence: backendData.analyses.markovChain.confidence
    } : undefined,
    entropy: backendData.analyses.entropy ? {
      value: backendData.analyses.entropy.entropy,
      predictedNext: backendData.analyses.entropy.prediction,
      confidence: backendData.analyses.entropy.confidence
    } : undefined,
    chiSquare: backendData.analyses.chiSquare ? {
      value: backendData.analyses.chiSquare.chiSquare,
      predictedNext: backendData.analyses.chiSquare.prediction,
      confidence: backendData.analyses.chiSquare.confidence
    } : undefined,
    monteCarlo: backendData.analyses.monteCarlo ? {
      predictedNext: backendData.analyses.monteCarlo.prediction,
      confidence: backendData.analyses.monteCarlo.confidence
    } : undefined,
    arima: backendData.analyses.arima ? {
      predictedNext: backendData.analyses.arima.prediction,
      confidence: backendData.analyses.arima.confidence,
      params: backendData.analyses.arima.params,
      error: backendData.analyses.arima.error
    } : undefined,
    lstm: backendData.analyses.lstm ? {
      predictedNext: backendData.analyses.lstm.prediction,
      confidence: backendData.analyses.lstm.confidence,
      probabilities: backendData.analyses.lstm.probabilities,
      isTraining: backendData.analyses.lstm.isTraining
    } : undefined,
    hmm: backendData.analyses.hmm ? {
      predictedNext: backendData.analyses.hmm.prediction,
      confidence: backendData.analyses.hmm.confidence,
      stateSequence: backendData.analyses.hmm.stateSequence
    } : undefined
  };
}

const GameAnalysisPage: React.FC = () => {
  const [sequence, setSequence] = useState<SequenceItem[]>([]);
  const [analysisData, setAnalysisData] = useState<AnalysisData>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);

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

  const renderAnalysisValue = (name: string, data: any) => {
    if (!data) return 'No Data Available';

    // Show matrix size for Markov Chain
    if (name === 'Markov' && data.matrix) {
      return `Matrix: ${data.matrix.length}x${data.matrix[0]?.length ?? 0}`;
    }

    // Show values for other analysis types
    if (data.value !== undefined) {
      return `Value: ${data.value.toFixed(3)}`;
    }

    return 'N/A';
  };

  // Helper type for analysis data
  type AnalysisType = 
    | { type: 'markov'; matrix?: number[][]; predictedNext?: number; confidence: number; }
    | { type: 'entropy'; value?: number; predictedNext?: number; confidence: number; }
    | { type: 'chiSquare'; value?: number; predictedNext?: number; confidence: number; }
    | { type: 'monteCarlo'; predictedNext?: number; confidence: number; }
    | { type: 'arima'; predictedNext?: number; confidence: number; params?: { ar: number[]; d: number; ma: number[]; }; error?: string; }
    | { type: 'lstm'; predictedNext?: number; confidence: number; probabilities?: number[]; isTraining?: boolean; }
    | { type: 'hmm'; predictedNext?: number; confidence: number; stateSequence?: number[]; };

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
        <Grid item xs={12} md={5}>
          <Paper elevation={3} sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Analysis Results
            </Typography>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Grid container spacing={2}>
                {Object.entries({
                  'Markov': { type: 'markov', ...analysisData.markovChain },
                  'Entropy': { type: 'entropy', ...analysisData.entropy },
                  'Chi²': { type: 'chiSquare', ...analysisData.chiSquare },
                  'Monte Carlo': { type: 'monteCarlo', ...analysisData.monteCarlo },
                  'ARIMA': { type: 'arima', ...analysisData.arima },
                  'LSTM': { type: 'lstm', ...analysisData.lstm },
                  'HMM': { type: 'hmm', ...analysisData.hmm }
                } as Record<string, AnalysisType>).map(([name, data]) => (
                  data && (
                    <Grid item xs={8} key={name}>
                      <Paper 
                        elevation={1} 
                        sx={{ 
                          p: 2, 
                          height: '100%',
                          backgroundColor: loading ? 'action.disabledBackground' : 
                            name === 'ARIMA' ? 'rgba(25, 118, 210, 0.04)' : 'background.paper',
                          border: name === 'ARIMA' ? '1px solid rgba(25, 118, 210, 0.25)' : 'none'
                        }}
                      >
                        <Typography variant="h6" component="h3" 
                          sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 1,
                            color: name === 'ARIMA' ? 'primary.main' : 'text.primary'
                          }}
                        >
                          {name}
                          {data.type === 'arima' && data.error && (
                            <Tooltip title={data.error}>
                              <IconButton size="small" color="warning">
                                <InfoIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Typography>
                        <Typography variant="body1">
                          Next: <strong>
                            {data.predictedNext !== undefined ? 
                              symbols[data.predictedNext] : 
                              'N/A'
                            }
                          </strong>
                        </Typography>
                        <Typography variant="caption" display="block" color="text.secondary">
                          Conf: {data.confidence ? `${(data.confidence * 100).toFixed(0)}%` : 'N/A'}
                        </Typography>
                        {data.type === 'arima' && data.params && (
                          <>
                            <Typography variant="body2" sx={{ mt: 1, fontWeight: 'medium' }}>
                              Model Parameters:
                            </Typography>
                            <Box sx={{ 
                              mt: 0.5, 
                              p: 1, 
                              backgroundColor: 'background.paper',
                              borderRadius: 1,
                              fontSize: '0.875rem'
                            }}>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                AR({data.params.ar.length}): [{data.params.ar.map(v => v.toFixed(2)).join(', ')}]
                                <br />
                                D: {data.params.d}
                                <br />
                                MA({data.params.ma.length}): [{data.params.ma.map(v => v.toFixed(2)).join(', ')}]
                              </Typography>
                            </Box>
                            {data.error && (
                              <Typography variant="caption" color="warning.main" sx={{ mt: 1, display: 'block' }}>
                                {data.error}
                              </Typography>
                            )}
                          </>
                        )}
                        {data.type === 'lstm' && (
                          <>
                            <Typography variant="body2" sx={{ mt: 1, fontWeight: 'medium' }}>
                              LSTM State:
                            </Typography>
                            <Box sx={{ 
                              mt: 0.5, 
                              p: 1, 
                              backgroundColor: 'background.paper',
                              borderRadius: 1,
                              fontSize: '0.875rem'
                            }}>
                              {data.isTraining ? (
                                <Typography variant="body2" color="primary">
                                  Training in progress...
                                </Typography>
                              ) : (
                                <>
                                  {data.probabilities && (
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                      Probabilities:<br/>
                                      {data.probabilities.map((p, i) => 
                                        `${symbols[i]}: ${(p * 100).toFixed(1)}%`
                                      ).join('\n')}
                                    </Typography>
                                  )}
                                </>
                              )}
                            </Box>
                          </>
                        )}
                        {data.type === 'hmm' && (
                          <>
                            <Typography variant="body2" sx={{ mt: 1, fontWeight: 'medium' }}>
                              HMM State:
                            </Typography>
                            <Box sx={{ 
                              mt: 0.5, 
                              p: 1, 
                              backgroundColor: 'background.paper',
                              borderRadius: 1,
                              fontSize: '0.875rem'
                            }}>
                              {data.stateSequence && (
                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                  Last States: {data.stateSequence.slice(-5).join(' → ')}
                                </Typography>
                              )}
                            </Box>
                          </>
                        )}
                      </Paper>
                    </Grid>
                  )
                ))}
              </Grid>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default GameAnalysisPage;
