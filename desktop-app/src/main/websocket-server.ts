import { WebSocketServer, WebSocket } from 'ws';
import type { AppMessage, AppMessageChunk, ExtractionPayload, DownloadItem } from '../shared/types';

type MessageHandler = (msg: AppMessage, ws: WebSocket) => void;
type ConnectionHandler = (connected: boolean, clientCount: number) => void;

const CHUNK_SIZE = 900_000;
const APP_VERSION = '1.0.0';

// Reassembly buffer for chunked messages
const chunkBuffers = new Map<WebSocket, Map<string, AppMessageChunk[]>>();

export class WebSocketBridge {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private messageHandler: MessageHandler;
  private connectionHandler: ConnectionHandler;
  private port: number;

  constructor(
    port: number,
    messageHandler: MessageHandler,
    connectionHandler: ConnectionHandler
  ) {
    this.port = port;
    this.messageHandler = messageHandler;
    this.connectionHandler = connectionHandler;
  }

  start(): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      chunkBuffers.set(ws, new Map());
      this.connectionHandler(true, this.clients.size);

      ws.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString()) as AppMessage | AppMessageChunk;

          if ((msg as AppMessageChunk).type === 'chunk') {
            this.handleChunk(ws, msg as AppMessageChunk);
          } else {
            this.handleMessage(ws, msg as AppMessage);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        chunkBuffers.delete(ws);
        this.connectionHandler(false, this.clients.size);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
        chunkBuffers.delete(ws);
      });
    });

    this.wss.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[WS] Port ${this.port} already in use`);
      }
    });

    console.log(`[WS] WebSocket server listening on ws://localhost:${this.port}`);
  }

  private handleChunk(ws: WebSocket, chunk: AppMessageChunk): void {
    const buffers = chunkBuffers.get(ws);
    if (!buffers) return;

    const chunks = buffers.get(chunk.id) ?? [];
    chunks[chunk.index] = chunk;
    buffers.set(chunk.id, chunks);

    if (chunks.filter(Boolean).length === chunk.total) {
      buffers.delete(chunk.id);
      const fullData = chunks.map(c => c.data).join('');
      try {
        const msg = JSON.parse(fullData) as AppMessage;
        this.handleMessage(ws, msg);
      } catch {}
    }
  }

  private handleMessage(ws: WebSocket, msg: AppMessage): void {
    if (msg.type === 'ping') {
      this.send(ws, { type: 'pong', version: APP_VERSION });
      return;
    }
    this.messageHandler(msg, ws);
  }

  send(ws: WebSocket, msg: AppMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const json = JSON.stringify(msg);
    if (json.length > CHUNK_SIZE) {
      this.sendChunked(ws, json);
    } else {
      ws.send(json);
    }
  }

  private sendChunked(ws: WebSocket, json: string): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const total = Math.ceil(json.length / CHUNK_SIZE);
    for (let i = 0; i < total; i++) {
      const chunk: AppMessageChunk = {
        type: 'chunk',
        id,
        index: i,
        total,
        data: json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      };
      ws.send(JSON.stringify(chunk));
    }
  }

  broadcast(msg: AppMessage): void {
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        this.send(ws, msg);
      }
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  stop(): void {
    this.clients.forEach(ws => ws.close());
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }
}
