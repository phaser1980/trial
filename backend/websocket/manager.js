const WebSocket = require('ws');
const Redis = require('ioredis');
const logger = require('../utils/logger');

class WebSocketManager {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.setupRedis();
    this.setupWebSocket();
    this.setupHeartbeat();
  }

  setupRedis() {
    this.pub = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    this.sub = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    // Subscribe to channels
    this.sub.subscribe('sequence-updates', 'analysis-updates', (err) => {
      if (err) {
        logger.error('Redis subscription error:', err);
        return;
      }
      logger.info('Subscribed to Redis channels');
    });

    // Handle messages
    this.sub.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        this.broadcast(channel, data);
      } catch (error) {
        logger.error('Error processing Redis message:', error);
      }
    });

    // Handle Redis errors
    this.pub.on('error', (err) => logger.error('Redis Publisher Error:', err));
    this.sub.on('error', (err) => logger.error('Redis Subscriber Error:', err));
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      ws.isAlive = true;
      ws.id = Math.random().toString(36).substring(2, 15);
      
      logger.info('New WebSocket connection', { id: ws.id });

      // Handle pong messages
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Handle client messages
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleClientMessage(ws, data);
        } catch (error) {
          logger.error('Error handling WebSocket message:', error);
          ws.send(JSON.stringify({
            type: 'ERROR',
            error: 'Invalid message format'
          }));
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        logger.info('Client disconnected', { id: ws.id });
      });

      // Send initial connection success message
      ws.send(JSON.stringify({
        type: 'CONNECTED',
        id: ws.id,
        timestamp: Date.now()
      }));
    });
  }

  setupHeartbeat() {
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          logger.info('Terminating inactive connection', { id: ws.id });
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 second interval

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  async handleClientMessage(ws, message) {
    switch (message.type) {
      case 'SUBSCRIBE':
        // Handle subscription requests
        if (Array.isArray(message.channels)) {
          ws.subscribedChannels = message.channels;
          ws.send(JSON.stringify({
            type: 'SUBSCRIBED',
            channels: message.channels
          }));
        }
        break;

      case 'UNSUBSCRIBE':
        // Handle unsubscribe requests
        if (Array.isArray(message.channels)) {
          ws.subscribedChannels = ws.subscribedChannels.filter(
            channel => !message.channels.includes(channel)
          );
          ws.send(JSON.stringify({
            type: 'UNSUBSCRIBED',
            channels: message.channels
          }));
        }
        break;

      default:
        ws.send(JSON.stringify({
          type: 'ERROR',
          error: 'Unknown message type'
        }));
    }
  }

  broadcast(channel, data) {
    const message = JSON.stringify({
      type: 'UPDATE',
      channel,
      data,
      timestamp: Date.now()
    });

    this.wss.clients.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        (!client.subscribedChannels || 
         client.subscribedChannels.includes(channel))
      ) {
        client.send(message);
      }
    });
  }

  // Publish updates to Redis
  async publishUpdate(channel, data) {
    try {
      await this.pub.publish(channel, JSON.stringify(data));
      logger.debug('Published update to Redis', { channel });
    } catch (error) {
      logger.error('Error publishing to Redis:', error);
    }
  }

  // Helper method to publish sequence updates
  async publishSequenceUpdate(data) {
    return this.publishUpdate('sequence-updates', data);
  }

  // Helper method to publish analysis updates
  async publishAnalysisUpdate(data) {
    return this.publishUpdate('analysis-updates', data);
  }
}

module.exports = WebSocketManager;
