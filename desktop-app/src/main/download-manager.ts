import { createWriteStream, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import type { DownloadItem, DownloadProgress, AppSettings } from '../shared/types';
import { insertFile, fileHashExists, getSetting } from './database';
import { generateId } from '../shared/utils';

export type ProgressCallback = (progress: DownloadProgress) => void;
export type DownloadCompleteCallback = (fileId: string, localPath: string, hash: string) => void;

interface QueuedDownload {
  id: string;
  item: DownloadItem;
  jobId: string;
  resolve: (path: string) => void;
  reject: (err: Error) => void;
}

export class DownloadManager {
  private queue: QueuedDownload[] = [];
  private active = new Map<string, AbortController>();
  private domainTimestamps = new Map<string, number>();
  private progressCallback?: ProgressCallback;
  private settings: AppSettings;

  constructor(settings: AppSettings, progressCallback?: ProgressCallback) {
    this.settings = settings;
    this.progressCallback = progressCallback;
  }

  updateSettings(settings: AppSettings): void {
    this.settings = settings;
  }

  setProgressCallback(cb: ProgressCallback): void {
    this.progressCallback = cb;
  }

  async download(item: DownloadItem, jobId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = generateId();
      this.queue.push({ id, item, jobId, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.active.size >= this.settings.downloadConcurrency) return;
    const next = this.queue.shift();
    if (!next) return;

    const controller = new AbortController();
    this.active.set(next.id, controller);

    try {
      await this.rateLimitForDomain(next.item.url);
      const path = await this.downloadWithRetry(next.item, next.jobId, next.id, controller.signal);
      next.resolve(path);
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.active.delete(next.id);
      this.processQueue();
    }
  }

  private async rateLimitForDomain(url: string): Promise<void> {
    try {
      const domain = new URL(url).hostname;
      const last = this.domainTimestamps.get(domain) ?? 0;
      const elapsed = Date.now() - last;
      if (elapsed < this.settings.rateLimit) {
        await sleep(this.settings.rateLimit - elapsed);
      }
      this.domainTimestamps.set(domain, Date.now());
    } catch {}
  }

  private async downloadWithRetry(
    item: DownloadItem,
    jobId: string,
    downloadId: string,
    signal: AbortSignal
  ): Promise<string> {
    let lastError: Error = new Error('Unknown error');
    const maxRetries = this.settings.downloadRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal.aborted) throw new Error('Cancelled');
      try {
        return await this.performDownload(item, jobId, downloadId, signal);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          await sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }
    throw lastError;
  }

  private async performDownload(
    item: DownloadItem,
    jobId: string,
    downloadId: string,
    signal: AbortSignal
  ): Promise<string> {
    const outputDir = this.resolveOutputDir(item);
    mkdirSync(outputDir, { recursive: true });

    const filename = this.resolveFilename(item, outputDir);
    const tmpPath = `${filename}.part`;
    const finalPath = filename;

    // Check if partial download exists for resume
    let startByte = 0;
    if (existsSync(tmpPath)) {
      startByte = statSync(tmpPath).size;
    }

    return new Promise<string>((resolve, reject) => {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (compatible; UniversalScraper/1.0)',
        'Accept': '*/*',
      };
      if (item.referer) headers['Referer'] = item.referer;
      if (item.cookies) headers['Cookie'] = item.cookies;
      if (startByte > 0) headers['Range'] = `bytes=${startByte}-`;

      const url = new URL(item.url);
      const requester = url.protocol === 'https:' ? https : http;

      const req = requester.get(
        { hostname: url.hostname, path: url.pathname + url.search, headers, port: url.port || undefined },
        (res) => {
          if (signal.aborted) { req.destroy(); reject(new Error('Cancelled')); return; }

          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            req.destroy();
            // Follow redirect
            this.performDownload({ ...item, url: res.headers.location as string }, jobId, downloadId, signal)
              .then(resolve).catch(reject);
            return;
          }

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            req.destroy();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          const totalBytes = res.headers['content-length']
            ? parseInt(res.headers['content-length'], 10) + startByte
            : undefined;

          const hash = crypto.createHash('sha256');
          let downloaded = startByte;
          let lastProgressTime = Date.now();

          const writeStream = createWriteStream(tmpPath, { flags: startByte > 0 ? 'a' : 'w' });

          res.on('data', (chunk: Buffer) => {
            if (signal.aborted) { req.destroy(); writeStream.close(); reject(new Error('Cancelled')); return; }
            writeStream.write(chunk);
            hash.update(chunk);
            downloaded += chunk.length;

            const now = Date.now();
            if (now - lastProgressTime > 500) {
              lastProgressTime = now;
              const speed = chunk.length / ((now - lastProgressTime + 1) / 1000);
              this.progressCallback?.({
                fileId: downloadId,
                url: item.url,
                bytesDownloaded: downloaded,
                totalBytes,
                speed,
                eta: totalBytes ? (totalBytes - downloaded) / Math.max(speed, 1) : undefined,
                percentage: totalBytes ? Math.round((downloaded / totalBytes) * 100) : undefined,
              });
            }
          });

          res.on('end', () => {
            writeStream.close(() => {
              if (signal.aborted) { reject(new Error('Cancelled')); return; }

              const contentHash = hash.digest('hex');

              // Deduplication check
              if (!this.settings.keepDuplicates && fileHashExists(contentHash)) {
                try { require('fs').unlinkSync(tmpPath); } catch {}
                reject(new Error('DUPLICATE'));
                return;
              }

              renameSync(tmpPath, finalPath);

              // Record in database
              insertFile({
                id: generateId(),
                jobId,
                sourceUrl: item.url,
                localPath: finalPath,
                fileType: item.fileType,
                mimeType: item.mimeType ?? res.headers['content-type'] ?? undefined,
                fileSize: downloaded,
                contentHash,
                downloadedAt: new Date().toISOString(),
              });

              resolve(finalPath);
            });
          });

          res.on('error', (err: Error) => { writeStream.close(); reject(err); });
          writeStream.on('error', reject);
        }
      );

      req.on('error', reject);
      signal.addEventListener('abort', () => req.destroy());
    });
  }

  private resolveOutputDir(item: DownloadItem): string {
    const baseDir = this.settings.outputDir || join(process.env.HOME ?? '.', 'Downloads', 'UniversalScraper');
    try {
      const url = new URL(item.url);
      const domain = url.hostname;
      const date = new Date().toISOString().slice(0, 10);
      const typeDir = item.fileType;
      return join(baseDir, domain, date, typeDir);
    } catch {
      return join(baseDir, 'misc');
    }
  }

  private resolveFilename(item: DownloadItem, dir: string): string {
    let name = item.filename ?? '';
    if (!name) {
      try {
        const url = new URL(item.url);
        name = basename(url.pathname) || `file_${Date.now()}`;
      } catch {
        name = `file_${Date.now()}`;
      }
    }

    // Sanitize
    name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 200);

    // Auto-increment if file exists
    let finalPath = join(dir, name);
    if (existsSync(finalPath)) {
      const ext = extname(name);
      const base = basename(name, ext);
      let counter = 1;
      while (existsSync(finalPath)) {
        finalPath = join(dir, `${base}_${counter++}${ext}`);
      }
    }

    return finalPath;
  }

  cancelAll(): void {
    this.active.forEach(ctrl => ctrl.abort());
    this.queue = [];
  }

  cancel(downloadId: string): void {
    this.active.get(downloadId)?.abort();
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.active.size;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
