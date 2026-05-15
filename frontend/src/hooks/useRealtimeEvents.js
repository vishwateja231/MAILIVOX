/**
 * useRealtimeEvents — SSE hook for live dashboard updates.
 * Connects to GET /api/events/stream and dispatches events to subscribers.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * @param {function} onEvent — called with each parsed event object
 * @returns {{ connected: boolean, reconnecting: boolean }}
 */
export function useRealtimeEvents(onEvent) {
    const [connected, setConnected] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const esRef = useRef(null);
    const retriesRef = useRef(0);
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;

    const connect = useCallback(() => {
        if (esRef.current) {
            esRef.current.close();
        }

        const es = new EventSource(`${API}/api/events/stream`);
        esRef.current = es;

        es.onopen = () => {
            setConnected(true);
            setReconnecting(false);
            retriesRef.current = 0;
        };

        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                onEventRef.current(data);
            } catch { /* ignore non-JSON heartbeats */ }
        };

        es.onerror = () => {
            setConnected(false);
            es.close();
            esRef.current = null;

            // Exponential backoff reconnect
            const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
            retriesRef.current++;
            setReconnecting(true);
            setTimeout(connect, delay);
        };
    }, []);

    useEffect(() => {
        connect();
        return () => {
            if (esRef.current) {
                esRef.current.close();
                esRef.current = null;
            }
        };
    }, [connect]);

    return { connected, reconnecting };
}
