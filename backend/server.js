const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const util = require('util');
const rateLimit = require('express-rate-limit');
const WebSocketManager = require('./websocket/manager');
const analysisQueue = require('./queues/analysisQueue');
const logger = require('./utils/logger');

const execAsync = util.promisify(exec);
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(cors());
app.use(express.json());
app.use(limiter);

// Routes
app.use('/api/sequences', require('./routes/sequences'));
app.use('/api/analysis', require('./routes/analysis'));

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack
  });
  
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    }
  });
});

async function isPortInUse(port) {
  try {
    const { stdout } = await execAsync('netstat -ano | findstr "LISTENING"');
    return stdout.includes(`:${port}`);
  } catch (error) {
    logger.error('Error checking port:', error);
    return false;
  }
}

async function killProcessOnPort(port) {
  try {
    const { stdout } = await execAsync('netstat -ano | findstr "LISTENING"');
    const regex = new RegExp(`:${port}\\s+.*?\\s+(\\d+)`, 'g');
    const matches = [...stdout.matchAll(regex)];
    
    for (const match of matches) {
      const pid = match[1];
      try {
        await execAsync(`taskkill /F /PID ${pid}`);
        logger.info(`Killed process ${pid} on port ${port}`);
      } catch (err) {
        if (!err.message.includes('not found')) {
          logger.error(`Error killing process ${pid}:`, err);
        }
      }
    }
  } catch (error) {
    logger.error('Error killing process:', error);
  }
}

async function startServer(retries = 3) {
  let attempt = 0;
  
  while (attempt < retries) {
    try {
      const portInUse = await isPortInUse(PORT);
      if (portInUse) {
        logger.warn(`Port ${PORT} is in use, attempting to kill existing process`);
        await killProcessOnPort(PORT);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      const server = app.listen(PORT, () => {
        logger.info(`Server is running on port ${PORT}`);
      });

      // Initialize WebSocket manager
      global.wsManager = new WebSocketManager(server);
      logger.info('WebSocket server initialized');

      // Initialize analysis queue
      global.analysisQueue = analysisQueue;
      logger.info('Analysis queue initialized');

      // Graceful shutdown
      process.on('SIGTERM', async () => {
        logger.info('SIGTERM received, shutting down gracefully');
        
        // Close WebSocket connections
        if (global.wsManager) {
          global.wsManager.wss.close();
        }
        
        // Close Bull queue
        if (global.analysisQueue) {
          await global.analysisQueue.queue.close();
        }
        
        server.close(() => {
          logger.info('Server closed');
          process.exit(0);
        });
      });

      return server;
    } catch (error) {
      attempt++;
      logger.error(`Failed to start server (attempt ${attempt}/${retries}):`, error);
      
      if (attempt === retries) {
        logger.error('Failed to start server after all retries');
        process.exit(1);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Start the server
startServer();
