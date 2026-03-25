import Database from 'better-sqlite3';
import { join } from 'path';
import { app } from 'electron';
import { existsSync, mkdirSync } from 'fs';
import type { ScrapeJob, DownloadedFile, SiteRule, SiteRuleConfig, DashboardStats } from '../shared/types';

let db: Database.Database;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS scrape_jobs (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    domain TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    job_type TEXT DEFAULT 'single_page',
    priority INTEGER DEFAULT 0,
    parent_job_id TEXT,
    crawl_depth INTEGER DEFAULT 0,
    max_depth INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    extraction_data JSON,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS downloaded_files (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES scrape_jobs(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    local_path TEXT NOT NULL,
    file_type TEXT DEFAULT 'other',
    mime_type TEXT,
    file_size INTEGER,
    content_hash TEXT,
    width INTEGER,
    height INTEGER,
    duration REAL,
    downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata JSON,
    thumbnail_path TEXT
  );

  CREATE TABLE IF NOT EXISTS site_rules (
    id TEXT PRIMARY KEY,
    domain_pattern TEXT NOT NULL UNIQUE,
    rule_config JSON NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_hash ON downloaded_files(content_hash);
  CREATE INDEX IF NOT EXISTS idx_files_job ON downloaded_files(job_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_domain ON scrape_jobs(domain);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON scrape_jobs(status);
`;

export function initDatabase(dbPath?: string): Database.Database {
  const userDataDir = app.getPath('userData');
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

  const resolvedPath = dbPath ?? join(userDataDir, 'scraper.db');
  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export function insertJob(job: ScrapeJob): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO scrape_jobs
    (id, source_url, domain, status, job_type, priority, parent_job_id, crawl_depth, max_depth, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id, job.sourceUrl, job.domain, job.status, job.jobType,
    job.priority, job.parentJobId ?? null, job.crawlDepth ?? 0, job.maxDepth ?? 1,
    job.createdAt
  );
}

export function updateJobStatus(
  id: string,
  status: ScrapeJob['status'],
  extra: { errorMessage?: string; extractionData?: string } = {}
): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE scrape_jobs SET
      status = ?,
      started_at = CASE WHEN ? = 'running' THEN ? ELSE started_at END,
      completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN ? ELSE completed_at END,
      error_message = ?,
      extraction_data = COALESCE(?, extraction_data)
    WHERE id = ?
  `).run(
    status,
    status, now,
    status, now,
    extra.errorMessage ?? null,
    extra.extractionData ?? null,
    id
  );
}

export function getJobs(limit = 100, offset = 0): ScrapeJob[] {
  return getDb().prepare(
    `SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset).map(rowToJob);
}

export function getJob(id: string): ScrapeJob | null {
  const row = getDb().prepare(`SELECT * FROM scrape_jobs WHERE id = ?`).get(id);
  return row ? rowToJob(row) : null;
}

export function getPendingJobs(): ScrapeJob[] {
  return getDb().prepare(
    `SELECT * FROM scrape_jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 50`
  ).all().map(rowToJob);
}

function rowToJob(row: Record<string, unknown>): ScrapeJob {
  return {
    id: row.id as string,
    sourceUrl: row.source_url as string,
    domain: row.domain as string,
    status: row.status as ScrapeJob['status'],
    jobType: (row.job_type as ScrapeJob['jobType']) ?? 'single_page',
    priority: (row.priority as number) ?? 0,
    parentJobId: row.parent_job_id as string | undefined,
    crawlDepth: row.crawl_depth as number | undefined,
    maxDepth: row.max_depth as number | undefined,
    createdAt: row.created_at as string,
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
    extractionData: row.extraction_data as string | undefined,
    errorMessage: row.error_message as string | undefined,
  };
}

// ─── Files ────────────────────────────────────────────────────────────────────

export function insertFile(file: DownloadedFile): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO downloaded_files
    (id, job_id, source_url, local_path, file_type, mime_type, file_size, content_hash,
     width, height, duration, downloaded_at, metadata, thumbnail_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    file.id, file.jobId, file.sourceUrl, file.localPath, file.fileType,
    file.mimeType ?? null, file.fileSize ?? null, file.contentHash ?? null,
    file.width ?? null, file.height ?? null, file.duration ?? null,
    file.downloadedAt, file.metadata ?? null, file.thumbnailPath ?? null
  );
}

export function getFilesByJob(jobId: string): DownloadedFile[] {
  return getDb().prepare(`SELECT * FROM downloaded_files WHERE job_id = ?`).all(jobId).map(rowToFile);
}

export function getFiles(
  options: { fileType?: string; search?: string; limit?: number; offset?: number } = {}
): DownloadedFile[] {
  let query = `SELECT * FROM downloaded_files WHERE 1=1`;
  const params: unknown[] = [];
  if (options.fileType) { query += ` AND file_type = ?`; params.push(options.fileType); }
  if (options.search) { query += ` AND (source_url LIKE ? OR local_path LIKE ?)`; params.push(`%${options.search}%`, `%${options.search}%`); }
  query += ` ORDER BY downloaded_at DESC LIMIT ? OFFSET ?`;
  params.push(options.limit ?? 100, options.offset ?? 0);
  return getDb().prepare(query).all(...params).map(rowToFile);
}

export function fileHashExists(hash: string): boolean {
  const row = getDb().prepare(`SELECT id FROM downloaded_files WHERE content_hash = ? LIMIT 1`).get(hash);
  return !!row;
}

export function deleteFile(id: string): void {
  getDb().prepare(`DELETE FROM downloaded_files WHERE id = ?`).run(id);
}

function rowToFile(row: Record<string, unknown>): DownloadedFile {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    sourceUrl: row.source_url as string,
    localPath: row.local_path as string,
    fileType: row.file_type as DownloadedFile['fileType'],
    mimeType: row.mime_type as string | undefined,
    fileSize: row.file_size as number | undefined,
    contentHash: row.content_hash as string | undefined,
    width: row.width as number | undefined,
    height: row.height as number | undefined,
    duration: row.duration as number | undefined,
    downloadedAt: row.downloaded_at as string,
    metadata: row.metadata as string | undefined,
    thumbnailPath: row.thumbnail_path as string | undefined,
  };
}

// ─── Site Rules ───────────────────────────────────────────────────────────────

export function getRules(): SiteRule[] {
  return getDb().prepare(`SELECT * FROM site_rules ORDER BY domain_pattern`).all().map(rowToRule);
}

export function getRule(domainPattern: string): SiteRule | null {
  const row = getDb().prepare(`SELECT * FROM site_rules WHERE domain_pattern = ?`).get(domainPattern);
  return row ? rowToRule(row) : null;
}

export function upsertRule(rule: SiteRule): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO site_rules (id, domain_pattern, rule_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(domain_pattern) DO UPDATE SET rule_config = excluded.rule_config, updated_at = excluded.updated_at
  `).run(rule.id, rule.domainPattern, JSON.stringify(rule.ruleConfig), now, now);
}

export function deleteRule(id: string): void {
  getDb().prepare(`DELETE FROM site_rules WHERE id = ?`).run(id);
}

export function findRuleForDomain(domain: string): SiteRule | null {
  const rules = getRules();
  for (const rule of rules) {
    if (matchesDomainPattern(domain, rule.domainPattern)) return rule;
  }
  return null;
}

function matchesDomainPattern(domain: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return domain.endsWith(suffix) || domain === suffix.slice(1);
  }
  return domain === pattern;
}

function rowToRule(row: Record<string, unknown>): SiteRule {
  return {
    id: row.id as string,
    domainPattern: row.domain_pattern as string,
    ruleConfig: JSON.parse(row.rule_config as string) as SiteRuleConfig,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── App Settings ─────────────────────────────────────────────────────────────

export function getSetting<T>(key: string, defaultValue: T): T {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!row) return defaultValue;
  try { return JSON.parse(row.value) as T; } catch { return defaultValue; }
}

export function setSetting(key: string, value: unknown): void {
  getDb().prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`).run(key, JSON.stringify(value));
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getStats(): DashboardStats {
  const db = getDb();
  const jobStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('pending','running') THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM scrape_jobs
  `).get() as { total: number; active: number; completed: number; failed: number };

  const fileStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(file_size), 0) as total_size,
      SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) as images,
      SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) as videos,
      SUM(CASE WHEN file_type = 'audio' THEN 1 ELSE 0 END) as audio
    FROM downloaded_files
  `).get() as { total: number; total_size: number; images: number; videos: number; audio: number };

  return {
    totalJobs: jobStats.total,
    activeJobs: jobStats.active,
    completedJobs: jobStats.completed,
    failedJobs: jobStats.failed,
    totalFiles: fileStats.total,
    totalStorageBytes: fileStats.total_size,
    imagesCount: fileStats.images,
    videosCount: fileStats.videos,
    audioCount: fileStats.audio,
  };
}
