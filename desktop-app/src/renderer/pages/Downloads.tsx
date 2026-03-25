import React, { useState, useEffect, useCallback } from 'react';
import type { DownloadedFile, AppSettings, DownloadProgress } from '../../shared/types';
import { formatBytes } from '../utils';

interface Props { settings: AppSettings; }

export default function Downloads({ settings }: Props) {
  const [files, setFiles] = useState<DownloadedFile[]>([]);
  const [search, setSearch] = useState('');
  const [fileType, setFileType] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [loading, setLoading] = useState(false);
  const [activeProgress, setActiveProgress] = useState<Map<string, DownloadProgress>>(new Map());
  const isDark = settings.darkMode;

  const loadFiles = useCallback(() => {
    setLoading(true);
    window.api.getFiles({ search: search || undefined, fileType: fileType || undefined, limit: 200 })
      .then(setFiles)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, fileType]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    const unsub = window.api.onDownloadProgress((data: unknown) => {
      const prog = data as DownloadProgress;
      setActiveProgress(prev => new Map(prev).set(prog.fileId, prog));
    });
    return unsub;
  }, []);

  const handleDelete = async (fileId: string) => {
    await window.api.deleteFile(fileId);
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const fileTypeIcon = (type: DownloadedFile['fileType']) => {
    if (type === 'image') return '🖼';
    if (type === 'video') return '🎬';
    if (type === 'audio') return '🎵';
    return '📄';
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Downloads</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('list')} className={`p-1.5 rounded ${view === 'list' ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}>☰</button>
          <button onClick={() => setView('grid')} className={`p-1.5 rounded ${view === 'grid' ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}>⊞</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search files..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`px-3 py-2 border rounded-lg text-sm flex-1 min-w-48 ${isDark ? 'bg-gray-800 border-gray-600 text-white' : 'border-gray-300'}`}
        />
        <select
          value={fileType}
          onChange={e => setFileType(e.target.value)}
          className={`px-3 py-2 border rounded-lg text-sm ${isDark ? 'bg-gray-800 border-gray-600 text-white' : 'border-gray-300'}`}
        >
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="audio">Audio</option>
          <option value="document">Documents</option>
        </select>
        <span className="text-sm text-gray-500 self-center">{files.length.toLocaleString()} files</span>
      </div>

      {/* Active downloads progress */}
      {activeProgress.size > 0 && (
        <div className={`rounded-xl p-4 border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-blue-50 border-blue-200'} space-y-2`}>
          <div className="text-sm font-medium text-blue-700">Active Downloads</div>
          {Array.from(activeProgress.values()).map(prog => (
            <div key={prog.fileId} className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span className="truncate max-w-xs">{prog.url.split('/').pop()}</span>
                <span>{prog.percentage ?? '?'}% · {formatBytes(prog.speed ?? 0)}/s</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${prog.percentage ?? 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : files.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No files yet. Use the extension or Batch Mode to start downloading.</div>
      ) : view === 'grid' ? (
        /* Grid view */
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {files.map(file => (
            <div
              key={file.id}
              className={`group relative aspect-square rounded-lg overflow-hidden ${isDark ? 'bg-gray-800' : 'bg-gray-100'} cursor-pointer hover:ring-2 ring-blue-500`}
              onClick={() => window.api.openFile(file.localPath)}
              title={file.sourceUrl}
            >
              {file.thumbnailPath ? (
                <img src={`file://${file.thumbnailPath}`} className="w-full h-full object-cover" alt="" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl">
                  {fileTypeIcon(file.fileType)}
                </div>
              )}
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-end">
                <div className="p-1 w-full opacity-0 group-hover:opacity-100 text-white text-[10px] truncate">
                  {file.localPath.split('/').pop()}
                </div>
              </div>
              <button
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-500 text-white w-5 h-5 rounded-full text-xs flex items-center justify-center"
                onClick={e => { e.stopPropagation(); handleDelete(file.id); }}
              >×</button>
            </div>
          ))}
        </div>
      ) : (
        /* List view */
        <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`text-left text-xs uppercase tracking-wider text-gray-500 ${isDark ? 'bg-gray-800' : 'bg-gray-50'} border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Downloaded</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {files.map(file => (
                <tr key={file.id} className={`hover:${isDark ? 'bg-gray-750' : 'bg-gray-50'} transition-colors`}>
                  <td className="px-4 py-3 max-w-xs">
                    <div className="flex items-center gap-2">
                      <span>{fileTypeIcon(file.fileType)}</span>
                      <div>
                        <div className="truncate text-sm font-medium">{file.localPath.split('/').pop()}</div>
                        <div className="text-xs text-gray-400 truncate">{file.sourceUrl}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      file.fileType === 'image' ? 'bg-blue-100 text-blue-700' :
                      file.fileType === 'video' ? 'bg-purple-100 text-purple-700' :
                      file.fileType === 'audio' ? 'bg-green-100 text-green-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {file.fileType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{file.fileSize ? formatBytes(file.fileSize) : '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">{new Date(file.downloadedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => window.api.openFile(file.localPath)} className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-50">Open</button>
                      <button onClick={() => window.api.openFolder(file.localPath)} className="text-gray-500 hover:text-gray-700 text-xs px-2 py-1 rounded hover:bg-gray-100">Folder</button>
                      <button onClick={() => handleDelete(file.id)} className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
