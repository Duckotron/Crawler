// Re-export all extension types (shared between extension and desktop)
export type {
  ExtractedImage,
  ExtractedVideo,
  ExtractedAudio,
  ExtractedLink,
  ExtractedText,
  PageMetadata,
  NetworkCapture,
  ExtractionPayload,
  DownloadItem,
  StreamMeta,
  AppMessage,
  AppMessageChunk,
  ExtractionOptions,
} from './extension-types';

export {
  DEFAULT_EXTRACTION_OPTIONS,
} from './extension-types';

// ─── Desktop-specific types ───────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
export type JobType = 'single_page' | 'batch' | 'scheduled' | 'recursive_crawl';
export type FileType = 'image' | 'video' | 'audio' | 'document' | 'other';

export interface ScrapeJob {
  id: string;
  sourceUrl: string;
  domain: string;
  status: JobStatus;
  jobType: JobType;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  extractionData?: string; // JSON
  errorMessage?: string;
  priority: number;
  parentJobId?: string;
  crawlDepth?: number;
  maxDepth?: number;
}

export interface DownloadedFile {
  id: string;
  jobId: string;
  sourceUrl: string;
  localPath: string;
  fileType: FileType;
  mimeType?: string;
  fileSize?: number;
  contentHash?: string;
  width?: number;
  height?: number;
  duration?: number;
  downloadedAt: string;
  metadata?: string; // JSON
  thumbnailPath?: string;
}

export interface SiteRule {
  id: string;
  domainPattern: string;
  ruleConfig: SiteRuleConfig;
  createdAt: string;
  updatedAt: string;
}

export interface SiteRuleConfig {
  selectors?: {
    content?: string;
    images?: string;
    nextPage?: string;
    loadMore?: string;
    removeElements?: string[];
  };
  behavior?: {
    autoScroll?: boolean;
    maxScrolls?: number;
    waitForSelector?: string;
    clickBeforeExtract?: string[];
    delayBetweenActions?: number;
    requiresAuth?: boolean;
  };
  extraction?: {
    customScript?: string;
    videoUrlPattern?: string; // RegExp as string
    apiEndpoint?: string;
  };
}

export interface DownloadProgress {
  fileId: string;
  url: string;
  bytesDownloaded: number;
  totalBytes?: number;
  speed?: number; // bytes/sec
  eta?: number; // seconds
  percentage?: number;
}

export interface AppSettings {
  outputDir: string;
  downloadConcurrency: number;
  downloadRetries: number;
  rateLimit: number; // ms between requests per domain
  ffmpegPath: string;
  wsPort: number;
  proxyUrl?: string;
  proxyList: ProxyEntry[];
  darkMode: boolean;
  autoStart: boolean;
  keepDuplicates: boolean;
  stripExif: boolean;
  generateThumbnails: boolean;
  ocrEnabled: boolean;
  playwrightHeadless: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  outputDir: '',
  downloadConcurrency: 4,
  downloadRetries: 3,
  rateLimit: 500,
  ffmpegPath: '',
  wsPort: 8789,
  darkMode: false,
  autoStart: true,
  keepDuplicates: false,
  stripExif: false,
  generateThumbnails: true,
  ocrEnabled: false,
  playwrightHeadless: true,
  proxyList: [],
};

export interface ProxyEntry {
  id: string;
  url: string; // http://user:pass@host:port
  protocol: 'http' | 'https' | 'socks5';
  active: boolean;
  healthy?: boolean;
  lastChecked?: string;
  successCount: number;
  failCount: number;
}

export interface DashboardStats {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalFiles: number;
  totalStorageBytes: number;
  imagesCount: number;
  videosCount: number;
  audioCount: number;
}

// IPC channel names
export const IPC = {
  GET_SETTINGS: 'get-settings',
  SET_SETTINGS: 'set-settings',
  GET_STATS: 'get-stats',
  GET_JOBS: 'get-jobs',
  CREATE_JOB: 'create-job',
  CANCEL_JOB: 'cancel-job',
  RETRY_JOB: 'retry-job',
  GET_FILES: 'get-files',
  DELETE_FILE: 'delete-file',
  OPEN_FILE: 'open-file',
  OPEN_FOLDER: 'open-folder',
  GET_RULES: 'get-rules',
  SAVE_RULE: 'save-rule',
  DELETE_RULE: 'delete-rule',
  SELECT_DIRECTORY: 'select-directory',
  GET_CONNECTION_STATUS: 'get-connection-status',
  ON_DOWNLOAD_PROGRESS: 'on-download-progress',
  ON_JOB_UPDATE: 'on-job-update',
  ON_CONNECTION_STATUS: 'on-connection-status',
} as const;
