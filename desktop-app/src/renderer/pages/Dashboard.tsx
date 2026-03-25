import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashboardStats, AppSettings, DownloadedFile } from '../../shared/types';
import { formatBytes } from '../utils';

interface Props {
  stats: DashboardStats | null;
  settings: AppSettings;
}

export default function Dashboard({ stats, settings }: Props) {
  const navigate = useNavigate();
  const [recentFiles, setRecentFiles] = useState<DownloadedFile[]>([]);
  const [newJobUrl, setNewJobUrl] = useState('');
  const isDark = settings.darkMode;

  useEffect(() => {
    window.api.getFiles({ limit: 12 }).then(files => setRecentFiles(files)).catch(() => {});
  }, []);

  const handleNewJob = async () => {
    if (!newJobUrl.trim()) return;
    try {
      const result = await window.api.createJob({ url: newJobUrl.trim(), type: 'headless' });
      if (result.success) {
        setNewJobUrl('');
        navigate('/jobs');
      }
    } catch {}
  };

  const StatCard = ({ label, value, color = 'blue' }: { label: string; value: string | number; color?: string }) => (
    <div className={`rounded-xl p-5 ${isDark ? 'bg-gray-800' : 'bg-white'} shadow-sm border ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Quick scrape */}
      <div className={`rounded-xl p-5 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-blue-50 border-blue-200'} border`}>
        <div className="font-semibold text-blue-700 dark:text-blue-400 mb-3">Quick Scrape</div>
        <div className="flex gap-3">
          <input
            type="url"
            value={newJobUrl}
            onChange={e => setNewJobUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleNewJob()}
            placeholder="https://example.com"
            className={`flex-1 px-3 py-2 rounded-lg border text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`}
          />
          <button
            onClick={handleNewJob}
            disabled={!newJobUrl.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Scrape
          </button>
          <button
            onClick={() => navigate('/batch')}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Batch Mode
          </button>
        </div>
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Jobs" value={stats.totalJobs.toLocaleString()} />
          <StatCard label="Active Jobs" value={stats.activeJobs} color="orange" />
          <StatCard label="Total Files" value={stats.totalFiles.toLocaleString()} />
          <StatCard label="Storage Used" value={formatBytes(stats.totalStorageBytes)} />
        </div>
      )}

      {/* File type breakdown */}
      {stats && (
        <div className={`rounded-xl p-5 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} border shadow-sm`}>
          <div className="font-semibold mb-4">File Types</div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🖼</span>
              <div>
                <div className="font-semibold">{stats.imagesCount.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Images</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎬</span>
              <div>
                <div className="font-semibold">{stats.videosCount.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Videos</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎵</span>
              <div>
                <div className="font-semibold">{stats.audioCount.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Audio</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent files */}
      {recentFiles.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Recent Downloads</div>
            <button
              onClick={() => navigate('/downloads')}
              className="text-blue-600 text-sm hover:underline"
            >
              View all →
            </button>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
            {recentFiles.filter(f => f.fileType === 'image').slice(0, 12).map(file => (
              <div
                key={file.id}
                className={`aspect-square rounded-lg overflow-hidden ${isDark ? 'bg-gray-800' : 'bg-gray-100'} cursor-pointer hover:ring-2 ring-blue-500`}
                onClick={() => window.api.openFile(file.localPath)}
                title={file.sourceUrl}
              >
                {file.thumbnailPath ? (
                  <img src={`file://${file.thumbnailPath}`} className="w-full h-full object-cover" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">
                    {file.fileType === 'video' ? '🎬' : file.fileType === 'audio' ? '🎵' : '📄'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
