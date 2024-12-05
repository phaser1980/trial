import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Typography,
  Grid,
  Container,
  CardContent,
  IconButton,
  Tooltip,
  Card,
  LinearProgress,
  Switch,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Paper,
  Alert,
  AlertTitle,
  CircularProgress,
  ButtonGroup
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import InfoIcon from '@mui/icons-material/Info';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';
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

interface RNGAnalysis extends BaseAnalysis {
  debug?: {
    hasPotentialRNG: boolean;
    bestMatch: {
      generator: string;
      seed: number;
      similarity: number;
    };
    matchingSequences: {
      original: number[];
      matches: boolean[];
    };
  };
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
  rng?: RNGAnalysis;
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
    rng: {
      prediction?: number;
      confidence: number;
      debug?: {
        hasPotentialRNG: boolean;
        bestMatch: {
          generator: string;
          seed: number;
          similarity: number;
        };
        matchingSequences: {
          original: number[];
          matches: boolean[];
        };
      };
    };
  };
}

// API Configuration
const API_BASE_URL = 'http://localhost:5000';
const API_ENDPOINTS = {
  SEQUENCES: `${API_BASE_URL}/api/sequences`,
  ANALYSIS: `${API_BASE_URL}/api/analysis`,
  ADD_SYMBOL: `${API_BASE_URL}/api/sequences`,
  UNDO: `${API_BASE_URL}/api/sequences/undo`,
  GENERATE: `${API_BASE_URL}/api/sequences/generate`,
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
  // Extract prediction from either debug.final.prediction, prediction, or predictedNext
  let predictedNext = undefined;
  if (data.debug?.final?.prediction !== undefined) {
    predictedNext = parseInt(data.debug.final.prediction);
  } else if (data.prediction !== undefined) {
    predictedNext = data.prediction;
  } else if (data.predictedNext !== undefined) {
    predictedNext = data.predictedNext;
  }

  // Extract confidence from either debug.final.confidence, probability, or confidence
  let confidence = 0;
  if (data.debug?.final?.confidence !== undefined) {
    confidence = data.debug.final.confidence;
  } else if (data.probability !== undefined) {
    confidence = data.probability;
  } else if (data.confidence !== undefined) {
    confidence = data.confidence;
  }

  return {
    predictedNext,
    confidence,
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
    } : undefined,
    
    rng: backendData.analyses.rng ? {
      ...transformPrediction(backendData.analyses.rng),
      debug: backendData.analyses.rng.debug
    } : undefined
  };
}

interface ModelSpecificDisplay {
  [key: string]: React.FC<{data: any}>;
}

const LSTMDisplay: React.FC<{data: any}> = ({data}) => {
  if (!data?.debug?.networkState) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">Network State</Typography>
      {data.isTraining && (
        <Box sx={{ mt: 1, mb: 2 }}>
          <Typography variant="caption" color="info.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            Model is Training
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Predictions may be less accurate during this time.
          </Typography>
        </Box>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="caption">
          Training Loss: {data.debug.networkState.loss?.toFixed(4) || 'N/A'}
        </Typography>
        <Typography variant="caption">
          Epochs: {data.debug.networkState.epochs || 0}
        </Typography>
        <Typography variant="caption">
          Sequence Length: {data.debug.networkState.sequenceLength || 'N/A'}
        </Typography>
        {data.debug.networkState.probabilities && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="subtitle2">Prediction Probabilities</Typography>
            {data.debug.networkState.probabilities.map((prob: number, idx: number) => (
              <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption">{symbolMap[idx]}</Typography>
                <Typography variant="caption">{(prob * 100).toFixed(1)}%</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

const MonteCarloDisplay: React.FC<{data: any}> = ({data}) => {
  if (!data?.debug?.probabilities) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">Symbol Probabilities</Typography>
      {Object.entries(data.debug.probabilities).map(([symbol, prob]) => (
        <Box key={symbol} sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption">{symbolMap[parseInt(symbol)]}</Typography>
          <Typography variant="caption">{(prob as number * 100).toFixed(1)}%</Typography>
        </Box>
      ))}
    </Box>
  );
};

const HMMDisplay: React.FC<{data: any}> = ({data}) => {
  if (!data?.debug?.states) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">Hidden State Analysis</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="caption">
          Active States: {data.debug.states.active || 0}
        </Typography>
        <Typography variant="caption">
          State Stability: {(data.debug.states.stability * 100).toFixed(1)}%
        </Typography>
      </Box>
    </Box>
  );
};

const RNGDisplay: React.FC<{data: any}> = ({data}) => {
  if (!data?.debug?.rng) return null;
  const rngData = data.debug.rng;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">RNG Analysis</Typography>
      {rngData.hasPotentialRNG ? (
        <>
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="success.main">
              Potential RNG pattern detected!
            </Typography>
            <Typography variant="body2">
              Best Match: {rngData.bestMatch.generator} (Seed: {rngData.bestMatch.seed})
            </Typography>
            <Typography variant="caption">
              Similarity: {(rngData.bestMatch.similarity * 100).toFixed(1)}%
            </Typography>
          </Box>
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2">Pattern Visualization</Typography>
            <Box sx={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              gap: 0.5, 
              mt: 1,
              maxHeight: '100px',
              overflowY: 'auto'
            }}>
              {rngData.matchingSequences.matches.map((matches: boolean, idx: number) => (
                <Chip
                  key={idx}
                  label={symbolMap[rngData.matchingSequences.original[idx]]}
                  size="small"
                  color={matches ? "success" : "error"}
                  sx={{ minWidth: '40px' }}
                />
              ))}
            </Box>
          </Box>
        </>
      ) : (
        <Typography variant="caption" color="text.secondary">
          No RNG patterns detected
        </Typography>
      )}
    </Box>
  );
};

const modelSpecificDisplays: ModelSpecificDisplay = {
  'lstm': LSTMDisplay,
  'monte carlo': MonteCarloDisplay,
  'hmm': HMMDisplay,
  'rng': RNGDisplay
};

const symbolMap = ['♠', '♥', '♦', '♣'];

const GameAnalysisPage: React.FC = () => {
  const [sequence, setSequence] = useState<SequenceItem[]>([]);
  const [analysisData, setAnalysisData] = useState<AnalysisData>({});
  const [modelStates, setModelStates] = useState<Record<string, ModelState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{type: 'error' | 'warning', message: string} | null>(null);

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
      hmm: { performance: { accuracy: 0, confidence: 0, totalPredictions: 0, correctPredictions: 0 }, needsRetraining: false, enabled: true },
      rng: { performance: { accuracy: 0, confidence: 0, totalPredictions: 0, correctPredictions: 0 }, needsRetraining: false, enabled: true }
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
        },
        body: JSON.stringify({
          seedType: 'lcg',
          seedValue: Date.now(),
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
      hmm: 'HMM',
      rng: 'RNG'
    }[type] || type;

    const ModelDisplay = modelSpecificDisplays[type.toLowerCase()];

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
              ? symbolMap[data.predictedNext]
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
                  label={`${symbolMap[parseInt(symbol)]}: ${(prob * 100).toFixed(1)}%`}
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

        {/* Monte Carlo Detailed Analysis */}
        {type === 'monteCarlo' && data.debug && (
          <Box sx={{ mt: 2 }}>
            {/* Transition Matrix Section */}
            {data.debug.transition_matrix && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Transition Matrix Analysis</Typography>
                <Grid container spacing={2}>
                  {Object.entries(data.debug.transition_matrix.normalized as Record<string, Record<string, number>>).map(([from, transitions]) => (
                    <Grid item xs={12} sm={6} md={4} key={from}>
                      <Paper sx={{ p: 1, bgcolor: 'background.paper' }}>
                        <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                          From {symbolMap[parseInt(from)]}:
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {Object.entries(transitions as Record<string, number>).map(([to, prob]) => (
                            <Chip
                              key={to}
                              label={`${symbolMap[parseInt(to)]}: ${(prob * 100).toFixed(1)}%`}
                              size="small"
                              sx={{
                                bgcolor: prob > 0.5 ? 'success.main' : prob > 0.25 ? 'warning.main' : 'error.main',
                                color: 'white',
                                fontSize: '0.7rem'
                              }}
                            />
                          ))}
                        </Box>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}

            {/* Pattern Analysis Section */}
            {data.debug.patterns?.significant && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Significant Patterns</Typography>
                <Grid container spacing={1}>
                  {data.debug.patterns.significant.map((pattern: { pattern: string; frequency: number }, idx: number) => (
                    <Grid item xs={12} sm={6} md={4} key={idx}>
                      <Paper sx={{ p: 1, bgcolor: 'background.paper' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {pattern.pattern.split('').map(p => symbolMap[parseInt(p)]).join(' → ')}
                          </Typography>
                          <Chip
                            label={`${(pattern.frequency * 100).toFixed(1)}%`}
                            size="small"
                            color={pattern.frequency > 0.3 ? 'success' : 'warning'}
                          />
                        </Box>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}

            {/* Prediction Components */}
            {data.debug.prediction?.final && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Prediction Analysis</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 2, bgcolor: 'background.paper' }}>
                      <Typography variant="body2" sx={{ mb: 1 }}>Confidence Components</Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {Object.entries(data.debug.prediction.final.components as Record<string, number>).map(([component, value]) => (
                          <Box key={component}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="caption" sx={{ textTransform: 'capitalize' }}>
                                {component}
                              </Typography>
                              <Typography variant="caption">
                                {(value * 100).toFixed(1)}%
                              </Typography>
                            </Box>
                            <LinearProgress
                              variant="determinate"
                              value={value * 100}
                              sx={{
                                bgcolor: 'background.default',
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: value > 0.7 ? 'success.main' : value > 0.4 ? 'warning.main' : 'error.main',
                                },
                              }}
                            />
                          </Box>
                        ))}
                      </Box>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 2, bgcolor: 'background.paper' }}>
                      <Typography variant="body2" sx={{ mb: 1 }}>Symbol Probabilities</Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {Object.entries(data.debug.prediction.probabilities as Record<string, number>)
                          .sort(([, a], [, b]) => b - a)
                          .map(([symbol, prob]) => (
                            <Box key={symbol}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                  {symbolMap[parseInt(symbol)]}
                                </Typography>
                                <Typography variant="caption">
                                  {(prob * 100).toFixed(1)}%
                                </Typography>
                              </Box>
                              <LinearProgress
                                variant="determinate"
                                value={prob * 100}
                                sx={{
                                  bgcolor: 'background.default',
                                  '& .MuiLinearProgress-bar': {
                                    bgcolor: prob > 0.4 ? 'success.main' : prob > 0.2 ? 'warning.main' : 'error.main',
                                  },
                                }}
                              />
                            </Box>
                        ))}
                      </Box>
                    </Paper>
                  </Grid>
                </Grid>
              </Box>
            )}

            {/* Simulation Examples */}
            {data.debug.simulations?.examples && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Simulation Examples ({data.debug.simulations.valid} valid out of {data.debug.simulations.total})
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {data.debug.simulations.examples.map((example: { simulation: number; sequence: string[] }, idx: number) => (
                    <Paper key={idx} sx={{ p: 1, bgcolor: 'background.paper' }}>
                      <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
                        Simulation {example.simulation}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {example.sequence.map((sym: string, symIdx: number) => (
                          <Chip
                            key={symIdx}
                            label={symbolMap[parseInt(sym)]}
                            size="small"
                            sx={{
                              bgcolor: symIdx === example.sequence.length - 1 ? 'primary.main' : 'background.default',
                              color: symIdx === example.sequence.length - 1 ? 'white' : 'text.primary',
                              fontFamily: 'monospace'
                            }}
                          />
                        ))}
                      </Box>
                    </Paper>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* LSTM Detailed Analysis */}
        {type === 'lstm' && data && (
          <Box sx={{ mt: 2 }}>
            {/* Training Status */}
            {data.isTraining && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <AlertTitle>Model is Training</AlertTitle>
                The LSTM model is currently being trained. Predictions may be less accurate during this time.
              </Alert>
            )}

            {/* Probability Distribution */}
            {data.probabilities && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Probability Distribution</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Paper sx={{ p: 2, bgcolor: 'background.paper' }}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {data.probabilities.map((prob: number, idx: number) => (
                          <Box key={idx}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                {symbolMap[idx]}
                              </Typography>
                              <Typography variant="caption">
                                {(prob * 100).toFixed(1)}%
                              </Typography>
                            </Box>
                            <LinearProgress
                              variant="determinate"
                              value={prob * 100}
                              sx={{
                                bgcolor: 'background.default',
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: prob > 0.4 ? 'success.main' : prob > 0.2 ? 'warning.main' : 'error.main',
                                },
                              }}
                            />
                          </Box>
                        ))}
                      </Box>
                    </Paper>
                  </Grid>
                </Grid>
              </Box>
            )}

            {/* Model Performance */}
            {modelStates.lstm?.performance && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Model Performance</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Paper sx={{ p: 2, bgcolor: 'background.paper' }}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Box>
                          <Typography variant="caption" sx={{ mb: 0.5, display: 'block' }}>
                            Accuracy
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress
                              variant="determinate"
                              value={modelStates.lstm.performance.accuracy * 100}
                              size={40}
                              sx={{
                                color: modelStates.lstm.performance.accuracy > 0.7 ? 'success.main' : 
                                       modelStates.lstm.performance.accuracy > 0.4 ? 'warning.main' : 'error.main'
                              }}
                            />
                            <Typography variant="body2">
                              {(modelStates.lstm.performance.accuracy * 100).toFixed(1)}%
                            </Typography>
                          </Box>
                        </Box>
                        <Box>
                          <Typography variant="caption" sx={{ mb: 0.5, display: 'block' }}>
                            Predictions
                          </Typography>
                          <Typography variant="body2">
                            {modelStates.lstm.performance.correctPredictions} correct out of {modelStates.lstm.performance.totalPredictions} total
                          </Typography>
                        </Box>
                      </Box>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Paper sx={{ p: 2, bgcolor: 'background.paper' }}>
                      <Typography variant="caption" sx={{ mb: 0.5, display: 'block' }}>
                        Last Prediction
                      </Typography>
                      {modelStates.lstm.performance.lastPrediction !== undefined && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip
                            label={symbolMap[modelStates.lstm.performance.lastPrediction]}
                            color={modelStates.lstm.performance.wasCorrect ? "success" : "error"}
                            size="small"
                          />
                          <Typography variant="caption">
                            {modelStates.lstm.performance.wasCorrect ? "Correct" : "Incorrect"}
                          </Typography>
                        </Box>
                      )}
                      {modelStates.lstm.lastTrainingTime && (
                        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                          Last trained: {new Date(modelStates.lstm.lastTrainingTime).toLocaleString()}
                        </Typography>
                      )}
                    </Paper>
                  </Grid>
                </Grid>
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
        
        {ModelDisplay && <ModelDisplay data={data} />}
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
        <Box sx={{ mb: 2 }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 2, 
              bgcolor: error.type === 'error' ? 'error.main' : 'warning.main',
              color: 'white'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography>{error.message}</Typography>
              <IconButton size="small" onClick={() => setError(null)} sx={{ color: 'white' }}>
                <CloseIcon />
              </IconButton>
            </Box>
          </Paper>
        </Box>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" component="h2" gutterBottom>
              Symbol Input
            </Typography>
            <Box sx={{ mb: 3 }}>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1,
                  mb: 2
                }}
              >
                {symbolMap.map((symbol, index) => (
                  <Button
                    key={symbol}
                    variant="contained"
                    size="large"
                    onClick={() => addSymbol(index)}
                    disabled={loading}
                    sx={{
                      minWidth: '80px',
                      fontSize: '1.5rem',
                      fontFamily: 'monospace'
                    }}
                  >
                    {symbol}
                  </Button>
                ))}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button
                  variant="outlined"
                  onClick={generateTestData}
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={20} /> : null}
                >
                  Generate Test Data
                </Button>
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={undoLastSymbol}
                  disabled={loading || sequence.length === 0}
                  startIcon={<UndoIcon />}
                >
                  Undo
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={resetDatabase}
                  disabled={loading}
                >
                  Reset DB
                </Button>
              </Box>
            </Box>
            
            {/* Sequence Display */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                Current Sequence ({sequence.length} symbols)
              </Typography>
              <Box sx={{ 
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                maxHeight: '150px',
                overflowY: 'auto',
                p: 1,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1
              }}>
                {sequence.map((item, index) => (
                  <Chip
                    key={index}
                    label={symbolMap[item.symbol]}
                    size="small"
                    sx={{ 
                      fontFamily: 'monospace',
                      fontSize: '1rem'
                    }}
                  />
                ))}
              </Box>
            </Box>
          </Paper>
        </Grid>

        {/* Analysis Cards */}
        <Grid item xs={12}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="h5" gutterBottom>Basic Analysis Models</Typography>
            </Grid>
            {Object.entries({
              'Markov Chain': { type: 'basic', ...analysisData.markovChain },
              'Entropy': { type: 'basic', ...analysisData.entropy },
              'Chi-Square': { type: 'basic', ...analysisData.chiSquare }
            }).map(([name, data]) => (
              <Grid item xs={12} sm={6} md={4} key={name}>
                {renderAnalysisCard(name, data)}
              </Grid>
            ))}
          </Grid>
        </Grid>

        <Grid item xs={12}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="h5" gutterBottom>Advanced Analysis Models</Typography>
            </Grid>
            {Object.entries({
              'Monte Carlo': { type: 'advanced', ...analysisData.monteCarlo },
              'ARIMA': { type: 'advanced', ...analysisData.arima },
              ...(sequence.length >= 200 ? {
                'LSTM': { type: 'advanced', ...analysisData.lstm }
              } : {}),
              ...(sequence.length >= 300 ? {
                'HMM': { type: 'advanced', ...analysisData.hmm }
              } : {}),
              ...(sequence.length >= 50 ? {
                'RNG': { type: 'advanced', ...analysisData.rng }
              } : {})
            }).map(([name, data]) => (
              <Grid item xs={12} sm={6} md={4} key={name}>
                {renderAnalysisCard(name, data)}
              </Grid>
            ))}
          </Grid>
        </Grid>
      </Grid>
    </Container>
  );
};

export default GameAnalysisPage;
