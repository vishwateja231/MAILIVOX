/**
 * eventBus.js — Centralized event emitter for realtime SSE broadcasts.
 * Any service can `bus.emit('event', payload)` and every connected SSE
 * client will receive it. Keep payloads small + JSON-serializable.
 */
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(100);

/**
 * Convenience wrapper that always stamps `ts` and broadcasts under 'event'.
 * @param {string} type — event type, e.g. "extension:profile_done"
 * @param {object} data — arbitrary payload
 */
function broadcast(type, data = {}) {
    bus.emit('event', { type, ts: Date.now(), data });
}

module.exports = { bus, broadcast };
