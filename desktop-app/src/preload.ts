import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './shared/types';

// Expose safe IPC API to renderer
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  setSettings: (settings: unknown) => ipcRenderer.invoke(IPC.SET_SETTINGS, settings),
  getStats: () => ipcRenderer.invoke(IPC.GET_STATS),
  getJobs: (opts?: unknown) => ipcRenderer.invoke(IPC.GET_JOBS, opts),
  createJob: (opts: unknown) => ipcRenderer.invoke(IPC.CREATE_JOB, opts),
  cancelJob: (jobId: string) => ipcRenderer.invoke(IPC.CANCEL_JOB, jobId),
  getFiles: (opts?: unknown) => ipcRenderer.invoke(IPC.GET_FILES, opts),
  deleteFile: (fileId: string) => ipcRenderer.invoke(IPC.DELETE_FILE, fileId),
  openFile: (filePath: string) => ipcRenderer.invoke(IPC.OPEN_FILE, filePath),
  openFolder: (filePath: string) => ipcRenderer.invoke(IPC.OPEN_FOLDER, filePath),
  getRules: () => ipcRenderer.invoke(IPC.GET_RULES),
  saveRule: (opts: unknown) => ipcRenderer.invoke(IPC.SAVE_RULE, opts),
  deleteRule: (id: string) => ipcRenderer.invoke(IPC.DELETE_RULE, id),
  selectDirectory: () => ipcRenderer.invoke(IPC.SELECT_DIRECTORY),
  getConnectionStatus: () => ipcRenderer.invoke(IPC.GET_CONNECTION_STATUS),

  // Event listeners
  onDownloadProgress: (cb: (data: unknown) => void) => {
    ipcRenderer.on(IPC.ON_DOWNLOAD_PROGRESS, (_e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners(IPC.ON_DOWNLOAD_PROGRESS);
  },
  onJobUpdate: (cb: (data: unknown) => void) => {
    ipcRenderer.on(IPC.ON_JOB_UPDATE, (_e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners(IPC.ON_JOB_UPDATE);
  },
  onConnectionStatus: (cb: (data: unknown) => void) => {
    ipcRenderer.on(IPC.ON_CONNECTION_STATUS, (_e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners(IPC.ON_CONNECTION_STATUS);
  },
});

// Type declaration for renderer
declare global {
  interface Window {
    api: {
      getSettings: () => Promise<import('./shared/types').AppSettings>;
      setSettings: (s: import('./shared/types').AppSettings) => Promise<{ success: boolean }>;
      getStats: () => Promise<import('./shared/types').DashboardStats>;
      getJobs: (opts?: { limit?: number; offset?: number }) => Promise<import('./shared/types').ScrapeJob[]>;
      createJob: (opts: { url: string; type: 'headless' | 'batch' }) => Promise<{ success: boolean; jobId?: string }>;
      cancelJob: (jobId: string) => Promise<{ success: boolean }>;
      getFiles: (opts?: { fileType?: string; search?: string; limit?: number; offset?: number }) => Promise<import('./shared/types').DownloadedFile[]>;
      deleteFile: (id: string) => Promise<{ success: boolean }>;
      openFile: (path: string) => Promise<void>;
      openFolder: (path: string) => Promise<void>;
      getRules: () => Promise<import('./shared/types').SiteRule[]>;
      saveRule: (opts: { domainPattern: string; config: import('./shared/types').SiteRuleConfig }) => Promise<import('./shared/types').SiteRule>;
      deleteRule: (id: string) => Promise<{ success: boolean }>;
      selectDirectory: () => Promise<string | null>;
      getConnectionStatus: () => Promise<{ wsConnected: boolean; clientCount: number; ffmpegAvailable: boolean }>;
      onDownloadProgress: (cb: (d: unknown) => void) => () => void;
      onJobUpdate: (cb: (d: unknown) => void) => () => void;
      onConnectionStatus: (cb: (d: unknown) => void) => () => void;
    };
  }
}
