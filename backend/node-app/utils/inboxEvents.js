const { EventEmitter } = require('events');

const inboxEvents = new EventEmitter();
inboxEvents.setMaxListeners(200);

const emitInboxUpdate = (waId, source) => {
  inboxEvents.emit('inbox:update', {
    wa_id: waId || null,
    source: source || 'unknown',
    timestamp: new Date().toISOString()
  });
};

module.exports = { inboxEvents, emitInboxUpdate };
