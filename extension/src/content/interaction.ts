/**
 * Page interaction automation — auto-scroll, click expanders, wait utilities.
 */

import { sleep } from '../shared/utils';

// ─── Wait Utilities ───────────────────────────────────────────────────────────

/**
 * Wait for a selector to appear in the DOM.
 */
export function waitForSelector(selector: string, timeout = 5000): Promise<Element | null> {
  return new Promise(resolve => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

/**
 * Wait until no new network requests have fired for `idleMs` milliseconds.
 * Since content scripts can't observe network directly, we approximate with
 * a settled DOM state check.
 */
export function waitForNetworkIdle(idleMs = 1500): Promise<void> {
  return new Promise(resolve => {
    let lastActivity = Date.now();
    let settled = false;

    const origFetch = window.fetch.bind(window);
    const origXhrOpen = XMLHttpRequest.prototype.open;

    const bump = () => { lastActivity = Date.now(); };

    try {
      window.fetch = function (...args: Parameters<typeof fetch>) {
        bump();
        return origFetch(...args);
      };
      XMLHttpRequest.prototype.open = function (...args: Parameters<typeof XMLHttpRequest.prototype.open>) {
        bump();
        return origXhrOpen.apply(this, args);
      };
    } catch {}

    const interval = setInterval(() => {
      if (!settled && Date.now() - lastActivity >= idleMs) {
        settled = true;
        clearInterval(interval);
        try {
          window.fetch = origFetch;
          XMLHttpRequest.prototype.open = origXhrOpen;
        } catch {}
        resolve();
      }
    }, 200);

    // Fallback timeout after 30s
    setTimeout(() => {
      if (!settled) {
        settled = true;
        clearInterval(interval);
        resolve();
      }
    }, 30_000);
  });
}

/**
 * Wait until the DOM stops mutating for `idleMs` ms.
 */
export function waitForMutationIdle(idleMs = 1000): Promise<void> {
  return new Promise(resolve => {
    let lastMutation = Date.now();
    const observer = new MutationObserver(() => { lastMutation = Date.now(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    const interval = setInterval(() => {
      if (Date.now() - lastMutation >= idleMs) {
        clearInterval(interval);
        observer.disconnect();
        resolve();
      }
    }, 200);

    setTimeout(() => {
      clearInterval(interval);
      observer.disconnect();
      resolve();
    }, 30_000);
  });
}

// ─── Auto-Scroller ────────────────────────────────────────────────────────────

let scrollCancelled = false;

export function cancelScroll() {
  scrollCancelled = true;
}

export interface AutoScrollOptions {
  maxScrolls?: number;
  scrollDelay?: number;
  onProgress?: (scrollsCompleted: number, newContentFound: boolean) => void;
}

/**
 * Smoothly scroll to the bottom of the page in increments,
 * waiting between each scroll for new content to load.
 */
export async function autoScroll(options: AutoScrollOptions = {}): Promise<void> {
  const { maxScrolls = 20, scrollDelay = 800, onProgress } = options;
  scrollCancelled = false;

  let scrollCount = 0;

  while (scrollCount < maxScrolls && !scrollCancelled) {
    const prevHeight = document.body.scrollHeight;

    // Scroll by one viewport height
    window.scrollBy({
      top: window.innerHeight,
      behavior: 'smooth',
    });

    // Also fire wheel and scroll events manually to trigger lazy loaders
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    document.dispatchEvent(new Event('scroll', { bubbles: true }));

    await sleep(scrollDelay);

    if (scrollCancelled) break;

    const newHeight = document.body.scrollHeight;
    const newContentFound = newHeight > prevHeight;

    scrollCount++;
    onProgress?.(scrollCount, newContentFound);

    // If we're at the bottom and no new content appeared, we're done
    const scrolledToBottom =
      window.scrollY + window.innerHeight >= document.body.scrollHeight - 100;
    if (scrolledToBottom && !newContentFound) break;
  }
}

// ─── Click Expander ───────────────────────────────────────────────────────────

// Common text patterns for "load more" buttons
const LOAD_MORE_PATTERNS = [
  /load\s+more/i,
  /show\s+more/i,
  /see\s+more/i,
  /view\s+more/i,
  /read\s+more/i,
  /more\s+posts/i,
  /more\s+items/i,
  /expand/i,
  /show\s+all/i,
];

const LOAD_MORE_SELECTORS = [
  '[data-action="load-more"]',
  '[class*="load-more"]',
  '[class*="loadmore"]',
  '[class*="show-more"]',
  '[class*="read-more"]',
  '[id*="load-more"]',
  '.pagination a[rel="next"]',
  'a[aria-label*="next" i]',
  'button[aria-label*="load more" i]',
].join(',');

/**
 * Find and click "Load More" / "Show More" style buttons.
 * Returns true if any button was clicked.
 */
export async function clickLoadMore(customSelectors?: string[]): Promise<boolean> {
  let clicked = false;

  // Check common selectors
  const selectorList = customSelectors
    ? [LOAD_MORE_SELECTORS, ...customSelectors].join(',')
    : LOAD_MORE_SELECTORS;

  try {
    const els = document.querySelectorAll(selectorList);
    for (const el of els) {
      if (isVisible(el)) {
        (el as HTMLElement).click();
        clicked = true;
        await sleep(300);
      }
    }
  } catch {}

  // Also search by text content
  const buttons = document.querySelectorAll('button, a[role="button"], [role="button"]');
  for (const btn of buttons) {
    const text = (btn.textContent ?? '').trim();
    if (LOAD_MORE_PATTERNS.some(p => p.test(text)) && isVisible(btn)) {
      (btn as HTMLElement).click();
      clicked = true;
      await sleep(300);
    }
  }

  return clicked;
}

/**
 * Expand all collapsed sections, accordions, spoilers.
 */
export async function expandCollapsedSections(): Promise<void> {
  const COLLAPSED_SELECTORS = [
    'details:not([open])',
    '[aria-expanded="false"]',
    '[data-collapsed="true"]',
    '.collapsed',
    '.spoiler',
  ].join(',');

  const els = document.querySelectorAll(COLLAPSED_SELECTORS);
  for (const el of els) {
    if (isVisible(el)) {
      if (el.tagName === 'DETAILS') {
        (el as HTMLDetailsElement).open = true;
      } else {
        (el as HTMLElement).click();
        await sleep(100);
      }
    }
  }
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

// ─── Gallery Navigator ────────────────────────────────────────────────────────

/**
 * If a lightbox/gallery is open, navigate through all items and collect URLs.
 */
export async function extractGalleryItems(): Promise<string[]> {
  const urls: string[] = [];

  const NEXT_SELECTORS = [
    '[aria-label*="next" i]',
    '[class*="next"]',
    '[class*="arrow-right"]',
    'button[data-action="next"]',
    '.slick-next',
    '.swiper-button-next',
  ].join(',');

  const MAX_GALLERY_ITEMS = 100;
  let attempts = 0;

  while (attempts < MAX_GALLERY_ITEMS) {
    // Capture current visible image
    const visibleImg = document.querySelector(
      '.lightbox img, .gallery-modal img, [role="dialog"] img, .modal img'
    ) as HTMLImageElement | null;
    if (visibleImg?.src) {
      const url = visibleImg.src;
      if (!urls.includes(url)) {
        urls.push(url);
      } else {
        break; // We've looped
      }
    }

    const nextBtn = document.querySelector(NEXT_SELECTORS) as HTMLElement | null;
    if (!nextBtn || !isVisible(nextBtn)) break;

    nextBtn.click();
    await sleep(500);
    attempts++;
  }

  return urls;
}
