/**
 * Content script entry point.
 * Injected into every page at document_start.
 */

import type {
  ExtractionPayload,
  ExtractionOptions,
  ExtractionProgress,
  ExtractedImage,
  ExtractedVideo,
  ExtractedAudio,
  ExtractedLink,
} from '../shared/types';
import { DEFAULT_EXTRACTION_OPTIONS } from '../shared/types';
import { extractImages, extractVideos, extractAudio, extractLinks, extractText, extractMetadata } from './extractor';
import { installMediaDetectorPatches, getDetectedMedia } from './media-detector';
import { MutationWatcher } from './mutation-watcher';
import { autoScroll, cancelScroll, clickLoadMore, expandCollapsedSections, waitForMutationIdle } from './interaction';
import { extractDomain } from '../shared/messaging';

// ─── Anti-Detection: Override webdriver flag ──────────────────────────────────
try {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
} catch {}

// Install early media URL patches
installMediaDetectorPatches();

// State
let isExtracting = false;
let mutationWatcher: MutationWatcher | null = null;
const accumulatedImages: Map<string, ExtractedImage> = new Map();
const accumulatedVideos: Map<string, ExtractedVideo> = new Map();
const accumulatedLinks: Map<string, ExtractedLink> = new Map();
const accumulatedAudio: Map<string, ExtractedAudio> = new Map();

function sendProgress(progress: ExtractionProgress) {
  chrome.runtime.sendMessage({
    type: 'EXTRACTION_PROGRESS',
    tabId: -1, // background will fill this in
    progress,
  }).catch(() => {});
}

async function runExtraction(options: ExtractionOptions): Promise<ExtractionPayload> {
  const baseUrl = location.href;
  const domain = extractDomain(baseUrl);

  sendProgress({ phase: 'dom', itemsFound: 0, message: 'Starting extraction...', percentage: 5 });

  // Wait for idle if requested
  if (options.waitForIdle) {
    await waitForMutationIdle(options.idleTimeout);
  }

  // Start mutation watcher for dynamic content
  if (!mutationWatcher) {
    mutationWatcher = new MutationWatcher(result => {
      result.images.forEach(img => accumulatedImages.set(img.url, img));
      result.videos.forEach(v => accumulatedVideos.set(v.url, v));
      result.links.forEach(l => accumulatedLinks.set(l.url, l));
    }, options.minImageWidth, options.minImageHeight);
    mutationWatcher.start();
  }

  // Auto-scroll
  if (options.autoScroll) {
    sendProgress({ phase: 'scroll', itemsFound: 0, message: 'Auto-scrolling...', percentage: 10 });
    let scrollCount = 0;
    await autoScroll({
      maxScrolls: options.maxScrolls,
      scrollDelay: options.scrollDelay,
      onProgress: (count, newContent) => {
        scrollCount = count;
        sendProgress({
          phase: 'scroll',
          itemsFound: scrollCount,
          message: `Scroll ${count}/${options.maxScrolls}${newContent ? ' — new content found' : ''}`,
          percentage: 10 + Math.round((count / options.maxScrolls) * 20),
        });
      },
    });

    // Click load-more buttons
    if (options.clickLoadMore) {
      await clickLoadMore();
      await expandCollapsedSections();
      await waitForMutationIdle(1000);
    }
  }

  sendProgress({ phase: 'images', itemsFound: 0, message: 'Extracting images...', percentage: 35 });

  // Extract images
  if (options.extractImages) {
    const imgs = extractImages(document, options.minImageWidth, options.minImageHeight);
    imgs.forEach(img => accumulatedImages.set(img.url, img));
  }

  sendProgress({
    phase: 'images',
    itemsFound: accumulatedImages.size,
    message: `Found ${accumulatedImages.size} images`,
    percentage: 50,
  });

  // Extract videos
  if (options.extractVideos) {
    const vids = extractVideos(document);
    vids.forEach(v => accumulatedVideos.set(v.url, v));
    const detected = getDetectedMedia();
    detected.videos.forEach(v => accumulatedVideos.set(v.url, v));
    detected.audio.forEach(a => accumulatedAudio.set(a.url, a));
  }

  // Extract audio
  if (options.extractAudio) {
    const audios = extractAudio(document);
    audios.forEach(a => accumulatedAudio.set(a.url, a));
  }

  sendProgress({
    phase: 'videos',
    itemsFound: accumulatedVideos.size,
    message: `Found ${accumulatedVideos.size} videos`,
    percentage: 65,
  });

  // Extract links
  if (options.extractLinks) {
    const links = extractLinks(document);
    links
      .filter(l => {
        if (l.classification === 'internal') return options.includeInternalLinks;
        if (l.classification === 'external') return options.includeExternalLinks;
        return true;
      })
      .forEach(l => accumulatedLinks.set(l.url, l));
  }

  sendProgress({ phase: 'links', itemsFound: accumulatedLinks.size, message: 'Extracting text...', percentage: 75 });

  // Extract text
  const text = options.extractText ? extractText() : {
    html: '', markdown: '', plainText: '', title: document.title, headings: [], wordCount: 0, readingTimeMin: 0,
  };

  // Extract metadata
  const metadata = options.extractMetadata ? extractMetadata() : {
    title: document.title, description: '', canonicalUrl: baseUrl, ogTags: {}, twitterTags: {},
    jsonLd: [], microdata: [], language: '', keywords: [],
  };

  sendProgress({ phase: 'complete', itemsFound: accumulatedImages.size, message: 'Complete!', percentage: 100 });

  const payload: ExtractionPayload = {
    sourceUrl: baseUrl,
    timestamp: new Date().toISOString(),
    domain,
    images: Array.from(accumulatedImages.values()),
    videos: Array.from(accumulatedVideos.values()),
    audio: Array.from(accumulatedAudio.values()),
    links: Array.from(accumulatedLinks.values()),
    text,
    metadata,
    networkCaptures: [],
  };

  return payload;
}

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE') {
    if (isExtracting) {
      sendResponse({ error: 'Extraction already in progress' });
      return true;
    }

    isExtracting = true;
    // Reset accumulated data
    accumulatedImages.clear();
    accumulatedVideos.clear();
    accumulatedLinks.clear();
    accumulatedAudio.clear();

    const options: ExtractionOptions = {
      ...DEFAULT_EXTRACTION_OPTIONS,
      ...(message.options ?? {}),
    };

    runExtraction(options)
      .then(payload => {
        isExtracting = false;
        sendResponse({ success: true, payload });
      })
      .catch(err => {
        isExtracting = false;
        sendResponse({ error: String(err) });
      });

    return true; // Keep message channel open for async response
  }

  if (message.type === 'STOP_SCROLL') {
    cancelScroll();
    sendResponse({ stopped: true });
  }

  if (message.type === 'PING') {
    sendResponse({ type: 'PONG', url: location.href });
  }
});
