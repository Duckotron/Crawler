/**
 * Communication bridge between the extension and the desktop companion app.
 * Supports two modes: Chrome Native Messaging and local WebSocket.
 */

import type { AppMessage, ExtensionSettings, AppMessageChunk } from '../shared/types';
import { generateId } from '../shared/messaging';

const CHUNK_SIZE = 900_000; // ~900KB — stay under the 1MB native messaging limit

type BridgeCallback = (msg: AppMessage) => void;

export class AppBridge {
  private settings: ExtensionSettings;
  private callback: BridgeCallback;
  private ws: WebSocket | null = null;
  private nativePort: chrome.runtime.Port | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _connected = false;
  private appVersion?: string;
  private pendingChunks = new Map<string, AppMessageChunk[]>();

  constructor(settings: ExtensionSettings, callback: BridgeCallback) {
    this.settings = settings;
    this.callback = callback;
  }

  connect(): void {
    if (this.settings.communicationMode === 'websocket') {
      this.connectWebSocket();
    } else {
      this.connectNativeMessaging();
    }
  }

  private connectWebSocket(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const url = `ws://localhost:${this.settings.wsPort}`;
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this._connected = true;
        this.reconnectDelay = 1000;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        // Send a ping to get version
        this.sendRaw({ type: 'ping' });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: AppMessage = JSON.parse(event.data);
          this.handleIncoming(msg);
        } catch {}
      };

      this.ws.onerror = () => {
        this._connected = false;
      };

      this.ws.onclose = () => {
        this._connected = false;
        this.scheduleReconnect();
      };
    } catch {
      this._connected = false;
      this.scheduleReconnect();
    }
  }

  private connectNativeMessaging(): void {
    try {
      this.nativePort = chrome.runtime.connectNative(this.settings.nativeHostName);
      this._connected = true;

      this.nativePort.onMessage.addListener((msg: AppMessage | AppMessageChunk) => {
        if ((msg as AppMessageChunk).type === 'chunk') {
          this.handleChunk(msg as AppMessageChunk);
        } else {
          this.handleIncoming(msg as AppMessage);
        }
      });

      this.nativePort.onDisconnect.addListener(() => {
        this._connected = false;
        this.nativePort = null;
        this.scheduleReconnect();
      });

      // Ping for version
      this.sendRaw({ type: 'ping' });
    } catch {
      this._connected = false;
      this.scheduleReconnect();
    }
  }

  private handleIncoming(msg: AppMessage): void {
    if (msg.type === 'pong') {
      this.appVersion = msg.version;
      this._connected = true;
    }
    this.callback(msg);
  }

  private handleChunk(chunk: AppMessageChunk): void {
    const chunks = this.pendingChunks.get(chunk.id) ?? [];
    chunks[chunk.index] = chunk;
    this.pendingChunks.set(chunk.id, chunks);

    if (chunks.filter(Boolean).length === chunk.total) {
      this.pendingChunks.delete(chunk.id);
      const fullData = chunks.map(c => c.data).join('');
      try {
        const msg: AppMessage = JSON.parse(fullData);
        this.handleIncoming(msg);
      } catch {}
    }
  }

  send(msg: AppMessage): void {
    const json = JSON.stringify(msg);

    if (json.length > CHUNK_SIZE) {
      this.sendChunked(json);
    } else {
      this.sendRaw(msg);
    }
  }

  private sendChunked(json: string): void {
    const id = generateId();
    const totalChunks = Math.ceil(json.length / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      const chunk: AppMessageChunk = {
        type: 'chunk',
        id,
        index: i,
        total: totalChunks,
        data: json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      };
      this.sendRaw(chunk as unknown as AppMessage);
    }
  }

  private sendRaw(msg: unknown): void {
    if (this.settings.communicationMode === 'websocket') {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    } else {
      if (this.nativePort) {
        this.nativePort.postMessage(msg);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      this.connect();
    }, this.reconnectDelay);
  }

  isConnected(): boolean {
    if (this.settings.communicationMode === 'websocket') {
      return this.ws?.readyState === WebSocket.OPEN;
    }
    return this._connected && this.nativePort !== null;
  }

  getAppVersion(): string | undefined {
    return this.appVersion;
  }

  destroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.nativePort?.disconnect();
    this.ws = null;
    this.nativePort = null;
    this._connected = false;
  }
}
