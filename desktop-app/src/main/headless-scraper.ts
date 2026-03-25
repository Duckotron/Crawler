/**
 * Headless browser scraper using Playwright.
 * Used for batch/scheduled jobs without the browser extension.
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import type { ExtractionPayload, AppSettings, SiteRuleConfig } from '../shared/types';
import { RuleEngine } from './rule-engine';

// Stealth script to override common bot-detection vectors
const STEALTH_SCRIPT = `
  // Override webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // Override chrome property
  window.chrome = { runtime: {} };

  // Randomize canvas fingerprint slightly
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const ctx = originalGetContext.call(this, type, ...args);
    if (type === '2d' && ctx) {
      const originalFillText = ctx.fillText.bind(ctx);
      ctx.fillText = function(...textArgs) {
        ctx.shadowBlur = Math.random() * 0.1;
        return originalFillText(...textArgs);
      };
    }
    return ctx;
  };

  // Override permissions
  const originalQuery = window.navigator.permissions?.query;
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: 'denied', onchange: null });
      }
      return originalQuery(parameters);
    };
  }
`;

export class HeadlessScraper {
  private browser: Browser | null = null;
  private settings: AppSettings;
  private ruleEngine: RuleEngine;
  private capturedNetworkUrls = new Map<Page, string[]>();

  constructor(settings: AppSettings, ruleEngine: RuleEngine) {
    this.settings = settings;
    this.ruleEngine = ruleEngine;
  }

  async init(): Promise<void> {
    if (this.browser) return;
    try {
      const { chromium } = await import('playwright');
      const launchOptions: Record<string, unknown> = {
        headless: this.settings.playwrightHeadless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
        ],
      };

      if (this.settings.proxyUrl) {
        launchOptions.proxy = { server: this.settings.proxyUrl };
      }

      this.browser = await chromium.launch(launchOptions as Parameters<typeof chromium.launch>[0]);
    } catch (err) {
      throw new Error(`Failed to launch Playwright: ${err}`);
    }
  }

  async scrape(url: string, cookies?: string): Promise<ExtractionPayload> {
    if (!this.browser) await this.init();
    if (!this.browser) throw new Error('Browser not initialized');

    let domain = '';
    try { domain = new URL(url).hostname; } catch {}

    const rule = this.ruleEngine.getRuleForDomain(domain);
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      ...(cookies ? { storageState: undefined } : {}),
    });

    // Install stealth
    await context.addInitScript(STEALTH_SCRIPT);

    const page = await context.newPage();
    const networkUrls: string[] = [];
    this.capturedNetworkUrls.set(page, networkUrls);

    // Intercept network requests for media URLs
    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      const resourceType = route.request().resourceType();
      if (['media', 'xhr', 'fetch'].includes(resourceType)) {
        if (this.isMediaUrl(reqUrl)) {
          networkUrls.push(reqUrl);
        }
      }
      await route.continue();
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

      // Apply site rule behaviors
      if (rule) {
        await this.applyRule(page, rule.ruleConfig);
      }

      // Inject and run extraction scripts
      const payload = await page.evaluate(
        this.buildExtractionScript(rule?.ruleConfig)
      ) as ExtractionPayload;

      payload.sourceUrl = url;
      payload.domain = domain;
      payload.timestamp = new Date().toISOString();
      payload.networkCaptures = networkUrls.map(u => ({
        url: u,
        mimeType: this.guessMimeType(u),
        resourceType: 'video' as const,
        timestamp: Date.now(),
      }));

      return payload;
    } finally {
      this.capturedNetworkUrls.delete(page);
      await page.close();
      await context.close();
    }
  }

  private async applyRule(page: Page, config: SiteRuleConfig): Promise<void> {
    const behavior = config.behavior ?? {};

    // Click elements before extract
    if (behavior.clickBeforeExtract) {
      for (const selector of behavior.clickBeforeExtract) {
        try {
          await page.click(selector, { timeout: 2000 });
          await page.waitForTimeout(500);
        } catch {}
      }
    }

    // Wait for selector
    if (behavior.waitForSelector) {
      try {
        await page.waitForSelector(behavior.waitForSelector, { timeout: 10_000 });
      } catch {}
    }

    // Auto-scroll
    if (behavior.autoScroll) {
      const maxScrolls = behavior.maxScrolls ?? 10;
      for (let i = 0; i < maxScrolls; i++) {
        const prevHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(behavior.delayBetweenActions ?? 800);
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === prevHeight) break;
      }
    }
  }

  private buildExtractionScript(config?: SiteRuleConfig): () => ExtractionPayload {
    // Return a self-contained extraction function to inject into the page
    return () => {
      const BASE_URL = location.href;
      const images: ExtractionPayload['images'] = [];
      const videos: ExtractionPayload['videos'] = [];
      const audio: ExtractionPayload['audio'] = [];
      const links: ExtractionPayload['links'] = [];
      const seenUrls = new Set<string>();

      function resolve(url: string) {
        if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
        try { return new URL(url, BASE_URL).href; } catch { return url; }
      }

      // Images
      document.querySelectorAll('img[src], img[data-src]').forEach((el: Element) => {
        const img = el as HTMLImageElement;
        const url = resolve(img.src || img.dataset.src || '');
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          images.push({ url, alt: img.alt || '', width: img.naturalWidth || undefined, height: img.naturalHeight || undefined, context: img.parentElement?.tagName?.toLowerCase() || '', sourceType: 'img' });
        }
      });

      // Videos
      document.querySelectorAll('video[src], video source[src]').forEach((el: Element) => {
        const vid = el as HTMLVideoElement;
        const url = resolve(vid.src || (el as HTMLSourceElement).src || '');
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          videos.push({ url, type: 'direct', duration: (vid as HTMLVideoElement).duration || undefined });
        }
      });

      // Links
      document.querySelectorAll('a[href]').forEach((el: Element) => {
        const a = el as HTMLAnchorElement;
        try {
          const url = new URL(a.href, BASE_URL).href;
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            links.push({ url, text: a.textContent?.trim() || '', classification: 'external' });
          }
        } catch {}
      });

      return {
        sourceUrl: BASE_URL,
        timestamp: new Date().toISOString(),
        domain: location.hostname,
        images,
        videos,
        audio,
        links,
        text: {
          html: document.body.innerHTML.slice(0, 100_000),
          markdown: '',
          plainText: document.body.textContent?.trim() || '',
          title: document.title,
          headings: [],
          wordCount: 0,
          readingTimeMin: 0,
        },
        metadata: {
          title: document.title,
          description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
          canonicalUrl: BASE_URL,
          ogTags: {},
          twitterTags: {},
          jsonLd: [],
          microdata: [],
          language: document.documentElement.lang || '',
        },
        networkCaptures: [],
      };
    };
  }

  private isMediaUrl(url: string): boolean {
    return /\.(m3u8|mpd|mp4|webm|mp3|ogg|aac|ts)(\?|$)/i.test(url) ||
      url.includes('manifest') || url.includes('playlist');
  }

  private guessMimeType(url: string): string {
    if (url.includes('.m3u8')) return 'application/x-mpegurl';
    if (url.includes('.mpd')) return 'application/dash+xml';
    if (url.includes('.mp4')) return 'video/mp4';
    if (url.includes('.webm')) return 'video/webm';
    if (url.includes('.mp3')) return 'audio/mpeg';
    return 'video/mp4';
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}
