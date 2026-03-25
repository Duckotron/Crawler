/**
 * Background service worker.
 * Handles: tab management, network interception, communication bridge.
 */

import type {
  ExtensionMessage,
  NetworkCapture,
  ExtractionPayload,
  ExtensionSettings,
} from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { generateId } from '../shared/messaging';
import { isHlsUrl, isDashUrl } from '../shared/utils';
import { AppBridge } from '../native-messaging/bridge';

// ─── State ────────────────────────────────────────────────────────────────────

// Per-tab network captures: tabId → captures[]
const networkCaptures = new Map<number, NetworkCapture[]>();
// Per-tab extraction payloads
const tabPayloads = new Map<number, ExtractionPayload>();
// Per-tab extraction progress listeners
const progressListeners = new Map<number, string[]>();

let settings: ExtensionSettings = DEFAULT_SETTINGS;
let bridge: AppBridge | null = null;

// ─── Load settings ────────────────────────────────────────────────────────────

async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  initBridge();
}

function initBridge() {
  bridge?.destroy();
  bridge = new AppBridge(settings, (msg) => {
    // Forward status from app to all popups
    chrome.runtime.sendMessage({ type: 'APP_STATUS', ...msg }).catch(() => {});
  });
  bridge.connect();
}

loadSettings();

// ─── Network Interception via webRequest ──────────────────────────────────────

const VIDEO_MIME_PREFIXES = ['video/', 'audio/'];
const STREAM_URL_PATTERNS = ['.m3u8', '.mpd', '.ts?', 'manifest', 'playlist'];
const MEDIA_EXTENSIONS = /\.(mp4|webm|mkv|mp3|ogg|aac|flac|m3u8|mpd|ts|wav|opus)(\?|$)/i;

chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    const { tabId, url, responseHeaders, type } = details;
    if (tabId < 0) return;

    const contentType = responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value ?? '';

    const isMedia =
      VIDEO_MIME_PREFIXES.some(p => contentType.startsWith(p)) ||
      MEDIA_EXTENSIONS.test(url) ||
      STREAM_URL_PATTERNS.some(p => url.includes(p)) ||
      isHlsUrl(url) ||
      isDashUrl(url);

    if (!isMedia && type !== 'xmlhttprequest' && type !== 'fetch') return;

    let resourceType: NetworkCapture['resourceType'] = 'other';
    if (contentType.startsWith('video/') || isHlsUrl(url) || isDashUrl(url)) {
      resourceType = 'video';
    } else if (contentType.startsWith('audio/')) {
      resourceType = 'audio';
    } else if (contentType.startsWith('image/')) {
      resourceType = 'image';
    } else if (contentType.includes('json')) {
      resourceType = 'json';
    }

    const capture: NetworkCapture = {
      url,
      mimeType: contentType,
      resourceType,
      timestamp: Date.now(),
    };

    const captures = networkCaptures.get(tabId) ?? [];
    captures.push(capture);
    networkCaptures.set(tabId, captures);

    // Forward to popup if listening
    chrome.runtime.sendMessage({
      type: 'NETWORK_CAPTURE',
      tabId,
      capture,
    }).catch(() => {});
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? message.tabId ?? -1;

  switch (message.type) {
    case 'EXTRACT_PAGE': {
      // Forward to the tab's content script
      const targetTabId = message.tabId ?? tabId;
      chrome.tabs.sendMessage(targetTabId, message)
        .then(response => {
          if (response?.payload) {
            // Attach network captures to payload
            const captures = networkCaptures.get(targetTabId) ?? [];
            response.payload.networkCaptures = captures;
            tabPayloads.set(targetTabId, response.payload);
            sendResponse(response);
          } else {
            sendResponse(response);
          }
        })
        .catch(err => sendResponse({ error: String(err) }));
      return true;
    }

    case 'EXTRACTION_PROGRESS': {
      // Broadcast to popup
      chrome.runtime.sendMessage({ ...message, tabId }).catch(() => {});
      break;
    }

    case 'EXTRACTION_RESULT': {
      const payload = message.payload;
      // Attach network captures
      const captures = networkCaptures.get(tabId) ?? [];
      payload.networkCaptures = [...payload.networkCaptures, ...captures];
      tabPayloads.set(tabId, payload);
      chrome.runtime.sendMessage({ ...message, tabId }).catch(() => {});
      break;
    }

    case 'SEND_TO_APP': {
      const payload = message.payload;
      bridge?.send({
        type: 'extraction_result',
        data: payload,
      });
      sendResponse({ sent: true });
      break;
    }

    case 'GET_STATUS': {
      sendResponse({
        type: 'STATUS_RESPONSE',
        connected: bridge?.isConnected() ?? false,
        appVersion: bridge?.getAppVersion(),
      });
      break;
    }

    case 'PING': {
      sendResponse({ type: 'PONG' });
      break;
    }

    case 'MEDIA_DETECTED_IN_PAGE' as string: {
      // Re-cast to handle custom message type
      const mediaMsg = message as unknown as { url: string; mediaType: string; tabId?: number };
      const tid = tabId;
      const capture: NetworkCapture = {
        url: mediaMsg.url,
        mimeType: mediaMsg.mediaType === 'hls' ? 'application/x-mpegurl' : 'application/dash+xml',
        resourceType: 'video',
        timestamp: Date.now(),
      };
      const captures = networkCaptures.get(tid) ?? [];
      captures.push(capture);
      networkCaptures.set(tid, captures);
      break;
    }
  }
});

// ─── Tab Lifecycle ─────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  networkCaptures.delete(tabId);
  tabPayloads.delete(tabId);
  progressListeners.delete(tabId);
});

// Clear network captures when navigating to a new page
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    networkCaptures.delete(details.tabId);
    tabPayloads.delete(details.tabId);
  }
});

// ─── Context Menu ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'scrape-page',
    title: 'Scrape this page',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'scrape-image',
    title: 'Download this image',
    contexts: ['image'],
  });
  chrome.contextMenus.create({
    id: 'scrape-link',
    title: 'Scrape linked page',
    contexts: ['link'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  switch (info.menuItemId) {
    case 'scrape-page':
      chrome.action.openPopup().catch(() => {});
      break;
    case 'scrape-image':
      if (info.srcUrl) {
        bridge?.send({ type: 'download_request', urls: [{
          url: info.srcUrl,
          fileType: 'image',
          referer: tab.url ?? '',
        }]});
      }
      break;
    case 'scrape-link':
      if (info.linkUrl) {
        bridge?.send({ type: 'batch_job', urls: [info.linkUrl] });
      }
      break;
  }
});

// ─── Settings Sync ────────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    initBridge();
  }
});

// Export for use by other background modules (type-only, not runtime)
export type { settings };
