import React, { useState } from 'react';
import type { AppSettings } from '../../shared/types';
import { useNavigate } from 'react-router-dom';

interface Props { settings: AppSettings; }

export default function BatchMode({ settings }: Props) {
  const [urlsText, setUrlsText] = useState('');
  const [sitemapUrl, setSitemapUrl] = useState('');
  const [crawlDepth, setCrawlDepth] = useState(1);
  const [useHeadless, setUseHeadless] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const isDark = settings.darkMode;
  const navigate = useNavigate();

  const parsedUrls = urlsText
    .split('\n')
    .map(s => s.trim())
    .filter(s => s && (s.startsWith('http://') || s.startsWith('https://')));

  const handleSubmit = async () => {
    if (parsedUrls.length === 0) return;
    setSubmitting(true);
    try {
      for (const url of parsedUrls) {
        await window.api.createJob({ url, type: useHeadless ? 'headless' : 'batch' });
      }
      setSubmitted(true);
      setTimeout(() => {
        navigate('/jobs');
      }, 1500);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSitemapImport = async () => {
    if (!sitemapUrl.trim()) return;
    try {
      // Fetch and parse sitemap
      const resp = await fetch(sitemapUrl);
      const text = await resp.text();
      const matches = text.match(/<loc>(.*?)<\/loc>/g) ?? [];
      const urls = matches.map(m => m.replace(/<\/?loc>/g, '').trim()).filter(Boolean);
      setUrlsText(urls.join('\n'));
    } catch (err) {
      alert(`Failed to fetch sitemap: ${err}`);
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <h1 className="text-2xl font-bold">Batch Mode</h1>

      {/* Sitemap import */}
      <div className={`rounded-xl border p-5 space-y-3 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="font-semibold">Import from Sitemap</div>
        <div className="flex gap-3">
          <input
            type="url"
            value={sitemapUrl}
            onChange={e => setSitemapUrl(e.target.value)}
            placeholder="https://example.com/sitemap.xml"
            className={`flex-1 px-3 py-2 border rounded-lg text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
          />
          <button
            onClick={handleSitemapImport}
            disabled={!sitemapUrl.trim()}
            className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg text-sm"
          >
            Import
          </button>
        </div>
      </div>

      {/* URL list */}
      <div className={`rounded-xl border p-5 space-y-3 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center justify-between">
          <div className="font-semibold">URL List</div>
          <span className="text-sm text-gray-400">{parsedUrls.length} valid URLs</span>
        </div>
        <textarea
          value={urlsText}
          onChange={e => setUrlsText(e.target.value)}
          placeholder={'https://example.com/page1\nhttps://example.com/page2\nhttps://example.com/page3'}
          rows={12}
          className={`w-full px-3 py-2 border rounded-lg font-mono text-xs resize-vertical ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
        />
        <p className="text-xs text-gray-400">One URL per line. Only http:// and https:// URLs are accepted.</p>
      </div>

      {/* Options */}
      <div className={`rounded-xl border p-5 space-y-3 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="font-semibold">Options</div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={useHeadless}
            onChange={e => setUseHeadless(e.target.checked)}
            className="rounded"
          />
          <div>
            <div className="text-sm font-medium">Use headless browser</div>
            <div className="text-xs text-gray-400">Renders JavaScript, handles SPAs and dynamic content</div>
          </div>
        </label>

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 w-32">Crawl depth</label>
          <input
            type="number"
            value={crawlDepth}
            onChange={e => setCrawlDepth(Number(e.target.value))}
            min={1}
            max={5}
            className={`w-20 px-3 py-2 border rounded-lg text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
          />
          <span className="text-xs text-gray-400">Follow internal links up to N levels deep</span>
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={parsedUrls.length === 0 || submitting}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
        >
          {submitting ? '⏳ Queuing...' : `🚀 Start ${parsedUrls.length} Jobs`}
        </button>
        {submitted && <span className="text-green-600 text-sm">✓ Jobs queued! Redirecting...</span>}
      </div>
    </div>
  );
}
