const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const util = require('util');
const sequencesRouter = require('./routes/sequences');
const analysisRouter = require('./routes/analysis');
const { initializeDatabase } = require('./initDb');

const execAsync = util.promisify(exec);
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/sequences', sequencesRouter);
app.use('/api/analysis', analysisRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

async function isPortInUse(port) {
  try {
    const { stdout } = await execAsync('netstat -ano | findstr "LISTENING"');
    return stdout.includes(`:${port}`);
  } catch (error) {
    console.error('Error checking port:', error.message);
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
        console.log(`Killed process ${pid} on port ${port}`);
      } catch (err) {
        if (!err.message.includes('not found')) {
          console.error(`Error killing process ${pid}:`, err.message);
        }
      }
    }
  } catch (error) {
    console.error('Error killing process:', error.message);
  }
}

// Function to start server with retries
async function startServer(retries = 3) {
  try {
    // Initialize database before starting server
    await initializeDatabase();
    
    for (let i = 0; i < retries; i++) {
      try {
        if (await isPortInUse(PORT)) {
          console.log(`Port ${PORT} is in use. Attempting to free it...`);
          await killProcessOnPort(PORT);
          // Wait a bit for the port to be freed
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const server = app.listen(PORT, () => {
          console.log(`Server is running on port ${PORT}`);
        });

        // Handle graceful shutdown
        const shutdown = async () => {
          console.info('Shutdown signal received. Closing server...');
          server.close(() => {
            console.log('Server closed');
            process.exit(0);
          });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

        // If we get here, server started successfully
        return;
      } catch (error) {
        console.error(`Attempt ${i + 1} failed:`, error.message);
        if (i === retries - 1) {
          console.error(`Failed to start server after ${retries} attempts`);
          process.exit(1);
        }
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
