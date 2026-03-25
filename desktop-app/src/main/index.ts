import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import type { AppSettings, SiteRuleConfig, AppMessage } from '../shared/types';
import { DEFAULT_APP_SETTINGS, IPC } from '../shared/types';
import { initDatabase, getStats, getJobs, getFiles, getRules, getJob, deleteFile, getSetting, setSetting } from './database';
import { WebSocketBridge } from './websocket-server';
import { DownloadManager } from './download-manager';
import { FfmpegHandler } from './ffmpeg-handler';
import { JobQueue } from './job-queue';
import { RuleEngine } from './rule-engine';
import { ProxyManager } from './proxy-manager';
import { PostProcessor } from './post-processor';
import { HeadlessScraper } from './headless-scraper';
import { startNativeMessagingHost } from './native-messaging-host';
import { generateId } from './utils';

// ─── Is this running as a native messaging host? ──────────────────────────────
const isNativeMessagingHost = process.argv.includes('--native-messaging');

let mainWindow: BrowserWindow | null = null;
let settings: AppSettings = DEFAULT_APP_SETTINGS;
let wsBridge: WebSocketBridge | null = null;
let downloadManager: DownloadManager;
let ffmpegHandler: FfmpegHandler;
let jobQueue: JobQueue;
let ruleEngine: RuleEngine;
let proxyManager: ProxyManager;
let postProcessor: PostProcessor;
let headlessScraper: HeadlessScraper | null = null;

// ─── App startup ──────────────────────────────────────────────────────────────

function loadSettings(): AppSettings {
  try {
    const stored = getSetting<AppSettings>('app_settings', DEFAULT_APP_SETTINGS);
    return { ...DEFAULT_APP_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

function initServices() {
  settings = loadSettings();

  downloadManager = new DownloadManager(settings, (progress) => {
    mainWindow?.webContents.send(IPC.ON_DOWNLOAD_PROGRESS, progress);
  });

  ffmpegHandler = new FfmpegHandler(settings);
  ruleEngine = new RuleEngine();
  ruleEngine.seedBuiltInRules();
  proxyManager = new ProxyManager();
  proxyManager.setProxies(settings.proxyList ?? []);

  jobQueue = new JobQueue(settings, downloadManager, ffmpegHandler, (job) => {
    mainWindow?.webContents.send(IPC.ON_JOB_UPDATE, job);
  });
  jobQueue.start();

  postProcessor = new PostProcessor(settings, ffmpegHandler);

  // Start WebSocket server
  wsBridge = new WebSocketBridge(
    settings.wsPort,
    handleAppMessage,
    (connected, count) => {
      console.log(`[WS] ${connected ? 'Client connected' : 'Client disconnected'} (${count} active)`);
      mainWindow?.webContents.send(IPC.ON_CONNECTION_STATUS, { connected, clientCount: count });
    }
  );
  wsBridge.start();
}

async function handleAppMessage(msg: AppMessage): Promise<void> {
  switch (msg.type) {
    case 'extraction_result':
      await jobQueue.processExtraction(msg.data);
      mainWindow?.webContents.send(IPC.ON_JOB_UPDATE, {
        type: 'new_extraction',
        sourceUrl: msg.data.sourceUrl,
        imageCount: msg.data.images.length,
        videoCount: msg.data.videos.length,
      });
      break;

    case 'download_request':
      await jobQueue.queueDownloads(msg.urls);
      break;

    case 'batch_job':
      await jobQueue.queueBatch(msg.urls);
      break;

    case 'stream_capture':
      // Download HLS/DASH stream via ffmpeg
      if (ffmpegHandler.isAvailable()) {
        const domain = (() => { try { return new URL(msg.metadata.pageUrl).hostname; } catch { return 'stream'; } })();
        const outputDir = join(settings.outputDir || `${process.env.HOME}/Downloads/UniversalScraper`, domain, 'video');
        const filename = msg.metadata.title ?? `stream_${Date.now()}`;
        ffmpegHandler.downloadStream(msg.streamUrl, outputDir, filename, (pct) => {
          mainWindow?.webContents.send(IPC.ON_DOWNLOAD_PROGRESS, { url: msg.streamUrl, percentage: pct });
        }).catch(err => console.error('[Stream]', err));
      }
      break;

    case 'status_check':
      // Handled by WS server (ping/pong)
      break;
  }
}

// ─── Native messaging mode ────────────────────────────────────────────────────

if (isNativeMessagingHost) {
  // Running headlessly as native messaging host
  initDatabase();
  initServices();
  startNativeMessagingHost(handleAppMessage);
} else {
  // Running as Electron GUI app
  app.on('ready', async () => {
    initDatabase();
    initServices();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });

  app.on('before-quit', () => {
    jobQueue.stop();
    wsBridge?.stop();
    headlessScraper?.close().catch(() => {});
  });
}

// ─── Window creation ──────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload.js'),
    },
    titleBarStyle: 'default',
    title: 'Universal Web Scraper',
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle(IPC.GET_SETTINGS, () => settings);

ipcMain.handle(IPC.SET_SETTINGS, (_event, newSettings: AppSettings) => {
  settings = { ...DEFAULT_APP_SETTINGS, ...newSettings };
  setSetting('app_settings', settings);
  downloadManager.updateSettings(settings);
  ffmpegHandler.updateSettings(settings);
  proxyManager.setProxies(settings.proxyList ?? []);
  // Restart WS server if port changed
  const currentPort = wsBridge ? settings.wsPort : -1;
  if (currentPort !== settings.wsPort) {
    wsBridge?.stop();
    wsBridge = new WebSocketBridge(settings.wsPort, handleAppMessage, () => {});
    wsBridge.start();
  }
  return { success: true };
});

ipcMain.handle(IPC.GET_STATS, () => getStats());

ipcMain.handle(IPC.GET_JOBS, (_event, opts: { limit?: number; offset?: number } = {}) =>
  getJobs(opts.limit, opts.offset)
);

ipcMain.handle(IPC.CREATE_JOB, async (_event, { url, type }: { url: string; type: 'headless' | 'batch' }) => {
  if (type === 'headless') {
    if (!headlessScraper) headlessScraper = new HeadlessScraper(settings, ruleEngine);
    try {
      const payload = await headlessScraper.scrape(url);
      const jobId = await jobQueue.processExtraction(payload);
      return { success: true, jobId };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  } else {
    const jobIds = await jobQueue.queueBatch([url]);
    return { success: true, jobId: jobIds[0] };
  }
});

ipcMain.handle(IPC.CANCEL_JOB, (_event, jobId: string) => {
  jobQueue.cancelJob(jobId);
  return { success: true };
});

ipcMain.handle(IPC.GET_FILES, (_event, opts: { fileType?: string; search?: string; limit?: number; offset?: number } = {}) =>
  getFiles(opts)
);

ipcMain.handle(IPC.DELETE_FILE, (_event, fileId: string) => {
  deleteFile(fileId);
  return { success: true };
});

ipcMain.handle(IPC.OPEN_FILE, (_event, filePath: string) => {
  shell.openPath(filePath);
});

ipcMain.handle(IPC.OPEN_FOLDER, (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle(IPC.GET_RULES, () => getRules());

ipcMain.handle(IPC.SAVE_RULE, (_event, { domainPattern, config }: { domainPattern: string; config: SiteRuleConfig }) => {
  const rule = ruleEngine.saveRule(domainPattern, config);
  return rule;
});

ipcMain.handle(IPC.DELETE_RULE, (_event, id: string) => {
  ruleEngine.removeRule(id);
  return { success: true };
});

ipcMain.handle(IPC.SELECT_DIRECTORY, async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select output directory',
  });
  if (!result.canceled && result.filePaths[0]) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle(IPC.GET_CONNECTION_STATUS, () => ({
  wsConnected: (wsBridge?.getClientCount() ?? 0) > 0,
  clientCount: wsBridge?.getClientCount() ?? 0,
  ffmpegAvailable: ffmpegHandler.isAvailable(),
}));
