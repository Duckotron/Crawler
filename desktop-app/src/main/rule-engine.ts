import type { SiteRule, SiteRuleConfig } from '../shared/types';
import { upsertRule, getRules, findRuleForDomain, deleteRule } from './database';
import { generateId } from '../shared/utils';

// ─── Built-in site rule presets ───────────────────────────────────────────────

const BUILT_IN_RULES: Omit<SiteRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    domainPattern: 'twitter.com',
    ruleConfig: {
      behavior: { autoScroll: true, maxScrolls: 30, waitForSelector: '[data-testid="tweet"]' },
      selectors: {
        content: '[data-testid="primaryColumn"]',
        images: '[data-testid="tweetPhoto"] img',
        removeElements: ['[data-testid="sidebarColumn"]', 'nav'],
      },
    },
  },
  {
    domainPattern: 'x.com',
    ruleConfig: {
      behavior: { autoScroll: true, maxScrolls: 30, waitForSelector: '[data-testid="tweet"]' },
      selectors: {
        content: '[data-testid="primaryColumn"]',
        images: '[data-testid="tweetPhoto"] img',
        removeElements: ['[data-testid="sidebarColumn"]', 'nav'],
      },
    },
  },
  {
    domainPattern: '*.instagram.com',
    ruleConfig: {
      behavior: { autoScroll: true, maxScrolls: 20, requiresAuth: true, waitForSelector: 'article' },
      selectors: {
        content: 'article',
        images: 'article img',
        loadMore: 'button[aria-label*="Load more"]',
      },
    },
  },
  {
    domainPattern: '*.reddit.com',
    ruleConfig: {
      behavior: { autoScroll: true, maxScrolls: 15, waitForSelector: '[data-testid="post-container"]' },
      selectors: {
        content: '[data-testid="post-container"]',
        loadMore: 'button[id*="more-comments"]',
        removeElements: ['.sidebar', '.ad-container'],
      },
    },
  },
  {
    domainPattern: 'youtube.com',
    ruleConfig: {
      behavior: { waitForSelector: '#player-container', requiresAuth: false },
      selectors: { content: '#player-container' },
      extraction: {
        videoUrlPattern: '\\.googlevideo\\.com',
        apiEndpoint: '/api/timedtext',
      },
    },
  },
  {
    domainPattern: '*.pinterest.com',
    ruleConfig: {
      behavior: { autoScroll: true, maxScrolls: 25, waitForSelector: '[data-test-id="pin-image"]' },
      selectors: {
        images: '[data-test-id="pin-image"] img, [data-test-id="closeup-image"] img',
      },
    },
  },
  {
    domainPattern: 'tiktok.com',
    ruleConfig: {
      behavior: { autoScroll: true, maxScrolls: 10, requiresAuth: false },
      extraction: {
        videoUrlPattern: '(tiktok\\.com|tikcdn\\.io).*\\.mp4',
      },
    },
  },
  {
    domainPattern: '*.medium.com',
    ruleConfig: {
      behavior: { waitForSelector: 'article', autoScroll: false },
      selectors: {
        content: 'article',
        removeElements: ['[data-testid="paywall"]', '.speechify-ignore', 'nav', 'footer'],
      },
    },
  },
  {
    domainPattern: '*.substack.com',
    ruleConfig: {
      behavior: { waitForSelector: '.post-content' },
      selectors: {
        content: '.post-content',
        removeElements: ['.paywall', '.subscribe-widget'],
      },
    },
  },
];

export class RuleEngine {
  private cachedRules: SiteRule[] = [];
  private cacheTime = 0;
  private readonly CACHE_TTL = 5000; // ms

  /**
   * Seed the database with built-in rule presets if not already present.
   */
  seedBuiltInRules(): void {
    const now = new Date().toISOString();
    for (const preset of BUILT_IN_RULES) {
      const existing = findRuleForDomain(preset.domainPattern);
      if (!existing) {
        upsertRule({
          id: generateId(),
          domainPattern: preset.domainPattern,
          ruleConfig: preset.ruleConfig,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  /**
   * Get the best matching rule for a given domain.
   */
  getRuleForDomain(domain: string): SiteRule | null {
    return findRuleForDomain(domain);
  }

  /**
   * Get all rules.
   */
  getAllRules(): SiteRule[] {
    const now = Date.now();
    if (now - this.cacheTime < this.CACHE_TTL) return this.cachedRules;
    this.cachedRules = getRules();
    this.cacheTime = now;
    return this.cachedRules;
  }

  /**
   * Save or update a rule.
   */
  saveRule(domainPattern: string, config: SiteRuleConfig): SiteRule {
    const now = new Date().toISOString();
    const rule: SiteRule = {
      id: generateId(),
      domainPattern,
      ruleConfig: config,
      createdAt: now,
      updatedAt: now,
    };
    upsertRule(rule);
    this.cacheTime = 0; // Invalidate cache
    return rule;
  }

  /**
   * Delete a rule by id.
   */
  removeRule(id: string): void {
    deleteRule(id);
    this.cacheTime = 0;
  }

  /**
   * Export all rules as JSON.
   */
  exportRules(): string {
    return JSON.stringify(this.getAllRules(), null, 2);
  }

  /**
   * Import rules from a JSON string.
   */
  importRules(json: string): number {
    const rules = JSON.parse(json) as SiteRule[];
    const now = new Date().toISOString();
    let count = 0;
    for (const rule of rules) {
      try {
        upsertRule({ ...rule, updatedAt: now });
        count++;
      } catch {}
    }
    this.cacheTime = 0;
    return count;
  }

  /**
   * Match a domain pattern like *.example.com against a hostname.
   */
  static matchDomain(hostname: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return hostname.endsWith(suffix) || hostname === suffix.slice(1);
    }
    return hostname === pattern;
  }
}
