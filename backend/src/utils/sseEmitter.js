'use strict';

/**
 * SSE Emitter — in-memory pub/sub for Server-Sent Events.
 *
 * Allows the webhook message processor to push events immediately
 * to connected dashboard clients without 5-second polling lag.
 *
 * Usage:
 *   // publisher (messageProcessor.js):
 *   sseEmitter.emit('business:biz_123', { type: 'new_message', conversationId: '...' });
 *
 *   // subscriber (inbox.js SSE route):
 *   sseEmitter.subscribe('business:biz_123', handler);
 *   sseEmitter.unsubscribe('business:biz_123', handler);
 */

const EventEmitter = require('events');

class SSEEmitter extends EventEmitter {}

const sseEmitter = new SSEEmitter();
sseEmitter.setMaxListeners(500); // allow many concurrent SSE connections

module.exports = sseEmitter;
