import { join, dirname, basename, extname } from 'path';
import { existsSync } from 'fs';
import type { AppSettings } from '../shared/types';
import { FfmpegHandler } from './ffmpeg-handler';

export class PostProcessor {
  private settings: AppSettings;
  private ffmpeg: FfmpegHandler;

  constructor(settings: AppSettings, ffmpeg: FfmpegHandler) {
    this.settings = settings;
    this.ffmpeg = ffmpeg;
  }

  /**
   * Generate a thumbnail for a video file.
   */
  async generateVideoThumbnail(videoPath: string): Promise<string | null> {
    if (!this.settings.generateThumbnails) return null;
    try {
      const thumbDir = join(dirname(videoPath), '.thumbs');
      return await this.ffmpeg.extractThumbnail(videoPath, thumbDir);
    } catch {
      return null;
    }
  }

  /**
   * Generate a thumbnail for an image (resize to 200x200).
   * Uses sharp if available, otherwise returns null.
   */
  async generateImageThumbnail(imagePath: string): Promise<string | null> {
    if (!this.settings.generateThumbnails) return null;
    try {
      const sharp = await import('sharp').catch(() => null);
      if (!sharp) return null;
      const thumbDir = join(dirname(imagePath), '.thumbs');
      const { mkdirSync } = await import('fs');
      mkdirSync(thumbDir, { recursive: true });
      const thumbPath = join(thumbDir, basename(imagePath));
      await sharp.default(imagePath).resize(200, 200, { fit: 'inside' }).toFile(thumbPath);
      return thumbPath;
    } catch {
      return null;
    }
  }

  /**
   * Strip EXIF metadata from an image using sharp.
   */
  async stripExif(imagePath: string): Promise<void> {
    if (!this.settings.stripExif) return;
    try {
      const sharp = await import('sharp').catch(() => null);
      if (!sharp) return;
      const tmpPath = `${imagePath}.tmp`;
      await sharp.default(imagePath).withMetadata({ exif: {} }).toFile(tmpPath);
      const { renameSync } = await import('fs');
      renameSync(tmpPath, imagePath);
    } catch {}
  }

  /**
   * Run Tesseract OCR on an image and return extracted text.
   */
  async runOCR(imagePath: string): Promise<string | null> {
    if (!this.settings.ocrEnabled) return null;
    try {
      const { createWorker } = await import('tesseract.js').catch(() => ({ createWorker: null }));
      if (!createWorker) return null;
      const worker = await createWorker('eng');
      const { data: { text } } = await worker.recognize(imagePath);
      await worker.terminate();
      return text.trim();
    } catch {
      return null;
    }
  }

  /**
   * Convert an image to a different format using sharp.
   */
  async convertImageFormat(
    inputPath: string,
    format: 'jpeg' | 'png' | 'webp',
    outputDir?: string
  ): Promise<string | null> {
    try {
      const sharp = await import('sharp').catch(() => null);
      if (!sharp) return null;
      const dir = outputDir ?? dirname(inputPath);
      const name = basename(inputPath, extname(inputPath));
      const outputPath = join(dir, `${name}.${format}`);
      await sharp.default(inputPath).toFormat(format).toFile(outputPath);
      return outputPath;
    } catch {
      return null;
    }
  }

  /**
   * Validate links by sending HEAD requests.
   */
  async validateLink(url: string, timeout = 5000): Promise<number | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const resp = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
      clearTimeout(timer);
      return resp.status;
    } catch {
      return null;
    }
  }
}
