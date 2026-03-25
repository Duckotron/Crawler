import React, { useState, useEffect } from 'react';
import type { SiteRule, SiteRuleConfig, AppSettings } from '../../shared/types';

interface Props { settings: AppSettings; }

export default function RuleEditor({ settings }: Props) {
  const [rules, setRules] = useState<SiteRule[]>([]);
  const [editingRule, setEditingRule] = useState<SiteRule | null>(null);
  const [domainPattern, setDomainPattern] = useState('');
  const [configJson, setConfigJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [saved, setSaved] = useState(false);
  const isDark = settings.darkMode;

  const loadRules = () => {
    window.api.getRules().then(setRules).catch(() => {});
  };

  useEffect(() => { loadRules(); }, []);

  const handleEdit = (rule: SiteRule) => {
    setEditingRule(rule);
    setDomainPattern(rule.domainPattern);
    setConfigJson(JSON.stringify(rule.ruleConfig, null, 2));
    setJsonError('');
  };

  const handleNew = () => {
    setEditingRule(null);
    setDomainPattern('');
    setConfigJson(JSON.stringify({
      selectors: { content: '', images: '', loadMore: '', removeElements: [] },
      behavior: { autoScroll: false, maxScrolls: 10, waitForSelector: '', requiresAuth: false },
    }, null, 2));
    setJsonError('');
  };

  const handleSave = async () => {
    setJsonError('');
    let config: SiteRuleConfig;
    try {
      config = JSON.parse(configJson) as SiteRuleConfig;
    } catch (e) {
      setJsonError('Invalid JSON');
      return;
    }
    try {
      await window.api.saveRule({ domainPattern, config });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      loadRules();
      setEditingRule(null);
      setDomainPattern('');
    } catch (e) {
      setJsonError(String(e));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this rule?')) return;
    await window.api.deleteRule(id);
    loadRules();
    if (editingRule?.id === id) {
      setEditingRule(null);
      setDomainPattern('');
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Site Rules</h1>
        <button
          onClick={handleNew}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + New Rule
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4" style={{ height: 'calc(100vh - 160px)' }}>
        {/* Rule list */}
        <div className={`rounded-xl border overflow-auto ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          {rules.length === 0 ? (
            <div className="p-4 text-gray-400 text-sm text-center">No rules yet</div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {rules.map(rule => (
                <div
                  key={rule.id}
                  className={`p-3 cursor-pointer hover:${isDark ? 'bg-gray-750' : 'bg-gray-50'} ${editingRule?.id === rule.id ? (isDark ? 'bg-gray-700' : 'bg-blue-50') : ''}`}
                  onClick={() => handleEdit(rule)}
                >
                  <div className="font-mono text-sm">{rule.domainPattern}</div>
                  <div className="text-xs text-gray-400 mt-0.5">Updated {new Date(rule.updatedAt).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        <div className={`col-span-2 rounded-xl border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} flex flex-col`}>
          {(editingRule !== null || domainPattern !== '') ? (
            <div className="p-5 flex flex-col h-full space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Domain Pattern</label>
                <input
                  type="text"
                  value={domainPattern}
                  onChange={e => setDomainPattern(e.target.value)}
                  placeholder="*.example.com"
                  className={`w-full px-3 py-2 border rounded-lg font-mono text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'}`}
                />
                <p className="text-xs text-gray-400">Use *.domain.com for subdomains, exact domain.com for exact match</p>
              </div>

              <div className="flex-1 flex flex-col space-y-1 min-h-0">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Rule Configuration (JSON)</label>
                <textarea
                  value={configJson}
                  onChange={e => { setConfigJson(e.target.value); setJsonError(''); }}
                  className={`flex-1 px-3 py-2 border rounded-lg font-mono text-xs resize-none ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-300'} ${jsonError ? 'border-red-400' : ''}`}
                />
                {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium"
                >
                  Save Rule
                </button>
                {saved && <span className="text-green-600 text-sm">✓ Saved</span>}
                {editingRule && (
                  <button
                    onClick={() => handleDelete(editingRule.id)}
                    className="text-red-500 hover:text-red-700 text-sm px-3 py-2 rounded hover:bg-red-50"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={() => { setEditingRule(null); setDomainPattern(''); }}
                  className="text-gray-500 hover:text-gray-700 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              Select a rule to edit, or click "+ New Rule"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
