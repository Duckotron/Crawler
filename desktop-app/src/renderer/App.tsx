import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Downloads from './pages/Downloads';
import JobQueue from './pages/JobQueue';
import RuleEditor from './pages/RuleEditor';
import BatchMode from './pages/BatchMode';
import Settings from './pages/Settings';
import type { AppSettings, DashboardStats } from '../shared/types';
import { DEFAULT_APP_SETTINGS } from '../shared/types';

const NAV_ITEMS = [
  { path: '/', label: '📊 Dashboard', end: true },
  { path: '/downloads', label: '📁 Downloads', end: false },
  { path: '/jobs', label: '⚙️ Jobs', end: false },
  { path: '/rules', label: '📋 Rules', end: false },
  { path: '/batch', label: '🔄 Batch', end: false },
  { path: '/settings', label: '⚙️ Settings', end: false },
];

export default function App() {
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [clientCount, setClientCount] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    // Load settings
    window.api.getSettings().then(s => setSettings(s)).catch(() => {});
    window.api.getStats().then(s => setStats(s)).catch(() => {});
    window.api.getConnectionStatus().then(s => {
      setConnected(s.wsConnected);
      setClientCount(s.clientCount);
    }).catch(() => {});

    // Listen for connection status updates
    const unsubConn = window.api.onConnectionStatus((data: unknown) => {
      const d = data as { connected: boolean; clientCount: number };
      setConnected(d.connected);
      setClientCount(d.clientCount);
    });

    // Poll stats every 5s
    const interval = setInterval(() => {
      window.api.getStats().then(s => setStats(s)).catch(() => {});
    }, 5000);

    return () => {
      unsubConn();
      clearInterval(interval);
    };
  }, []);

  const isDark = settings.darkMode;

  return (
    <div className={`flex h-screen ${isDark ? 'dark bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      {/* Sidebar */}
      <aside className={`w-52 flex flex-col border-r ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="p-4 border-b border-inherit">
          <div className="font-bold text-blue-600 text-base">Universal Scraper</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-gray-400'}`} />
            <span className="text-xs text-gray-500">
              {connected ? `${clientCount} extension${clientCount !== 1 ? 's' : ''}` : 'No extension'}
            </span>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : isDark
                      ? 'text-gray-300 hover:bg-gray-700'
                      : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Quick stats */}
        {stats && (
          <div className={`p-3 border-t text-xs ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'} space-y-1`}>
            <div className="flex justify-between">
              <span>Active jobs</span>
              <span className="font-medium text-orange-500">{stats.activeJobs}</span>
            </div>
            <div className="flex justify-between">
              <span>Total files</span>
              <span className="font-medium">{stats.totalFiles.toLocaleString()}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard stats={stats} settings={settings} />} />
          <Route path="/downloads" element={<Downloads settings={settings} />} />
          <Route path="/jobs" element={<JobQueue settings={settings} />} />
          <Route path="/rules" element={<RuleEditor settings={settings} />} />
          <Route path="/batch" element={<BatchMode settings={settings} />} />
          <Route path="/settings" element={
            <Settings
              settings={settings}
              onSave={async (newSettings) => {
                await window.api.setSettings(newSettings);
                setSettings(newSettings);
              }}
            />
          } />
        </Routes>
      </main>
    </div>
  );
}
