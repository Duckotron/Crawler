import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import type { AppSettings } from '../shared/types';

export type FfmpegProgressCallback = (percentage: number, currentTime: string) => void;

export class FfmpegHandler {
  private settings: AppSettings;
  private activeProcesses = new Map<string, ChildProcess>();

  constructor(settings: AppSettings) {
    this.settings = settings;
  }

  updateSettings(settings: AppSettings): void {
    this.settings = settings;
  }

  private getFfmpegPath(): string {
    if (this.settings.ffmpegPath && existsSync(this.settings.ffmpegPath)) {
      return this.settings.ffmpegPath;
    }
    // Try bundled ffmpeg-static
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpegPath = require('ffmpeg-static') as string;
      if (ffmpegPath && existsSync(ffmpegPath)) return ffmpegPath;
    } catch {}
    // Fallback to system ffmpeg
    return 'ffmpeg';
  }

  /**
   * Download an HLS (.m3u8) or DASH (.mpd) stream to a local file.
   */
  async downloadStream(
    streamUrl: string,
    outputDir: string,
    filename: string,
    onProgress?: FfmpegProgressCallback
  ): Promise<string> {
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, filename.endsWith('.mp4') ? filename : `${filename}.mp4`);

    return new Promise((resolve, reject) => {
      const ffmpegPath = this.getFfmpegPath();
      const args = [
        '-y',
        '-i', streamUrl,
        '-c', 'copy',
        '-movflags', '+faststart',
        outputPath,
      ];

      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const id = `${Date.now()}`;
      this.activeProcesses.set(id, proc);

      let duration = 0;
      let stderr = '';

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;

        // Parse duration
        const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)/);
        if (durationMatch) {
          duration = parseInt(durationMatch[1]) * 3600 +
            parseInt(durationMatch[2]) * 60 +
            parseInt(durationMatch[3]);
        }

        // Parse progress
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+)/);
        if (timeMatch && duration > 0) {
          const currentSeconds = parseInt(timeMatch[1]) * 3600 +
            parseInt(timeMatch[2]) * 60 +
            parseInt(timeMatch[3]);
          const percentage = Math.round((currentSeconds / duration) * 100);
          onProgress?.(percentage, timeMatch[0].slice(5));
        }
      });

      proc.on('close', (code) => {
        this.activeProcesses.delete(id);
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-500)}`));
        }
      });

      proc.on('error', (err) => {
        this.activeProcesses.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Extract a thumbnail frame from a video file.
   */
  async extractThumbnail(videoPath: string, outputDir: string): Promise<string> {
    mkdirSync(outputDir, { recursive: true });
    const name = basename(videoPath, '.mp4');
    const thumbPath = join(outputDir, `${name}_thumb.jpg`);

    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i', videoPath,
        '-ss', '00:00:05',
        '-vframes', '1',
        '-q:v', '2',
        thumbPath,
      ];

      const proc = spawn(this.getFfmpegPath(), args, { stdio: 'ignore' });
      proc.on('close', (code) => {
        if (code === 0) resolve(thumbPath);
        else reject(new Error(`ffmpeg thumbnail failed with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  /**
   * Merge separate video + audio streams (e.g., from YouTube-like sources).
   */
  async mergeStreams(
    videoPath: string,
    audioPath: string,
    outputPath: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i', videoPath,
        '-i', audioPath,
        '-c', 'copy',
        outputPath,
      ];
      const proc = spawn(this.getFfmpegPath(), args, { stdio: 'ignore' });
      proc.on('close', (code) => {
        if (code === 0) resolve(outputPath);
        else reject(new Error(`ffmpeg merge failed: ${code}`));
      });
      proc.on('error', reject);
    });
  }

  /**
   * Convert a video to a different format.
   */
  async transcode(
    inputPath: string,
    outputPath: string,
    format: 'mp4' | 'webm' | 'mkv' = 'mp4',
    onProgress?: FfmpegProgressCallback
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const codecMap = { mp4: 'libx264', webm: 'libvpx-vp9', mkv: 'libx264' };
      const args = [
        '-y',
        '-i', inputPath,
        '-c:v', codecMap[format],
        '-c:a', 'aac',
        outputPath,
      ];

      let duration = 0;
      const proc = spawn(this.getFfmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)/);
        if (durationMatch) {
          duration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3]);
        }
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+)/);
        if (timeMatch && duration > 0) {
          const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
          onProgress?.(Math.round((secs / duration) * 100), timeMatch[0].slice(5));
        }
      });

      proc.on('close', code => code === 0 ? resolve(outputPath) : reject(new Error(`transcode failed: ${code}`)));
      proc.on('error', reject);
    });
  }

  /**
   * Parse a .m3u8 playlist to find quality variants.
   */
  parseM3U8Qualities(m3u8Content: string): { url: string; bandwidth?: number; resolution?: string }[] {
    const lines = m3u8Content.split('\n');
    const variants: { url: string; bandwidth?: number; resolution?: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        const resMatch = line.match(/RESOLUTION=(\S+)/);
        const url = lines[i + 1]?.trim();
        if (url && !url.startsWith('#')) {
          variants.push({
            url,
            bandwidth: bwMatch ? parseInt(bwMatch[1]) : undefined,
            resolution: resMatch?.[1],
          });
        }
      }
    }
    return variants;
  }

  cancelAll(): void {
    this.activeProcesses.forEach(proc => proc.kill('SIGTERM'));
    this.activeProcesses.clear();
  }

  isAvailable(): boolean {
    try {
      const { spawnSync } = require('child_process') as typeof import('child_process');
      const result = spawnSync(this.getFfmpegPath(), ['-version'], { timeout: 3000 });
      return result.status === 0;
    } catch {
      return false;
    }
  }
}
