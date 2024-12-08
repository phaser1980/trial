const { EventEmitter } = require('events');
const logger = require('./logger');

class BatchProcessor extends EventEmitter {
    constructor(options = {}) {
        super();
        this.batchSize = options.batchSize || 5;
        this.delayBetweenBatches = options.delayBetweenBatches || 2000; // 2 seconds
        this.queue = [];
        this.processing = false;
        this.debugMode = options.debugMode || false;
    }

    addItems(items) {
        this.queue.push(...items);
        this.emit('queueUpdated', this.queue.length);
        
        if (!this.processing) {
            this.processBatch();
        }
    }

    async processBatch() {
        if (this.queue.length === 0 || this.processing) {
            return;
        }

        this.processing = true;
        
        while (this.queue.length > 0) {
            const batch = this.queue.splice(0, this.batchSize);
            const progress = {
                remaining: this.queue.length,
                processed: batch.length,
                total: this.queue.length + batch.length
            };

            if (this.debugMode) {
                logger.debug(`Processing batch of ${batch.length} items. ${this.queue.length} remaining`);
            }

            try {
                this.emit('batchStart', batch);
                await this.processBatchItems(batch);
                this.emit('batchComplete', progress);
                
                if (this.queue.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
                }
            } catch (error) {
                logger.error('Error processing batch:', error);
                this.emit('batchError', { error, batch });
            }
        }

        this.processing = false;
        this.emit('queueEmpty');
    }

    async processBatchItems(batch) {
        // This should be implemented by the consumer
        throw new Error('processBatchItems must be implemented');
    }

    clearQueue() {
        this.queue = [];
        this.emit('queueCleared');
    }

    get queueLength() {
        return this.queue.length;
    }

    get isProcessing() {
        return this.processing;
    }
}

module.exports = BatchProcessor;
