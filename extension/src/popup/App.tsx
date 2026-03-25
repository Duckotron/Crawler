import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ExtractionOptions,
  ExtractionProgress,
  ExtractionPayload,
  ExtractedImage,
  ExtractedVideo,
} from '../shared/types';
import { DEFAULT_EXTRACTION_OPTIONS } from '../shared/types';
import { getActiveTab } from '../shared/messaging';
import './popup.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type AppState = 'idle' | 'extracting' | 'done' | 'error';

// ─── Components ───────────────────────────────────────────────────────────────

function StatusIndicator({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}
        style={{ display: 'inline-block' }}
      />
      <span className={connected ? 'text-green-600' : 'text-gray-400'}>
        {connected ? 'App connected' : 'App offline'}
      </span>
    </div>
  );
}

function ProgressBar({ progress }: { progress: ExtractionProgress }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{progress.message}</span>
        <span>{progress.percentage}%</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-300 rounded-full"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>
    </div>
  );
}

function ImagePreview({ img }: { img: ExtractedImage }) {
  const [error, setError] = useState(false);
  return (
    <div className="flex items-center gap-2 p-1.5 bg-gray-50 rounded text-xs hover:bg-gray-100">
      {!error && !img.url.startsWith('data:') ? (
        <img
          src={img.url}
          alt={img.alt}
          onError={() => setError(true)}
          className="w-8 h-8 object-cover rounded flex-shrink-0 bg-gray-200"
        />
      ) : (
        <div className="w-8 h-8 bg-gray-200 rounded flex-shrink-0 flex items-center justify-center text-gray-400 text-[10px]">
          IMG
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-gray-700">{img.url.split('/').pop()?.slice(0, 40)}</div>
        {img.width && img.height && (
          <div className="text-gray-400">{img.width}×{img.height}</div>
        )}
      </div>
    </div>
  );
}

function VideoItem({ vid }: { vid: ExtractedVideo }) {
  return (
    <div className="flex items-center gap-2 p-1.5 bg-gray-50 rounded text-xs hover:bg-gray-100">
      <div className="w-8 h-8 bg-gray-700 rounded flex-shrink-0 flex items-center justify-center text-white text-[10px]">
        {vid.type === 'hls' ? 'HLS' : vid.type === 'dash' ? 'MPD' : vid.platform?.slice(0, 3).toUpperCase() ?? 'VID'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-gray-700">{vid.url.slice(0, 50)}</div>
        <div className="text-gray-400">{vid.type}{vid.platform ? ` · ${vid.platform}` : ''}</div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [appConnected, setAppConnected] = useState(false);
  const [state, setState] = useState<AppState>('idle');
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [payload, setPayload] = useState<ExtractionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [options, setOptions] = useState<ExtractionOptions>({ ...DEFAULT_EXTRACTION_OPTIONS });
  const [previewTab, setPreviewTab] = useState<'images' | 'videos' | 'links'>('images');

  // Check connection to app
  useEffect(() => {
    const check = () => {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' })
        .then((resp: { connected: boolean }) => setAppConnected(resp?.connected ?? false))
        .catch(() => setAppConnected(false));
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, []);

  // Get active tab
  useEffect(() => {
    getActiveTab().then(tab => setActiveTab(tab));
  }, []);

  // Listen for progress messages
  useEffect(() => {
    const handler = (message: { type: string; progress?: ExtractionProgress; payload?: ExtractionPayload; error?: string }) => {
      if (message.type === 'EXTRACTION_PROGRESS' && message.progress) {
        setProgress(message.progress);
      }
      if (message.type === 'EXTRACTION_RESULT' && message.payload) {
        setPayload(message.payload);
        setState('done');
        setProgress(null);
      }
      if (message.type === 'EXTRACTION_ERROR' && message.error) {
        setError(message.error);
        setState('error');
        setProgress(null);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const handleExtract = useCallback(async () => {
    if (!activeTab?.id) return;
    setState('extracting');
    setError(null);
    setPayload(null);
    setProgress({ phase: 'dom', itemsFound: 0, message: 'Starting...', percentage: 0 });

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXTRACT_PAGE',
        tabId: activeTab.id,
        options,
      }) as { success?: boolean; payload?: ExtractionPayload; error?: string };

      if (response?.error) {
        setError(response.error);
        setState('error');
      } else if (response?.payload) {
        setPayload(response.payload);
        setState('done');
      }
    } catch (err) {
      setError(String(err));
      setState('error');
    } finally {
      setProgress(null);
    }
  }, [activeTab, options]);

  const handleSendToApp = useCallback(async () => {
    if (!payload) return;
    await chrome.runtime.sendMessage({ type: 'SEND_TO_APP', payload });
  }, [payload]);

  const domain = activeTab?.url ? new URL(activeTab.url).hostname : '';

  return (
    <div className="flex flex-col h-full bg-white text-gray-900 font-sans text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white">
        <div>
          <div className="font-semibold text-base">Universal Scraper</div>
          <div className="text-blue-200 text-xs truncate max-w-[220px]">{domain}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusIndicator connected={appConnected} />
          <button
            onClick={() => chrome.runtime.openOptionsPage()}
            className="p-1.5 rounded hover:bg-blue-500 text-blue-100"
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Options */}
      <div className="px-4 py-3 border-b border-gray-100 space-y-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Extract</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            ['extractImages', '🖼 Images'],
            ['extractVideos', '🎬 Videos & Audio'],
            ['extractLinks', '🔗 Links'],
            ['extractText', '📝 Text'],
            ['extractMetadata', '🏷 Metadata'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={options[key as keyof ExtractionOptions] as boolean}
                onChange={e => setOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                className="rounded"
              />
              <span className="text-xs">{label}</span>
            </label>
          ))}
        </div>

        {/* Auto-scroll */}
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={options.autoScroll}
            onChange={e => setOptions(prev => ({ ...prev, autoScroll: e.target.checked }))}
            className="rounded"
          />
          <span className="text-xs">Auto-scroll</span>
          {options.autoScroll && (
            <input
              type="number"
              value={options.maxScrolls}
              onChange={e => setOptions(prev => ({ ...prev, maxScrolls: Number(e.target.value) }))}
              min={1}
              max={100}
              className="ml-1 w-16 text-xs border border-gray-300 rounded px-1 py-0.5"
              title="Max scrolls"
            />
          )}
        </label>

        {/* Min image size */}
        {options.extractImages && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Min size:</span>
            <input
              type="range"
              min={0}
              max={500}
              step={10}
              value={options.minImageWidth}
              onChange={e => setOptions(prev => ({ ...prev, minImageWidth: Number(e.target.value), minImageHeight: Number(e.target.value) }))}
              className="flex-1"
            />
            <span className="text-gray-500 w-12">{options.minImageWidth}px</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-b border-gray-100 flex gap-2">
        <button
          onClick={handleExtract}
          disabled={state === 'extracting' || !activeTab}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {state === 'extracting' ? '⏳ Extracting...' : '🚀 Extract Page'}
        </button>
        {payload && (
          <button
            onClick={handleSendToApp}
            disabled={!appConnected}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
            title="Send to desktop app"
          >
            📤
          </button>
        )}
      </div>

      {/* Progress */}
      {progress && state === 'extracting' && (
        <div className="px-4 py-3 border-b border-gray-100">
          <ProgressBar progress={progress} />
        </div>
      )}

      {/* Error */}
      {state === 'error' && error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-100">
          <div className="text-red-600 text-xs">❌ {error}</div>
        </div>
      )}

      {/* Results */}
      {payload && state === 'done' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Stats */}
          <div className="px-4 py-2 bg-green-50 border-b border-green-100">
            <div className="text-xs text-green-700 flex gap-3 flex-wrap">
              <span>🖼 {payload.images.length} images</span>
              <span>🎬 {payload.videos.length} videos</span>
              <span>🔗 {payload.links.length} links</span>
              {payload.audio.length > 0 && <span>🎵 {payload.audio.length} audio</span>}
              {payload.text.wordCount > 0 && <span>📝 {payload.text.wordCount} words</span>}
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-gray-200">
            {(['images', 'videos', 'links'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setPreviewTab(tab)}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${previewTab === tab ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {tab === 'images' && `🖼 ${payload.images.length}`}
                {tab === 'videos' && `🎬 ${payload.videos.length}`}
                {tab === 'links' && `🔗 ${payload.links.length}`}
              </button>
            ))}
          </div>

          {/* Preview */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1" style={{ maxHeight: 200 }}>
            {previewTab === 'images' && payload.images.slice(0, 50).map((img, i) => (
              <ImagePreview key={i} img={img} />
            ))}
            {previewTab === 'videos' && payload.videos.map((vid, i) => (
              <VideoItem key={i} vid={vid} />
            ))}
            {previewTab === 'links' && payload.links.slice(0, 50).map((link, i) => (
              <div key={i} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded text-xs hover:bg-gray-100">
                <span className={`flex-shrink-0 text-[10px] px-1 rounded ${
                  link.classification === 'internal' ? 'bg-blue-100 text-blue-700' :
                  link.classification === 'external' ? 'bg-gray-100 text-gray-600' :
                  link.classification === 'download' ? 'bg-orange-100 text-orange-700' :
                  'bg-gray-100 text-gray-500'
                }`}>{link.classification.slice(0, 3).toUpperCase()}</span>
                <span className="truncate text-gray-700">{link.text || link.url.slice(0, 50)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between text-xs text-gray-400">
        <span>Universal Web Scraper v1.0</span>
        {payload && (
          <button
            onClick={() => { setPayload(null); setState('idle'); }}
            className="text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
