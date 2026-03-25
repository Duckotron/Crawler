import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { ExtensionSettings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import '../popup/popup.css';

function Options() {
  const [settings, setSettings] = useState<ExtensionSettings>({ ...DEFAULT_SETTINGS });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get('settings').then(stored => {
      if (stored.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...stored.settings });
      }
    });
  }, []);

  const save = async () => {
    await chrome.storage.sync.set({ settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Universal Web Scraper — Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Configure the extension and connection to the desktop app.</p>
      </div>

      {/* Connection */}
      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Connection</h2>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Communication Mode</label>
          <div className="flex gap-4">
            {['websocket', 'native-messaging'].map(mode => (
              <label key={mode} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="commMode"
                  value={mode}
                  checked={settings.communicationMode === mode}
                  onChange={() => setSettings(prev => ({ ...prev, communicationMode: mode as ExtensionSettings['communicationMode'] }))}
                />
                <span className="text-sm">{mode === 'websocket' ? 'WebSocket (recommended)' : 'Native Messaging'}</span>
              </label>
            ))}
          </div>
        </div>

        {settings.communicationMode === 'websocket' && (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">WebSocket Port</label>
            <input
              type="number"
              value={settings.wsPort}
              onChange={e => setSettings(prev => ({ ...prev, wsPort: Number(e.target.value) }))}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32"
              min={1024}
              max={65535}
            />
          </div>
        )}

        {settings.communicationMode === 'native-messaging' && (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Native Host Name</label>
            <input
              type="text"
              value={settings.nativeHostName}
              onChange={e => setSettings(prev => ({ ...prev, nativeHostName: e.target.value }))}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full font-mono"
            />
          </div>
        )}
      </section>

      {/* Output */}
      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Output</h2>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">File naming template</label>
          <input
            type="text"
            value={settings.outputTemplate}
            onChange={e => setSettings(prev => ({ ...prev, outputTemplate: e.target.value }))}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full font-mono"
          />
          <p className="text-xs text-gray-400">Variables: {'{domain}'} {'{date}'} {'{type}'} {'{filename}'}</p>
        </div>
      </section>

      {/* Extraction Defaults */}
      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Default Extraction Options</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['extractImages', 'Extract images'],
            ['extractVideos', 'Extract videos & audio'],
            ['extractLinks', 'Extract links'],
            ['extractText', 'Extract text'],
            ['extractMetadata', 'Extract metadata'],
            ['autoScroll', 'Auto-scroll pages'],
            ['clickLoadMore', 'Click load-more buttons'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={settings.defaultOptions[key as keyof typeof settings.defaultOptions] as boolean}
                onChange={e => setSettings(prev => ({
                  ...prev,
                  defaultOptions: { ...prev.defaultOptions, [key]: e.target.checked },
                }))}
                className="rounded"
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      {/* Domain Rules */}
      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Domain Filtering</h2>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">Blacklist (one domain per line)</label>
          <textarea
            value={settings.blacklist.join('\n')}
            onChange={e => setSettings(prev => ({
              ...prev,
              blacklist: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
            }))}
            className="border border-gray-300 rounded px-3 py-2 text-sm w-full font-mono"
            rows={3}
            placeholder="example.com"
          />
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-medium"
        >
          Save Settings
        </button>
        {saved && <span className="text-green-600 text-sm">✓ Saved</span>}
        <button
          onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Options />);
