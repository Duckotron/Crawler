/**
 * Wait for a number of milliseconds.
 */
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Clamp a number between min and max.
 */
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/**
 * Convert HTML to plain text.
 */
export function htmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? div.innerText ?? '';
}

/**
 * Very simple HTML → Markdown conversion for headings, paragraphs, links, lists.
 */
export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_m, level, content) => {
      const hashes = '#'.repeat(Number(level));
      return `\n${hashes} ${stripTags(content)}\n`;
    })
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href, text) =>
      `[${stripTags(text)}](${href})`
    )
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, (_m, t) => `**${t}**`)
    .replace(/<em[^>]*>(.*?)<\/em>/gi, (_m, t) => `_${t}_`)
    .replace(/<li[^>]*>(.*?)<\/li>/gi, (_m, t) => `- ${stripTags(t)}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, (_m, t) => `\n${stripTags(t)}\n`)
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * Format bytes as human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Get file extension from URL.
 */
export function getFileExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop() ?? '';
    return ext.toLowerCase().split('?')[0];
  } catch {
    return '';
  }
}

/**
 * Classify a URL as a file download based on extension.
 */
const DOWNLOAD_EXTENSIONS = new Set([
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z', 'exe', 'dmg', 'pkg', 'deb', 'rpm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
  'mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
  'csv', 'json', 'xml', 'sql',
]);

export function isDownloadUrl(url: string): boolean {
  const ext = getFileExtension(url);
  return DOWNLOAD_EXTENSIONS.has(ext);
}

/**
 * Count words in a string.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Estimate reading time in minutes.
 */
export function estimateReadingTime(text: string): number {
  const words = countWords(text);
  return Math.ceil(words / 200); // avg 200 wpm
}

/**
 * Parse srcset attribute into an array of URLs.
 */
export function parseSrcset(srcset: string): string[] {
  return srcset
    .split(',')
    .map(s => s.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/**
 * Check if a URL is a known video platform embed.
 */
export function detectVideoPlatform(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('vimeo.com')) return 'vimeo';
  if (lower.includes('dailymotion.com')) return 'dailymotion';
  if (lower.includes('twitch.tv')) return 'twitch';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  return undefined;
}

/**
 * Detect if a URL is an HLS manifest.
 */
export function isHlsUrl(url: string): boolean {
  return url.includes('.m3u8') || url.includes('application/x-mpegurl');
}

/**
 * Detect if a URL is a DASH manifest.
 */
export function isDashUrl(url: string): boolean {
  return url.includes('.mpd') || url.includes('application/dash+xml');
}
