const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const rateLimit = require('express-rate-limit');
const WebSocketManager = require('./websocket/manager');
const analysisQueue = require('./queues/analysisQueue');
const logger = require('./utils/logger');
const ModelEnsemble = require('./utils/modelEnsemble');

const execAsync = util.promisify(exec);
dotenv.config();

const app = express();
const PORT = process.env.PORT || 49152;

// Initialize model ensemble
global.modelEnsemble = new ModelEnsemble();
logger.info('ModelEnsemble initialized');

// Simple rate limiter for single-user app
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1-minute window
  max: 1000,               // 1000 requests per minute (generous for single user)
  message: { error: 'Rate limit exceeded', message: 'Please try again in a moment' }
});

// Apply CORS and JSON middleware
app.use(cors());
app.use(express.json());
app.use(limiter);

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`Incoming ${req.method} request to ${req.path}`, {
    headers: req.headers,
    query: req.query,
    body: req.body
  });
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Global error handler:', err);
  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Middleware to ensure all API responses have JSON content type
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  // Add CORS headers for API routes
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// API Routes
app.use('/api/sequences', require('./routes/sequences'));
app.use('/api/analysis', require('./routes/analysis'));

// Handle unmatched API routes with JSON response
app.use('/api/*', (req, res) => {
  logger.warn(`Unmatched API route: ${req.path}`);
  res.status(404).json({ 
    error: 'Not Found', 
    message: 'API endpoint does not exist',
    path: req.path 
  });
});

// Root endpoint for health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Server is running',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Serve static files and handle client-side routing AFTER API routes
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../build')));
  
  // Handle client-side routing - but NOT for /api routes
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(__dirname, '../build/index.html'));
  });
} else {
  // In development, we still want to handle 404s properly
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'Resource not found',
      path: req.path
    });
  });
}

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
      
      app.listen(PORT, () => {
        logger.info(`Server is running on port ${PORT}`);
      });

      // Initialize WebSocket manager
      global.wsManager = new WebSocketManager(app);
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
        
        app.close(() => {
          logger.info('Server closed');
          process.exit(0);
        });
      });

      return app;
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
