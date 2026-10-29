# Bandcamp Free & Name-Your-Price Bulk Downloader (Chrome Extension & Simulator)

A Chrome-compatible extension and companion web simulator designed to scan Bandcamp artist discographies, filter for free-to-download and name-your-price ($0.00) albums, allow checkbox selection and audio format customization, and batch-download audio files individually or bundled in a single ZIP archive.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were confirmed based on your requirements and initial feedback:

- **Confirmed Mode**: Dual-delivery model featuring both an **in-browser interactive scanner/simulator** (for testing with live or proxy crawling against `https://esoctrilihum.bandcamp.com/music`) and a **ready-to-install Manifest V3 Chrome Extension package** with one-click `.zip` export.
- **Confirmed Email Handling**: An auto-fill fallback email setting is provided to seamlessly resolve "Name Your Price" releases where Bandcamp requires an email address to issue a $0 download token.
- **Confirmed Download Delivery**: Users can choose between triggering sequential individual browser downloads or packing all selected releases into an organized `.zip` archive.
- **Scope Restriction**: Only main discography pages and album sub-pages are crawled; individual single-track sub-pages belonging to already-cataloged albums are skipped to optimize scan speed and avoid duplicate downloads.

---

### 1. Overview & Core Concept

- **What It Does**: Scans a Bandcamp artist's `/music` or discography page, visits every album and standalone release page, identifies free downloads (explicit "Free Download" or "$0.00 Name Your Price"), extracts album metadata (title, artwork, release date, track list, price model), presents an interactive selection table with filters, and executes bulk downloads in the chosen audio format (MP3 320k, FLAC, AAC, ALAC, WAV, AIFF).
- **Target Audience**: Music collectors, archival listeners, and fans supporting underground and independent artists who offer free or pay-what-you-want digital discographies.
- **Key Value**: Replaces the tedious manual process of clicking each album, typing "$0", submitting an email, clicking the download link, choosing the format, and repeating 20+ times for large discographies like *Esoctrilihum*.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Targeting & Discovery**:
   - The user enters a Bandcamp URL (pre-filled with `https://esoctrilihum.bandcamp.com/music`) or clicks "Scan Current Page" in the extension popup.
   - The scanner displays live discovery progress (e.g., "Found 18 releases · Scanning album 4/18").
2. **Review & Selection**:
   - A high-density discography grid and table shows cover art, album title, release year, price tag (`Free` / `Name Your Price $0`), and download availability.
   - Controls allow one-click "Select All Free", "Select All NYP", or fine-grained individual checkbox toggles.
3. **Format & Options**:
   - Format selector pills: **MP3 320**, **FLAC**, **AAC**, **WAV**, **AIFF**, **ALAC**.
   - Output preference toggle: **Bundled ZIP** vs. **Individual Downloads**.
4. **Bulk Download Execution**:
   - Real-time queue showing percentage, download speed, active stream, retry button, and overall completion notice.
5. **Extension Center & Exporter**:
   - A dedicated tab allowing one-click download of the complete `bandcamp-downloader-extension.zip` with manifest, background service worker, content scripts, and options page ready to load unpacked into Chrome (`chrome://extensions`).

#### Visual Identity & Theme
- **Aesthetic Direction**: High-contrast dark music production console, drawing inspiration from Bandcamp's minimalist black/teal brand aesthetics combined with modern utilitarian audio tools.
- **Color Palette**:
  - Dominant Neutral: Deep obsidian canvas (`#0b0f17`) with rich slate structural cards (`#131c2e`, hairline border `#1e293b`).
  - Brand Accent: Bandcamp Cyan/Teal (`#1da0c3` / `#00b4d8`) for active selection, download progress, and primary actions.
  - Semantic Badges: Subtle emerald (`#10b981`) for 100% Free releases, amber (`#f59e0b`) for Name Your Price ($0).
- **Typography**: `Plus Jakarta Sans` for display titles and navigation, paired with `JetBrains Mono` / `tabular-nums` for scan counters, download speeds, file sizes, and audio bitrates.
- **Anti-Slop Discipline**: No decorative floating pill chips or fake telemetry tickers; all metrics are real scan numbers and active byte transfers.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual Architecture (Live Web Simulator + Chrome Extension Source)**
  - *Chosen Approach*: Build a full-stack preview application with Express proxy endpoints for live scraping and testing in the AI Studio environment, paired with an extension code generator and ZIP bundler.
  - *Why*: The AI Studio preview runs inside a sandboxed iframe where browser extension APIs (`chrome.downloads`, `chrome.tabs`) are not natively present. Building both allows instant interactive testing of `https://esoctrilihum.bandcamp.com/music` right in the browser while providing the actual working Chrome extension for day-to-day browser usage.
- **Decision 2: Direct Bandcamp Tralbum Parsing**
  - *Chosen Approach*: Parse Bandcamp's embedded `data-tralbum` HTML attribute and `TralbumData` JavaScript objects rather than relying solely on DOM selectors.
  - *Why*: Bandcamp stores the canonical `freeDownloadPage`, package IDs, download preference flags, and release metadata directly in structured JSON in page markup, making extraction resilient against visual theme variations across artist pages.
- **Decision 3: Server-Side & Client-Side Download Engine**
  - *Chosen Approach*: Provide client-side JSZip packaging for browser downloads in the web simulator, while generating native `chrome.downloads` queue orchestration in the extension background script.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       BANDCAMP BULK DOWNLOAD SUITE                          │
├──────────────────────────────────────┬──────────────────────────────────────┤
│        WEB SIMULATOR & TESTBED       │     CHROME EXTENSION (MANIFEST V3)   │
│                                      │                                      │
│  ┌────────────────────────────────┐  │  ┌────────────────────────────────┐  │
│  │ React Frontend (App.tsx)       │  │  │ Popup UI (popup.html / .js)    │  │
│  │ - URL Input & Quick Templates  │  │  │ - Quick Scan Active Tab        │  │
│  │ - Album Selection Table & Grid │  │  │ - Format Selector (FLAC, MP3)  │  │
│  │ - Format & Delivery Controls   │  │  │ - Queue Visualizer             │  │
│  │ - Download Progress Manager    │  │  └───────────────┬────────────────┘  │
│  │ - Extension Package Exporter   │  │                  │ chrome.runtime    │
│  └────────────────┬───────────────┘  │  ┌───────────────▼────────────────┐  │
│                   │ /api/proxy/*     │  │ Background Service Worker      │  │
│  ┌────────────────▼───────────────┐  │  │ - CORS-free fetch of subpages  │  │
│  │ Express Server (server.ts)     │  │  │ - chrome.downloads API queue   │  │
│  │ - /api/scan: Deep discography  │  │  │ - Email token generator ($0)   │  │
│  │ - /api/resolve-download: $0 key│  │  └───────────────┬────────────────┘  │
│  │ - /api/export-extension: .zip  │  │                  │ chrome.tabs       │
│  └────────────────────────────────┘  │  ┌───────────────▼────────────────┐  │
│                                      │  │ Content Script (content.js)    │  │
│                                      │  │ - Bandcamp DOM & TralbumData   │  │
│                                      │  └────────────────────────────────┘  │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

#### Key Entities & State Model
- **`BandcampRelease`**:
  - `id`: Unique release identifier (album or track ID).
  - `title`: Album / track title.
  - `artist`: Artist name (e.g., Esoctrilihum).
  - `url`: Canonical URL to release page.
  - `coverArtUrl`: High-res album artwork.
  - `releaseDate`: Formatted release date string.
  - `type`: `'album'` | `'track'`.
  - `isFree`: Boolean (unconditionally free).
  - `isNameYourPrice`: Boolean (minimum price is 0).
  - `requiresEmail`: Boolean.
  - `downloadPageUrl`: Resolved free download link or null.
  - `trackCount`: Number of tracks in release.
  - `selected`: Boolean for batch actions.
- **`DownloadTask`**:
  - `releaseId`: Link to release.
  - `format`: `'mp3-320'` | `'flac'` | `'aac-hi'` | `'wav'` | `'alac'`.
  - `status`: `'queued'` | `'resolving'` | `'downloading'` | `'zipping'` | `'completed'` | `'error'`.
  - `progress`: 0 to 100 percentage.
  - `error`: Error message if resolution fails.

#### Interactive Component & Handlers Plan
1. **Header & Navigation Bar**: Clean 3-zone header with Bandcamp Downloader wordmark, mode switch (`Live Scanner` / `Extension Package & Guide` / `Settings`), and primary action (`Scan Esoctrilihum Demo` or `Scan Custom URL`).
2. **Scanner Controller**: Input bar with validation for `*.bandcamp.com`, "Deep Scan Discography" button, "Scan Album Pages Only" toggle, concurrency slider.
3. **Catalog Data Grid**:
   - Master checkbox with indeterminate state.
   - Filter chips: All, Free Only, Name Your Price, Albums Only.
   - Format selector with direct file size approximations.
   - Batch actions: "Download Selected (X items)", "Export URLs as Text / cURL".
4. **Live Download Queue Drawer**: Shows active transfers, individual retry, pause, cancellation, and ZIP packing progress.
5. **Extension Package Hub**:
   - One-click "Download Extension .zip" button containing complete, ready-to-load files.
   - Code viewer with syntax tabs (`manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js`).
   - Visual step-by-step loading instructions for Chrome.
