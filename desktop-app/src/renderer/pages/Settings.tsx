import React, { useState } from 'react';
import type { AppSettings } from '../../shared/types';
import { DEFAULT_APP_SETTINGS } from '../../shared/types';

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
}

export default function Settings({ settings: initialSettings, onSave }: Props) {
  const [settings, setSettings] = useState<AppSettings>({ ...initialSettings });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isDark = settings.darkMode;

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectDir = async () => {
    const dir = await window.api.selectDirectory();
    if (dir) update('outputDir', dir);
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className={`rounded-xl border p-5 space-y-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <h2 className="font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
      {children}
    </div>
  );

  const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Output */}
      <Section title="Output">
        <Field label="Output Directory" hint="All downloaded files will be saved here">
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.outputDir}
              onChange={e => update('outputDir', e.target.value)}
              placeholder="~/Downloads/UniversalScraper"
              className={`flex-1 px-3 py-2 border rounded-lg text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
            />
            <button
              onClick={handleSelectDir}
              className={`px-3 py-2 border rounded-lg text-sm ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-50'}`}
            >
              Browse
            </button>
          </div>
        </Field>
      </Section>

      {/* Downloads */}
      <Section title="Downloads">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Concurrent downloads">
            <input
              type="number"
              value={settings.downloadConcurrency}
              onChange={e => update('downloadConcurrency', Number(e.target.value))}
              min={1} max={20}
              className={`w-full px-3 py-2 border rounded-lg text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
            />
          </Field>
          <Field label="Max retries">
            <input
              type="number"
              value={settings.downloadRetries}
              onChange={e => update('downloadRetries', Number(e.target.value))}
              min={0} max={10}
              className={`w-full px-3 py-2 border rounded-lg text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
            />
          </Field>
          <Field label="Rate limit (ms)" hint="Delay between requests per domain">
            <input
              type="number"
              value={settings.rateLimit}
              onChange={e => update('rateLimit', Number(e.target.value))}
              min={0}
              className={`w-full px-3 py-2 border rounded-lg text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
            />
          </Field>
          <Field label="WebSocket port">
            <input
              type="number"
              value={settings.wsPort}
              onChange={e => update('wsPort', Number(e.target.value))}
              min={1024} max={65535}
              className={`w-full px-3 py-2 border rounded-lg text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
            />
          </Field>
        </div>

        <div className="space-y-2">
          {[
            ['keepDuplicates', 'Keep duplicate files (by content hash)'],
            ['stripExif', 'Strip EXIF metadata from images'],
            ['generateThumbnails', 'Generate thumbnails for images & videos'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={settings[key as keyof AppSettings] as boolean}
                onChange={e => update(key as keyof AppSettings, e.target.checked as AppSettings[keyof AppSettings])}
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      {/* ffmpeg */}
      <Section title="Media Processing">
        <Field label="FFmpeg path" hint="Leave empty to use bundled or system ffmpeg">
          <input
            type="text"
            value={settings.ffmpegPath}
            onChange={e => update('ffmpegPath', e.target.value)}
            placeholder="/usr/local/bin/ffmpeg"
            className={`w-full px-3 py-2 border rounded-lg text-sm font-mono ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
          />
        </Field>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={settings.ocrEnabled}
            onChange={e => update('ocrEnabled', e.target.checked)}
          />
          Enable OCR (requires tesseract.js)
        </label>
      </Section>

      {/* Proxy */}
      <Section title="Proxy">
        <Field label="Proxy URL" hint="Used for headless browser scraping">
          <input
            type="text"
            value={settings.proxyUrl ?? ''}
            onChange={e => update('proxyUrl', e.target.value || undefined)}
            placeholder="http://user:pass@proxy.example.com:8080"
            className={`w-full px-3 py-2 border rounded-lg text-sm font-mono ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
          />
        </Field>
      </Section>

      {/* UI */}
      <Section title="Appearance">
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={settings.darkMode}
            onChange={e => update('darkMode', e.target.checked)}
          />
          Dark mode
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={settings.autoStart}
            onChange={e => update('autoStart', e.target.checked)}
          />
          Start automatically on login
        </label>
      </Section>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2.5 rounded-lg font-medium"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {saved && <span className="text-green-600 text-sm">✓ Saved</span>}
        <button
          onClick={() => setSettings({ ...DEFAULT_APP_SETTINGS })}
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
