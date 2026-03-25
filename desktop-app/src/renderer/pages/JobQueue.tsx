import React, { useState, useEffect } from 'react';
import type { ScrapeJob, AppSettings } from '../../shared/types';

interface Props { settings: AppSettings; }

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
  paused: 'bg-orange-100 text-orange-600',
};

export default function JobQueue({ settings }: Props) {
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [loading, setLoading] = useState(false);
  const isDark = settings.darkMode;

  const loadJobs = () => {
    setLoading(true);
    window.api.getJobs({ limit: 200 })
      .then(setJobs)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadJobs();
    const unsub = window.api.onJobUpdate((data: unknown) => {
      loadJobs();
    });
    const interval = setInterval(loadJobs, 5000);
    return () => { unsub(); clearInterval(interval); };
  }, []);

  const handleCancel = async (jobId: string) => {
    await window.api.cancelJob(jobId);
    loadJobs();
  };

  const handleRetry = async (job: ScrapeJob) => {
    await window.api.createJob({ url: job.sourceUrl, type: 'headless' });
    loadJobs();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Job Queue</h1>
        <button
          onClick={loadJobs}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {['all', 'running', 'pending', 'completed', 'failed'].map(status => (
          <button
            key={status}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
              isDark ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status} {status !== 'all' ? `(${jobs.filter(j => j.status === status).length})` : `(${jobs.length})`}
          </button>
        ))}
      </div>

      {loading && jobs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No jobs yet.</div>
      ) : (
        <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`text-left text-xs uppercase tracking-wider text-gray-500 ${isDark ? 'bg-gray-800' : 'bg-gray-50'} border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-gray-700' : 'divide-gray-200'}`}>
              {jobs.map(job => (
                <tr key={job.id} className={`hover:${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                  <td className="px-4 py-3 max-w-sm">
                    <div className="truncate text-sm">{job.sourceUrl}</div>
                    <div className="text-xs text-gray-400">{job.domain}</div>
                    {job.errorMessage && (
                      <div className="text-xs text-red-500 mt-0.5 truncate">{job.errorMessage}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[job.status] ?? STATUS_COLORS.pending}`}>
                      {job.status}
                    </span>
                    {job.status === 'running' && (
                      <div className="mt-1 h-1 w-24 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 capitalize text-xs">{job.jobType?.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(job.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {(job.status === 'running' || job.status === 'pending') && (
                        <button onClick={() => handleCancel(job.id)} className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50">Cancel</button>
                      )}
                      {job.status === 'failed' && (
                        <button onClick={() => handleRetry(job)} className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-50">Retry</button>
                      )}
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
