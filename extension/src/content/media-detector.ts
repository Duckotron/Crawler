/**
 * Media detector — listens for dynamically-added media and blob URLs.
 * Works in conjunction with the background network interceptor.
 */

import type { ExtractedVideo, ExtractedAudio } from '../shared/types';
import { isHlsUrl, isDashUrl, detectVideoPlatform } from '../shared/utils';
import { resolveUrl } from '../shared/messaging';

const BASE_URL = location.href;

const detectedMedia: {
  videos: Map<string, ExtractedVideo>;
  audio: Map<string, ExtractedAudio>;
} = {
  videos: new Map(),
  audio: new Map(),
};

/**
 * Patch the native XHR and fetch to detect blob video URLs.
 * This runs at document_start and intercepts media requests before they happen.
 */
export function installMediaDetectorPatches(): void {
  try {
    // Override createElement to catch dynamically created video/audio elements
    const origCreateElement = document.createElement.bind(document);
    // @ts-ignore — we need to patch this
    document.createElement = function (tag: string, ...args: unknown[]) {
      const el = origCreateElement(tag, ...(args as [ElementCreationOptions?]));
      if (tag.toLowerCase() === 'video' || tag.toLowerCase() === 'audio') {
        observeMediaElement(el as HTMLMediaElement);
      }
      return el;
    };
  } catch {}

  // Intercept fetch calls to detect HLS/DASH manifest fetches
  try {
    const origFetch = window.fetch.bind(window);
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      checkUrlForMedia(url);
      return origFetch(input, init);
    };
  } catch {}

  // Intercept XMLHttpRequest
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: unknown[]) {
      checkUrlForMedia(url);
      return origOpen.call(this, method, url, ...(rest as [boolean?, string?, string?]));
    };
  } catch {}
}

function checkUrlForMedia(url: string): void {
  if (!url) return;
  const absUrl = resolveUrl(url, BASE_URL);
  if (isHlsUrl(absUrl)) {
    detectedMedia.videos.set(absUrl, {
      url: absUrl,
      type: 'hls',
    });
    notifyBackground({ type: 'media_detected', url: absUrl, mediaType: 'hls' });
  } else if (isDashUrl(absUrl)) {
    detectedMedia.videos.set(absUrl, {
      url: absUrl,
      type: 'dash',
    });
    notifyBackground({ type: 'media_detected', url: absUrl, mediaType: 'dash' });
  }
}

function observeMediaElement(el: HTMLMediaElement): void {
  const observer = new MutationObserver(() => {
    const src = el.src ?? el.getAttribute('src') ?? '';
    if (src && !detectedMedia.videos.has(src) && !detectedMedia.audio.has(src)) {
      const absUrl = resolveUrl(src, BASE_URL);
      const platform = detectVideoPlatform(absUrl);
      if (el.tagName.toLowerCase() === 'video') {
        detectedMedia.videos.set(absUrl, {
          url: absUrl,
          type: isHlsUrl(absUrl) ? 'hls' : isDashUrl(absUrl) ? 'dash' : 'direct',
          platform,
        });
      } else {
        detectedMedia.audio.set(absUrl, { url: absUrl });
      }
    }
  });
  observer.observe(el, { attributes: true, attributeFilter: ['src'] });
}

function notifyBackground(data: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage({ type: 'MEDIA_DETECTED_IN_PAGE', ...data });
  } catch {}
}

export function getDetectedMedia() {
  return {
    videos: Array.from(detectedMedia.videos.values()),
    audio: Array.from(detectedMedia.audio.values()),
  };
}

export function clearDetectedMedia(): void {
  detectedMedia.videos.clear();
  detectedMedia.audio.clear();
}
