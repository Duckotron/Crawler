/**
 * Native Messaging Host
 * When launched by Chrome's native messaging system, this module reads
 * from stdin and writes to stdout using the 4-byte-length-prefix protocol.
 */

import type { AppMessage, AppMessageChunk } from '../shared/types';

const APP_VERSION = '1.0.0';
const CHUNK_SIZE = 900_000;

type MessageHandler = (msg: AppMessage) => void;

const pendingChunks = new Map<string, AppMessageChunk[]>();

export function startNativeMessagingHost(handler: MessageHandler): void {
  process.stdin.on('readable', () => {
    readMessage(handler);
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}

function readMessage(handler: MessageHandler): void {
  // Read the 4-byte length prefix
  const lengthBuf = process.stdin.read(4) as Buffer | null;
  if (!lengthBuf || lengthBuf.length < 4) return;

  const messageLength = lengthBuf.readUInt32LE(0);
  if (messageLength > 4 * 1024 * 1024) {
    console.error('[NativeMsg] Message too large:', messageLength);
    return;
  }

  const messageBuf = process.stdin.read(messageLength) as Buffer | null;
  if (!messageBuf || messageBuf.length < messageLength) {
    // Put back and wait for more data
    process.stdin.unshift(Buffer.concat([lengthBuf, messageBuf ?? Buffer.alloc(0)]));
    return;
  }

  try {
    const msg = JSON.parse(messageBuf.toString('utf8')) as AppMessage | AppMessageChunk;

    if ((msg as AppMessageChunk).type === 'chunk') {
      handleChunk(msg as AppMessageChunk, handler);
    } else {
      handleMessage(msg as AppMessage, handler);
    }
  } catch (err) {
    console.error('[NativeMsg] Parse error:', err);
  }

  // Try to read more messages
  setImmediate(() => readMessage(handler));
}

function handleChunk(chunk: AppMessageChunk, handler: MessageHandler): void {
  const chunks = pendingChunks.get(chunk.id) ?? [];
  chunks[chunk.index] = chunk;
  pendingChunks.set(chunk.id, chunks);

  if (chunks.filter(Boolean).length === chunk.total) {
    pendingChunks.delete(chunk.id);
    const fullData = chunks.map(c => c.data).join('');
    try {
      const msg = JSON.parse(fullData) as AppMessage;
      handleMessage(msg, handler);
    } catch {}
  }
}

function handleMessage(msg: AppMessage, handler: MessageHandler): void {
  if (msg.type === 'ping') {
    sendMessage({ type: 'pong', version: APP_VERSION });
    return;
  }
  handler(msg);
}

export function sendMessage(msg: AppMessage | object): void {
  const json = JSON.stringify(msg);

  if (json.length > CHUNK_SIZE) {
    sendChunked(json);
  } else {
    writeMessage(json);
  }
}

function sendChunked(json: string): void {
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
    writeMessage(JSON.stringify(chunk));
  }
}

function writeMessage(json: string): void {
  const msgBuffer = Buffer.from(json, 'utf8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(msgBuffer.length, 0);
  process.stdout.write(Buffer.concat([lengthBuffer, msgBuffer]));
}
