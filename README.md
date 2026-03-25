# Universal Web Scraper

A robust, universal website scraper composed of two parts:
1. **Chrome/Chromium Browser Extension** (Manifest V3 + TypeScript)
2. **Cross-platform Desktop Companion App** (Electron + React)

---

## Architecture

```
[User's Browser]
    ├── Extension (content scripts, background service worker, popup UI)
    │       │
    │       ├── DOM extraction (text, images, links, metadata)
    │       ├── Network interception (video streams, API calls, XHR)
    │       ├── Page interaction automation (scroll, click, wait)
    │       └── Sends structured data via WebSocket / Native Messaging
    │
[Local WebSocket ws://localhost:8789 / Native Messaging]
    │
[Desktop Companion App]
    ├── Download manager (concurrent, resumable, referer-aware)
    ├── Media processing (ffmpeg for HLS/DASH/video streams)
    ├── Storage engine (SQLite DB + organized file output)
    ├── Job queue & batch processing
    ├── Per-site rule engine (with presets for Twitter, Instagram, Reddit, etc.)
    ├── Headless browser fallback (Playwright)
    └── UI dashboard (Electron + React + Tailwind CSS)
```

---

## Repository Structure

```
universal-web-scraper/
├── extension/                   # Chrome/Chromium browser extension
│   ├── src/
│   │   ├── manifest.json
│   │   ├── background/          # Service worker (network interception, bridge)
│   │   ├── content/             # Content scripts (DOM extractor, interaction)
│   │   ├── popup/               # Extension popup (React UI)
│   │   ├── options/             # Settings page
│   │   ├── native-messaging/    # WebSocket/NativeMessaging bridge
│   │   └── shared/              # Shared types, utils, messaging helpers
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── desktop-app/                 # Electron desktop companion
│   ├── src/
│   │   ├── main/                # Electron main process
│   │   │   ├── index.ts         # App entry, IPC handlers, service init
│   │   │   ├── websocket-server.ts
│   │   │   ├── native-messaging-host.ts
│   │   │   ├── download-manager.ts
│   │   │   ├── ffmpeg-handler.ts
│   │   │   ├── job-queue.ts
│   │   │   ├── database.ts
│   │   │   ├── rule-engine.ts
│   │   │   ├── headless-scraper.ts
│   │   │   ├── post-processor.ts
│   │   │   └── proxy-manager.ts
│   │   ├── renderer/            # React UI
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── Downloads.tsx
│   │   │   │   ├── JobQueue.tsx
│   │   │   │   ├── RuleEditor.tsx
│   │   │   │   ├── BatchMode.tsx
│   │   │   │   └── Settings.tsx
│   │   │   └── App.tsx
│   │   ├── shared/              # Shared types (mirrored from extension)
│   │   └── preload.ts
│   ├── resources/
│   │   └── native-messaging-manifest.json
│   ├── package.json
│   ├── electron-builder.yml
│   └── tsconfig.json
│
└── package.json                 # Monorepo root
```

---

## Features

### Browser Extension

- **DOM Extraction**: Images, videos, audio, links, text, metadata
- **Image Sources**: `<img>`, `srcset`, `<picture>`, CSS backgrounds, `<canvas>`, Open Graph/Twitter Card
- **Video Detection**: `<video>`, iframes (YouTube/Vimeo/etc.), HLS `.m3u8`, DASH `.mpd`, JSON-LD VideoObject
- **Network Interception**: Catches video streams and media URLs before they appear in the DOM
- **Auto-Scroll**: Smooth scrolling with lazy-load triggering, configurable max scrolls
- **Load More Detection**: Heuristic clicking of "Show More" / "Load More" buttons
- **Shadow DOM Traversal**: Recursively extracts from shadow roots
- **Mutation Observer**: Incremental extraction of dynamically added content
- **Anti-Detection**: Overrides `navigator.webdriver`, patches fetch/XHR for media detection
- **Popup UI**: One-click extract, live preview, filtering options, send-to-app button
- **Communication**: WebSocket (default) or Chrome Native Messaging with chunked transfer

### Desktop App

- **Download Manager**: Configurable concurrency, HTTP Range resumption, retry with exponential backoff, per-domain rate limiting, deduplication by SHA-256
- **FFmpeg Integration**: HLS/DASH stream download, video transcoding, thumbnail generation, stream merging
- **SQLite Database**: Jobs, downloaded files (with dedup), site rules, settings
- **Job Queue**: Priority queue with persistent state, single/batch/scheduled/crawl job types
- **Rule Engine**: Per-site scraping rules with built-in presets for Twitter/X, Instagram, Reddit, YouTube, Pinterest, TikTok, Medium, Substack
- **Headless Scraper**: Playwright-based, stealth mode, proxy support, cookie import
- **Proxy Manager**: HTTP/HTTPS/SOCKS5, health checking, round-robin/random/least-used rotation
- **Post-Processor**: Thumbnail generation, EXIF stripping, OCR (Tesseract), format conversion
- **Dashboard UI**: Stats, recent downloads gallery, quick scrape input
- **Batch Mode**: URL list input, sitemap XML import, crawl depth control

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- ffmpeg (optional, for video stream download)
- Playwright Chromium (installed automatically via `npm install`)

### Install Dependencies

```bash
# Extension
cd extension
npm install

# Desktop App
cd ../desktop-app
npm install
```

### Build Extension

```bash
cd extension
npm run build
# Output: extension/dist/
```

Load as unpacked extension in Chrome:
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `extension/dist/`

### Run Desktop App

```bash
cd desktop-app
npm run dev       # Development mode
npm start         # Production mode (after build)
npm run package   # Build distributables
```

### Connect Extension to App

1. Start the desktop app
2. The WebSocket server starts automatically on `ws://localhost:8789`
3. The extension popup shows a green "App connected" indicator
4. Click **Extract Page** in the popup → results appear in the app

### Native Messaging (Alternative)

1. Build the desktop app: `npm run build`
2. Register the native messaging host:
   - Edit `resources/native-messaging-manifest.json` with the correct app path and extension ID
   - Copy to the appropriate location:
     - **Linux**: `~/.config/google-chrome/NativeMessagingHosts/`
     - **macOS**: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
     - **Windows**: Registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.universalscraper.host`
3. In the extension settings, switch to "Native Messaging" mode

---

## Per-Site Rules

Rules allow customizing extraction behavior per domain. Built-in presets include:

| Domain | Features |
|--------|----------|
| `twitter.com`, `x.com` | Auto-scroll, media extraction, thread support |
| `*.instagram.com` | Auth required, carousel detection |
| `*.reddit.com` | Auto-scroll, comment expansion |
| `youtube.com` | Video URL extraction, captions |
| `*.pinterest.com` | Full-res image extraction |
| `tiktok.com` | Watermark-free video URL detection |
| `*.medium.com` | Article extraction, paywall patterns |
| `*.substack.com` | Post content extraction |

Rules are editable in the **Rule Editor** page of the desktop app.

---

## Data Flow

```
User clicks "Extract Page"
    → Content script extracts DOM (images, videos, links, text, metadata)
    → Background service worker intercepts network requests (HLS/DASH/media URLs)
    → Combined ExtractionPayload sent to desktop app via WebSocket
    → Desktop app processes extraction:
        - Creates a ScrapeJob in SQLite
        - Downloads images via DownloadManager (concurrent, resumable)
        - Downloads HLS/DASH streams via FFmpeg
        - Records DownloadedFile entries with content hash (dedup)
        - Generates thumbnails via PostProcessor
    → UI updates: new files appear in Downloads gallery
```

---

## Privacy & Security

- All data stays local — no external servers
- Communication is localhost-only (WebSocket `127.0.0.1:8789` or stdin/stdout native messaging)
- No telemetry or tracking
- Users are responsible for complying with website terms of service and applicable laws

---

## Development

```bash
# Run tests (not yet implemented — see Phase 6)
npm test

# Type check
cd extension && npm run type-check
cd desktop-app && npm run type-check
```

### Development Order (per master spec)

- [x] Phase 1: Core Extension — manifest, extractor, popup, background SW
- [x] Phase 2: Desktop App Foundation — Electron, WebSocket, download manager, SQLite
- [x] Phase 3: Integration — WebSocket bridge, native messaging
- [x] Phase 4: Advanced Extraction — network interceptor, HLS/DASH, auto-scroll, mutation observer
- [x] Phase 5: Power Features — rule engine (presets), job queue, headless browser, proxy manager, post-processor
- [x] Phase 6: Polish — settings UI, packaging config, electron-builder setup

---

## License

MIT
