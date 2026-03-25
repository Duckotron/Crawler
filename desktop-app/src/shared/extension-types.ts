// Shared types mirrored from extension/src/shared/types.ts
// These are kept in sync between the extension and desktop app.

export interface ExtractedImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
  srcset?: string[];
  context: string;
  sourceType: 'img' | 'css-bg' | 'canvas' | 'og' | 'srcset' | 'picture';
}

export interface ExtractedVideo {
  url: string;
  type: 'direct' | 'hls' | 'dash' | 'embed' | 'blob';
  mimeType?: string;
  quality?: string;
  duration?: number;
  platform?: string;
  thumbnailUrl?: string;
  posterUrl?: string;
}

export interface ExtractedAudio {
  url: string;
  mimeType?: string;
  duration?: number;
  title?: string;
}

export interface ExtractedLink {
  url: string;
  text: string;
  rel?: string;
  classification: 'internal' | 'external' | 'download' | 'anchor' | 'mailto' | 'tel' | 'other';
}

export interface ExtractedText {
  html: string;
  markdown: string;
  plainText: string;
  title: string;
  headings: { level: number; text: string }[];
  wordCount: number;
  readingTimeMin: number;
}

export interface PageMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  ogTags: Record<string, string>;
  twitterTags: Record<string, string>;
  jsonLd: object[];
  microdata: object[];
  language: string;
  author?: string;
  publishedDate?: string;
  keywords?: string[];
}

export interface NetworkCapture {
  url: string;
  mimeType: string;
  resourceType: 'video' | 'audio' | 'image' | 'json' | 'other';
  timestamp: number;
  requestHeaders?: Record<string, string>;
}

export interface ExtractionPayload {
  sourceUrl: string;
  timestamp: string;
  domain: string;
  images: ExtractedImage[];
  videos: ExtractedVideo[];
  audio: ExtractedAudio[];
  links: ExtractedLink[];
  text: ExtractedText;
  metadata: PageMetadata;
  networkCaptures: NetworkCapture[];
}

export interface DownloadItem {
  url: string;
  filename?: string;
  referer?: string;
  cookies?: string;
  mimeType?: string;
  fileType: 'image' | 'video' | 'audio' | 'document' | 'other';
  metadata?: Record<string, unknown>;
}

export interface StreamMeta {
  pageUrl: string;
  platform?: string;
  title?: string;
  thumbnailUrl?: string;
  duration?: number;
  qualities?: string[];
}

export type AppMessage =
  | { type: 'extraction_result'; data: ExtractionPayload }
  | { type: 'download_request'; urls: DownloadItem[] }
  | { type: 'stream_capture'; streamUrl: string; metadata: StreamMeta }
  | { type: 'status_check' }
  | { type: 'batch_job'; urls: string[] }
  | { type: 'ping' }
  | { type: 'pong'; version: string };

export interface AppMessageChunk {
  type: 'chunk';
  id: string;
  index: number;
  total: number;
  data: string;
}

export interface ExtractionOptions {
  extractImages: boolean;
  extractVideos: boolean;
  extractAudio: boolean;
  extractLinks: boolean;
  extractText: boolean;
  extractMetadata: boolean;
  minImageWidth: number;
  minImageHeight: number;
  autoScroll: boolean;
  maxScrolls: number;
  scrollDelay: number;
  clickLoadMore: boolean;
  waitForIdle: boolean;
  idleTimeout: number;
  includeInternalLinks: boolean;
  includeExternalLinks: boolean;
}

export const DEFAULT_EXTRACTION_OPTIONS: ExtractionOptions = {
  extractImages: true,
  extractVideos: true,
  extractAudio: true,
  extractLinks: true,
  extractText: true,
  extractMetadata: true,
  minImageWidth: 50,
  minImageHeight: 50,
  autoScroll: false,
  maxScrolls: 20,
  scrollDelay: 800,
  clickLoadMore: false,
  waitForIdle: true,
  idleTimeout: 1500,
  includeInternalLinks: true,
  includeExternalLinks: true,
};
