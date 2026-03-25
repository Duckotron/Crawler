import type { ScrapeJob, ExtractionPayload, DownloadItem, AppSettings } from '../shared/types';
import {
  insertJob, updateJobStatus, getPendingJobs, getJob
} from './database';
import { DownloadManager } from './download-manager';
import { FfmpegHandler } from './ffmpeg-handler';
import { generateId } from '../shared/utils';

export type JobUpdateCallback = (job: ScrapeJob) => void;

export class JobQueue {
  private running = new Map<string, ScrapeJob>();
  private maxConcurrent: number;
  private downloadManager: DownloadManager;
  private ffmpegHandler: FfmpegHandler;
  private jobUpdateCallback?: JobUpdateCallback;
  private processing = false;
  private processingInterval?: ReturnType<typeof setInterval>;

  constructor(
    settings: AppSettings,
    downloadManager: DownloadManager,
    ffmpegHandler: FfmpegHandler,
    jobUpdateCallback?: JobUpdateCallback
  ) {
    this.maxConcurrent = settings.downloadConcurrency;
    this.downloadManager = downloadManager;
    this.ffmpegHandler = ffmpegHandler;
    this.jobUpdateCallback = jobUpdateCallback;
  }

  start(): void {
    this.processingInterval = setInterval(() => this.processNext(), 1000);
  }

  stop(): void {
    if (this.processingInterval) clearInterval(this.processingInterval);
  }

  /**
   * Create a single-page scrape job from an extraction payload already received from the extension.
   */
  async processExtraction(payload: ExtractionPayload): Promise<string> {
    const jobId = generateId();
    const job: ScrapeJob = {
      id: jobId,
      sourceUrl: payload.sourceUrl,
      domain: payload.domain,
      status: 'running',
      jobType: 'single_page',
      priority: 0,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    };

    insertJob(job);
    this.running.set(jobId, job);

    try {
      await this.downloadPayloadMedia(payload, jobId);
      updateJobStatus(jobId, 'completed', {
        extractionData: JSON.stringify({
          imageCount: payload.images.length,
          videoCount: payload.videos.length,
          linkCount: payload.links.length,
        }),
      });
      job.status = 'completed';
    } catch (err) {
      updateJobStatus(jobId, 'failed', { errorMessage: String(err) });
      job.status = 'failed';
    } finally {
      this.running.delete(jobId);
    }

    this.jobUpdateCallback?.(job);
    return jobId;
  }

  /**
   * Queue a batch of URLs for scraping.
   */
  async queueBatch(urls: string[], parentJobId?: string): Promise<string[]> {
    return urls.map(url => {
      const jobId = generateId();
      const domain = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
      const job: ScrapeJob = {
        id: jobId,
        sourceUrl: url,
        domain,
        status: 'pending',
        jobType: 'single_page',
        priority: 0,
        parentJobId,
        createdAt: new Date().toISOString(),
      };
      insertJob(job);
      return jobId;
    });
  }

  /**
   * Queue download requests directly.
   */
  async queueDownloads(items: DownloadItem[]): Promise<void> {
    const jobId = generateId();
    const domain = (() => { try { return new URL(items[0]?.url ?? '').hostname; } catch { return 'direct'; } })();
    const job: ScrapeJob = {
      id: jobId,
      sourceUrl: items[0]?.url ?? '',
      domain,
      status: 'running',
      jobType: 'single_page',
      priority: 1,
      createdAt: new Date().toISOString(),
    };
    insertJob(job);

    const downloadPromises = items.map(item =>
      this.downloadManager.download(item, jobId).catch(err => {
        if (err.message !== 'DUPLICATE') {
          console.error(`[Queue] Failed to download ${item.url}: ${err.message}`);
        }
      })
    );

    await Promise.allSettled(downloadPromises);
    updateJobStatus(jobId, 'completed');
  }

  private async downloadPayloadMedia(payload: ExtractionPayload, jobId: string): Promise<void> {
    const downloads: DownloadItem[] = [];

    // Images
    payload.images
      .filter(img => !img.url.startsWith('data:'))
      .forEach(img => downloads.push({
        url: img.url,
        fileType: 'image',
        referer: payload.sourceUrl,
        metadata: { alt: img.alt, width: img.width, height: img.height },
      }));

    // Videos (direct/HLS/DASH)
    for (const vid of payload.videos) {
      if (vid.type === 'hls' || vid.type === 'dash') {
        // Use ffmpeg for stream download
        try {
          const outputDir = `${process.env.HOME ?? '.'}/Downloads/UniversalScraper/${payload.domain}/${new Date().toISOString().slice(0, 10)}/video`;
          const filename = `stream_${Date.now()}`;
          await this.ffmpegHandler.downloadStream(vid.url, outputDir, filename);
        } catch (err) {
          console.error(`[Queue] Stream download failed: ${err}`);
        }
      } else if (vid.type === 'direct') {
        downloads.push({
          url: vid.url,
          fileType: 'video',
          referer: payload.sourceUrl,
          mimeType: vid.mimeType,
        });
      }
    }

    // Audio
    payload.audio.forEach(audio => downloads.push({
      url: audio.url,
      fileType: 'audio',
      referer: payload.sourceUrl,
      mimeType: audio.mimeType,
    }));

    // Also check network captures for video streams
    payload.networkCaptures
      .filter(c => c.resourceType === 'video')
      .forEach(c => {
        if (!downloads.find(d => d.url === c.url)) {
          downloads.push({ url: c.url, fileType: 'video', referer: payload.sourceUrl });
        }
      });

    const batchSize = 10;
    for (let i = 0; i < downloads.length; i += batchSize) {
      const batch = downloads.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(item =>
          this.downloadManager.download(item, jobId)
            .catch(err => {
              if (err.message !== 'DUPLICATE') {
                console.error(`[Queue] Download failed: ${err.message}`);
              }
            })
        )
      );
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    if (this.running.size >= this.maxConcurrent) return;

    const pending = getPendingJobs();
    if (pending.length === 0) return;

    this.processing = true;
    try {
      const job = pending[0];
      updateJobStatus(job.id, 'running');
      job.status = 'running';
      this.running.set(job.id, job);
      this.jobUpdateCallback?.(job);

      // For batch jobs, we'd kick off the headless scraper here
      // For now, just mark as completed (headless scraper handles it)
      // This allows external actors (headless-scraper) to pick up jobs
    } finally {
      this.processing = false;
    }
  }

  cancelJob(jobId: string): void {
    updateJobStatus(jobId, 'cancelled');
    this.running.delete(jobId);
  }

  getActiveJobs(): ScrapeJob[] {
    return Array.from(this.running.values());
  }
}
