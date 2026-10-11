import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Socket event listeners receive variadic payload arguments of any shape
type Listener = (...args: any[]) => void;

export interface WishboardSocket {
  connected: boolean;
  on(event: string, cb: Listener): void;
  off(event: string, cb: Listener): void;
  emit(event: string, data?: Record<string, unknown>): void;
}

class RawWebSocketWrapper implements WishboardSocket {
  private listeners: Record<string, Listener[]> = {};
  private ws: WebSocket | null = null;
  private pending: string[] = [];
  public connected: boolean = false;

  constructor() {
    this.connect();
  }

  private connect() {
    const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Fallback to routing over CloudFront /socket.io path or configured URL
    const wsUrl =
      (import.meta.env.VITE_WS_URL as string) ||
      // Trailing slash matters: CloudFront's `/socket.io/*` behavior does not
      // match the bare `/socket.io`, which would fall through to the S3 origin.
      `${protocol}//${globalThis.location.host}/socket.io/`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        // Flush anything queued before the socket opened (e.g. an early subscribe).
        this.pending.forEach((m) => this.ws?.send(m));
        this.pending = [];
        this.trigger('connect');
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.trigger('disconnect');
        setTimeout(() => this.connect(), 3000); // Reconnect interval
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.event) {
            this.trigger(payload.event, payload.data);
          }
        } catch (err) {
          console.error('Error parsing raw WebSocket message:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('Raw WebSocket error:', err);
      };
    } catch (err) {
      console.error('Failed to initialize raw WebSocket connection:', err);
      setTimeout(() => this.connect(), 3000);
    }
  }

  public on(event: string, cb: Listener) {
    this.listeners[event] ??= [];
    this.listeners[event].push(cb);
  }

  public off(event: string, cb: Listener) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((l) => l !== cb);
  }

  /**
   * Send an action message to the server, mirroring socket.io's `emit(event, data)`
   * so callers stay transport-agnostic. Here it becomes an API Gateway WebSocket
   * action frame (`{ action, ...data }`), queued until the socket is open.
   */
  public emit(event: string, data?: Record<string, unknown>) {
    const message = JSON.stringify({ action: event, ...data });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.pending.push(message);
    }
  }

  private trigger(event: string, data?: unknown) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach((cb) => cb(data));
  }
}

// Global instances
let socketInstance: Socket | null = null;
let rawInstance: RawWebSocketWrapper | null = null;

export const getSocket = (): WishboardSocket => {
  const isRawMode =
    import.meta.env.VITE_USE_RAW_WEBSOCKETS === 'true' ||
    (globalThis as unknown as { __WISHBOARD_CONFIG__?: { realtimeProvider?: string } })
      .__WISHBOARD_CONFIG__?.realtimeProvider === 'apigateway';

  if (isRawMode) {
    rawInstance ??= new RawWebSocketWrapper();
    return rawInstance;
  } else {
    socketInstance ??= io(globalThis.location.origin, {
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    return socketInstance;
  }
};

export const useWebSocket = () => {
  const [isConnected, setIsConnected] = useState(() => getSocket().connected);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return { socket: getSocket(), isConnected };
};
