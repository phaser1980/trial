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
const transformAnalysisData = (backendData: BackendAnalysis | null): AnalysisData => {
  if (!backendData?.analyses) {
    return {
      markovChain: { confidence: 0.25 },
      entropy: { confidence: 0.25 },
      chiSquare: { confidence: 0.25 },
      monteCarlo: { confidence: 0.25 }
    };
  }

  const { markovChain, entropy, chiSquare, monteCarlo } = backendData.analyses;
  
  return {
    markovChain: {
      matrix: transformMatrix(markovChain.matrix),
      predictedNext: markovChain.prediction,
      confidence: markovChain.confidence || 0.25
    },
    entropy: {
      value: entropy.entropy,
      predictedNext: entropy.prediction,
      confidence: entropy.confidence || 0.25
    },
    chiSquare: {
      value: chiSquare.chiSquare,
      predictedNext: chiSquare.prediction,
      confidence: chiSquare.confidence || 0.25
    },
    monteCarlo: {
      predictedNext: monteCarlo.prediction,
      confidence: monteCarlo.confidence || 0.25
    }
  };
};

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
                  'Markov': analysisData.markovChain,
                  'Entropy': analysisData.entropy,
                  'Chi²': analysisData.chiSquare,
                  'Monte Carlo': analysisData.monteCarlo
                }).map(([name, data]) => (
                  data && (
                    <Grid item xs={8} key={name}>
                      <Paper 
                        elevation={1} 
                        sx={{ 
                          p: 1, 
                          backgroundColor: 'background.default',
                          height: '100%'
                        }}
                      >
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          {name}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          {renderAnalysisValue(name, data)}
                        </Typography>
                        <Typography variant="body2">
                          Next: <strong>
                            {typeof data.predictedNext === 'number' 
                              ? symbols[data.predictedNext]
                              : 'N/A'}
                          </strong>
                        </Typography>
                        <Typography variant="caption" display="block" color="text.secondary">
                          Conf: {data.confidence ? `${(data.confidence * 100).toFixed(0)}%` : 'N/A'}
                        </Typography>
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
