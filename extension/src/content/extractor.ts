import type {
  ExtractedImage,
  ExtractedVideo,
  ExtractedAudio,
  ExtractedLink,
  ExtractedText,
  PageMetadata,
  ExtractionOptions,
} from '../shared/types';
import {
  resolveUrl,
  extractDomain,
} from '../shared/messaging';
import {
  stripTags,
  htmlToMarkdown,
  parseSrcset,
  isDownloadUrl,
  detectVideoPlatform,
  isHlsUrl,
  isDashUrl,
  countWords,
  estimateReadingTime,
} from '../shared/utils';

const BASE_URL = location.href;
const DOMAIN = extractDomain(BASE_URL);

// Track already-extracted elements to prevent duplicates
const extractedElements = new WeakSet<Element>();

// ─── Image Extraction ─────────────────────────────────────────────────────────

export function extractImages(
  root: Document | Element = document,
  minWidth = 50,
  minHeight = 50
): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const seenUrls = new Set<string>();

  function addImage(img: ExtractedImage) {
    if (!img.url || img.url.startsWith('data:') && img.url.length > 100_000) return;
    if (seenUrls.has(img.url)) return;
    if (img.width !== undefined && img.width < minWidth) return;
    if (img.height !== undefined && img.height < minHeight) return;
    seenUrls.add(img.url);
    images.push(img);
  }

  // <img> elements
  const imgs = root.querySelectorAll('img');
  imgs.forEach(el => {
    const src = el.getAttribute('src') ?? el.getAttribute('data-src') ??
      el.getAttribute('data-lazy-src') ?? el.getAttribute('data-original') ?? '';
    if (!src) return;
    const url = resolveUrl(src, BASE_URL);
    const srcsetAttr = el.getAttribute('srcset') ?? el.getAttribute('data-srcset') ?? '';
    addImage({
      url,
      alt: el.alt ?? '',
      width: el.naturalWidth || el.width || undefined,
      height: el.naturalHeight || el.height || undefined,
      srcset: srcsetAttr ? parseSrcset(srcsetAttr) : undefined,
      context: el.parentElement?.tagName?.toLowerCase() ?? '',
      sourceType: 'img',
    });
  });

  // <picture> + <source> elements
  const pictures = root.querySelectorAll('picture');
  pictures.forEach(pic => {
    pic.querySelectorAll('source').forEach(src => {
      const srcset = src.getAttribute('srcset') ?? '';
      parseSrcset(srcset).forEach(url => {
        addImage({
          url: resolveUrl(url, BASE_URL),
          alt: pic.querySelector('img')?.alt ?? '',
          context: 'picture',
          sourceType: 'picture',
        });
      });
    });
  });

  // CSS background images — walk all elements
  try {
    const allEls = root.querySelectorAll('*');
    allEls.forEach(el => {
      const style = getComputedStyle(el);
      const bg = style.backgroundImage;
      if (bg && bg !== 'none') {
        const matches = bg.matchAll(/url\(["']?([^"')]+)["']?\)/g);
        for (const match of matches) {
          const url = resolveUrl(match[1], BASE_URL);
          if (url) {
            addImage({
              url,
              alt: '',
              context: `${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]}`,
              sourceType: 'css-bg',
            });
          }
        }
      }
    });
  } catch {}

  // <canvas> elements — capture as data URLs
  const canvases = root.querySelectorAll('canvas');
  canvases.forEach(canvas => {
    try {
      const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png');
      if (dataUrl && dataUrl !== 'data:,') {
        addImage({
          url: dataUrl,
          alt: 'canvas-capture',
          width: canvas.width,
          height: canvas.height,
          context: 'canvas',
          sourceType: 'canvas',
        });
      }
    } catch {}
  });

  // Open Graph / Twitter card images from <meta>
  const metaImages = [
    ...Array.from(document.querySelectorAll('meta[property="og:image"], meta[name="og:image"]')),
    ...Array.from(document.querySelectorAll('meta[name="twitter:image"], meta[name="twitter:image:src"]')),
  ];
  metaImages.forEach(meta => {
    const content = meta.getAttribute('content') ?? '';
    if (content) {
      addImage({
        url: resolveUrl(content, BASE_URL),
        alt: 'og/twitter-image',
        context: 'meta',
        sourceType: 'og',
      });
    }
  });

  // Favicon
  const faviconEl = document.querySelector('link[rel~="icon"]');
  if (faviconEl) {
    const href = faviconEl.getAttribute('href') ?? '';
    if (href) {
      addImage({
        url: resolveUrl(href, BASE_URL),
        alt: 'favicon',
        context: 'favicon',
        sourceType: 'og',
      });
    }
  }

  // Shadow DOM traversal
  try {
    const allEls = root.querySelectorAll('*');
    allEls.forEach(el => {
      if ((el as Element & { shadowRoot?: ShadowRoot }).shadowRoot) {
        const shadowImgs = extractImages(
          (el as Element & { shadowRoot: ShadowRoot }).shadowRoot,
          minWidth,
          minHeight
        );
        shadowImgs.forEach(img => addImage(img));
      }
    });
  } catch {}

  return images;
}

// ─── Video & Audio Extraction ─────────────────────────────────────────────────

export function extractVideos(root: Document | Element = document): ExtractedVideo[] {
  const videos: ExtractedVideo[] = [];
  const seenUrls = new Set<string>();

  function addVideo(v: ExtractedVideo) {
    if (!v.url || seenUrls.has(v.url)) return;
    seenUrls.add(v.url);
    videos.push(v);
  }

  // <video> elements
  root.querySelectorAll('video').forEach(el => {
    const src = el.src ?? el.getAttribute('src') ?? '';
    if (src) {
      const url = resolveUrl(src, BASE_URL);
      addVideo({
        url,
        type: isHlsUrl(url) ? 'hls' : isDashUrl(url) ? 'dash' : 'direct',
        mimeType: el.type || undefined,
        duration: el.duration || undefined,
        posterUrl: el.poster ? resolveUrl(el.poster, BASE_URL) : undefined,
      });
    }
    // <source> children
    el.querySelectorAll('source').forEach(source => {
      const sourceUrl = source.src ?? source.getAttribute('src') ?? '';
      if (sourceUrl) {
        const url = resolveUrl(sourceUrl, BASE_URL);
        addVideo({
          url,
          type: isHlsUrl(url) ? 'hls' : isDashUrl(url) ? 'dash' : 'direct',
          mimeType: source.type || undefined,
          duration: el.duration || undefined,
          posterUrl: el.poster ? resolveUrl(el.poster, BASE_URL) : undefined,
        });
      }
    });
  });

  // <iframe> embeds — detect known video platforms
  root.querySelectorAll('iframe').forEach(el => {
    const src = el.src ?? el.getAttribute('src') ?? el.getAttribute('data-src') ?? '';
    if (!src) return;
    const url = resolveUrl(src, BASE_URL);
    const platform = detectVideoPlatform(url);
    if (platform) {
      addVideo({
        url,
        type: 'embed',
        platform,
      });
    }
  });

  // OG video meta
  document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"]').forEach(meta => {
    const content = meta.getAttribute('content') ?? '';
    if (content) {
      const url = resolveUrl(content, BASE_URL);
      addVideo({
        url,
        type: isHlsUrl(url) ? 'hls' : isDashUrl(url) ? 'dash' : 'direct',
      });
    }
  });

  // JSON-LD VideoObject
  document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'VideoObject') {
          const contentUrl = item.contentUrl ?? item.embedUrl ?? '';
          if (contentUrl) {
            addVideo({
              url: resolveUrl(contentUrl, BASE_URL),
              type: 'direct',
              duration: item.duration ? parseDuration(item.duration) : undefined,
              thumbnailUrl: item.thumbnailUrl,
            });
          }
        }
      }
    } catch {}
  });

  return videos;
}

function parseDuration(iso: string): number {
  // Parse ISO 8601 duration PT1H2M3S → seconds
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (Number(match[1] ?? 0) * 3600) + (Number(match[2] ?? 0) * 60) + Number(match[3] ?? 0);
}

export function extractAudio(root: Document | Element = document): ExtractedAudio[] {
  const audio: ExtractedAudio[] = [];
  const seenUrls = new Set<string>();

  root.querySelectorAll('audio').forEach(el => {
    const src = el.src ?? el.getAttribute('src') ?? '';
    if (src && !seenUrls.has(src)) {
      seenUrls.add(src);
      audio.push({
        url: resolveUrl(src, BASE_URL),
        mimeType: el.type || undefined,
        duration: el.duration || undefined,
      });
    }
    el.querySelectorAll('source').forEach(source => {
      const sourceSrc = source.src ?? source.getAttribute('src') ?? '';
      if (sourceSrc && !seenUrls.has(sourceSrc)) {
        seenUrls.add(sourceSrc);
        audio.push({
          url: resolveUrl(sourceSrc, BASE_URL),
          mimeType: source.type || undefined,
          duration: el.duration || undefined,
        });
      }
    });
  });

  return audio;
}

// ─── Link Extraction ──────────────────────────────────────────────────────────

export function extractLinks(root: Document | Element = document): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seenUrls = new Set<string>();

  root.querySelectorAll('a[href]').forEach(el => {
    const href = el.getAttribute('href') ?? '';
    if (!href || href.startsWith('#')) {
      // Anchor link
      if (href.startsWith('#')) {
        const url = `${BASE_URL.split('#')[0]}${href}`;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          links.push({
            url,
            text: (el.textContent ?? '').trim(),
            rel: el.getAttribute('rel') ?? undefined,
            classification: 'anchor',
          });
        }
      }
      return;
    }

    if (href.startsWith('mailto:')) {
      links.push({ url: href, text: (el.textContent ?? '').trim(), classification: 'mailto' });
      return;
    }
    if (href.startsWith('tel:')) {
      links.push({ url: href, text: (el.textContent ?? '').trim(), classification: 'tel' });
      return;
    }

    try {
      const url = new URL(href, BASE_URL).href;
      if (seenUrls.has(url)) return;
      seenUrls.add(url);

      const linkDomain = extractDomain(url);
      let classification: ExtractedLink['classification'];
      if (isDownloadUrl(url)) {
        classification = 'download';
      } else if (linkDomain === DOMAIN || linkDomain === '') {
        classification = 'internal';
      } else {
        classification = 'external';
      }

      links.push({
        url,
        text: (el.textContent ?? '').trim().slice(0, 200),
        rel: el.getAttribute('rel') ?? undefined,
        classification,
      });
    } catch {}
  });

  return links;
}

// ─── Text Extraction ──────────────────────────────────────────────────────────

// Elements to remove for clean article extraction
const NOISE_SELECTORS = [
  'nav', 'header', 'footer', 'aside', '.sidebar', '.advertisement', '.ad',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  'script', 'style', 'noscript', 'iframe', '.cookie-banner', '.popup',
  '.social-share', '.related-articles', '.comments', '#comments',
].join(',');

export function extractText(): ExtractedText {
  const title = document.title;

  // Clone document to safely manipulate
  const clone = document.body.cloneNode(true) as HTMLElement;

  // Remove noise elements
  try {
    clone.querySelectorAll(NOISE_SELECTORS).forEach(el => el.remove());
  } catch {}

  // Try to find main content area
  const mainSelectors = ['article', 'main', '[role="main"]', '.content', '.article-body', '.post-content', '#content'];
  let contentEl: HTMLElement = clone;
  for (const sel of mainSelectors) {
    const found = clone.querySelector(sel);
    if (found) {
      contentEl = found as HTMLElement;
      break;
    }
  }

  const html = contentEl.innerHTML;
  const markdown = htmlToMarkdown(html);
  const plainText = (contentEl.textContent ?? '').replace(/\s{2,}/g, ' ').trim();

  // Extract headings
  const headings: { level: number; text: string }[] = [];
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => {
    headings.push({
      level: parseInt(el.tagName[1], 10),
      text: (el.textContent ?? '').trim(),
    });
  });

  const wordCount = countWords(plainText);
  const readingTimeMin = estimateReadingTime(plainText);

  return { html, markdown, plainText, title, headings, wordCount, readingTimeMin };
}

// ─── Metadata Extraction ──────────────────────────────────────────────────────

export function extractMetadata(): PageMetadata {
  const title = document.title;
  const description =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ??
    document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '';

  const canonicalEl = document.querySelector('link[rel="canonical"]');
  const canonicalUrl = canonicalEl?.getAttribute('href')
    ? resolveUrl(canonicalEl.getAttribute('href')!, BASE_URL)
    : BASE_URL;

  // OG tags
  const ogTags: Record<string, string> = {};
  document.querySelectorAll('meta[property^="og:"]').forEach(meta => {
    const prop = meta.getAttribute('property') ?? '';
    const content = meta.getAttribute('content') ?? '';
    if (prop && content) ogTags[prop.slice(3)] = content;
  });

  // Twitter tags
  const twitterTags: Record<string, string> = {};
  document.querySelectorAll('meta[name^="twitter:"]').forEach(meta => {
    const name = meta.getAttribute('name') ?? '';
    const content = meta.getAttribute('content') ?? '';
    if (name && content) twitterTags[name.slice(8)] = content;
  });

  // JSON-LD
  const jsonLd: object[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    try {
      const data = JSON.parse(script.textContent ?? '');
      if (Array.isArray(data)) jsonLd.push(...data);
      else jsonLd.push(data);
    } catch {}
  });

  // Microdata
  const microdata: object[] = [];
  document.querySelectorAll('[itemscope]').forEach(el => {
    const item: Record<string, string | string[]> = {};
    const type = el.getAttribute('itemtype') ?? '';
    if (type) item['@type'] = type;
    el.querySelectorAll('[itemprop]').forEach(prop => {
      const name = prop.getAttribute('itemprop') ?? '';
      const value =
        prop.getAttribute('content') ??
        prop.getAttribute('href') ??
        prop.getAttribute('src') ??
        prop.textContent ?? '';
      if (name && value) item[name] = value.trim();
    });
    if (Object.keys(item).length > 1) microdata.push(item);
  });

  const language =
    document.documentElement.getAttribute('lang') ??
    document.querySelector('meta[http-equiv="Content-Language"]')?.getAttribute('content') ?? '';

  const author =
    document.querySelector('meta[name="author"]')?.getAttribute('content') ??
    document.querySelector('[rel="author"]')?.textContent ?? undefined;

  const publishedDate =
    document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ??
    document.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined;

  const keywordsEl = document.querySelector('meta[name="keywords"]');
  const keywords = keywordsEl?.getAttribute('content')?.split(',').map(k => k.trim()) ?? [];

  return {
    title,
    description,
    canonicalUrl,
    ogTags,
    twitterTags,
    jsonLd,
    microdata,
    language,
    author: author?.trim(),
    publishedDate,
    keywords,
  };
}

// ─── Incremental Extraction (for MutationObserver) ───────────────────────────

export function extractFromNodes(
  nodes: NodeList,
  minWidth = 50,
  minHeight = 50
): { images: ExtractedImage[]; videos: ExtractedVideo[]; links: ExtractedLink[] } {
  const images: ExtractedImage[] = [];
  const videos: ExtractedVideo[] = [];
  const links: ExtractedLink[] = [];

  nodes.forEach(node => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (extractedElements.has(el)) return;
    extractedElements.add(el);

    images.push(...extractImages(el, minWidth, minHeight));
    videos.push(...extractVideos(el));
    links.push(...extractLinks(el));
  });

  return { images, videos, links };
}
