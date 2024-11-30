import React, { useState, useEffect } from 'react';
import { 
  Container, 
  Grid,
  Button,
  Typography, 
  Box,
  ButtonGroup,
  IconButton,
  Tooltip,
  LinearProgress,
  Alert,
  Paper
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';

// Define a simpler interface that matches exactly what we get from the backend
interface SequenceItem {
  symbol: number;
  created_at: string;
}

interface ThresholdInfo {
  level: number;
  message: string;
  color: string;
}

const GamePage: React.FC = () => {
  // Initialize with empty array and explicitly type it
  const [sequence, setSequence] = useState<SequenceItem[]>([]);
  const [thresholdInfo, setThresholdInfo] = useState<ThresholdInfo>({ 
    level: 1, 
    message: '100 more symbols until Markov Chain Analysis', 
    color: 'warning' 
  });
  const symbols = ['♠', '♥', '♦', '♣'];
  const symbolColors = ['#000', '#ff0000', '#00ff00', '#0000ff'];

  // Simplified getThresholdInfo function
  const getThresholdInfo = (count: number): ThresholdInfo => {
    if (count >= 300) {
      return { level: 4, message: 'Autocorrelation Analysis Active', color: 'success' };
    } else if (count >= 200) {
      return { level: 3, message: 'Runs Test Analysis Active', color: 'info' };
    } else if (count >= 100) {
      return { level: 2, message: 'Markov Chain Analysis Active', color: 'primary' };
    } else {
      return { 
        level: 1, 
        message: `${100 - count} more symbols until Markov Chain Analysis`, 
        color: 'warning' 
      };
    }
  };

  const loadSequence = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/sequences/1');
      const data = await response.json();
      
      // Ensure we have an array of symbols
      const symbols = Array.isArray(data?.symbols) ? data.symbols : [];
      setSequence(symbols);
      setThresholdInfo(getThresholdInfo(symbols.length));
    } catch (error) {
      console.error('Error loading sequence:', error);
      setSequence([]);
    }
  };

  useEffect(() => {
    loadSequence();
  }, []);

  const addSymbol = async (symbolIndex: number) => {
    try {
      console.log('Adding symbol:', symbolIndex);
      const response = await fetch('http://localhost:5000/api/sequences/1/symbol', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbol: symbolIndex }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to add symbol');
      }

      // After adding symbol, fetch analysis
      const analysisResponse = await fetch('http://localhost:5000/api/analysis');
      const analysisData = await analysisResponse.json();
      console.log('Analysis after adding symbol:', analysisData);

      // Reload the sequence
      await loadSequence();
    } catch (error) {
      console.error('Error adding symbol:', error);
    }
  };

  const undoLastSymbol = async () => {
    try {
      await fetch('http://localhost:5000/api/sequences/1/undo', {
        method: 'DELETE',
      });
      // Reload the sequence instead of updating state directly
      await loadSequence();
    } catch (error) {
      console.error('Error undoing last symbol:', error);
    }
  };

  const clearDatabase = async () => {
    try {
      await fetch('http://localhost:5000/api/sequences/cleanup', {
        method: 'DELETE',
      });
      setSequence([]);
      setThresholdInfo({ 
        level: 1, 
        message: '100 more symbols until Markov Chain Analysis', 
        color: 'warning' 
      });
    } catch (error) {
      console.error('Error clearing database:', error);
    }
  };

  // Only render if sequence is an array
  const renderSequence = () => {
    if (!Array.isArray(sequence)) return null;

    return sequence.map((item, index) => (
      <Typography key={index} variant="body1">
        {symbols[item.symbol]} ({new Date(item.created_at).toLocaleTimeString()})
      </Typography>
    ));
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ mt: 4 }}>
        <Typography variant="h4" gutterBottom>
          RNG Analysis Game
        </Typography>

        <Grid container spacing={2} sx={{ mt: 2 }}>
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Game Controls
            </Typography>
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" gutterBottom>
              Total Symbols: {sequence.length}
            </Typography>
          </Grid>
          <Grid item container spacing={1}>
            {[0, 1, 2, 3].map((symbolIndex) => (
              <Grid item key={symbolIndex}>
                <Button
                  variant="contained"
                  onClick={() => addSymbol(symbolIndex)}
                  sx={{
                    minWidth: '48px',
                    height: '48px',
                    backgroundColor: symbolColors[symbolIndex],
                    '&:hover': {
                      backgroundColor: symbolColors[symbolIndex],
                      opacity: 0.8,
                    },
                  }}
                >
                  {symbolIndex}
                </Button>
              </Grid>
            ))}
          </Grid>
          <Grid item xs={12}>
            <Button
              variant="outlined"
              onClick={undoLastSymbol}
              disabled={sequence.length === 0}
            >
              Undo Last Symbol
            </Button>
          </Grid>
        </Grid>

        <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Current Sequence ({sequence.length} symbols)
            </Typography>
          </Box>

          <LinearProgress 
            variant="determinate" 
            value={Math.min((sequence.length / 300) * 100, 100)} 
            color={thresholdInfo.color as any}
            sx={{ mb: 2 }}
          />
          
          <Alert severity={thresholdInfo.color as any} sx={{ mb: 2 }}>
            {thresholdInfo.message}
          </Alert>

          <Box sx={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: 1, 
            maxHeight: '200px', 
            overflowY: 'auto', 
            mb: 3,
            p: 2,
            border: '1px solid #eee',
            borderRadius: 1
          }}>
            {renderSequence()}
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default GamePage;
