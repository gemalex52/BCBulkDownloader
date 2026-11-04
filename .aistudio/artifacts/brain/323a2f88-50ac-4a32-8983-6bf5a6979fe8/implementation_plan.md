# Bandcamp Bulk Downloader — Redesign Implementation Plan (Revised)

A comprehensive overhaul of the Bandcamp Free & Name-Your-Price bulk downloader, decoupling audio downloads from companion metadata archives, introducing an idempotent persistent queue with multi-artist session resumption, anti-captcha jittered pacing, and automating email-walled download link retrieval via Google Apps Script (GAS) webhooks.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following operational preferences were confirmed and refined:
> - **Multi-Site Namespaced Sessions**: Persistent queue and scan cache are partitioned by artist domain/origin (`bc_session_<hostname>`), allowing users to scan, manage, and resume sessions across different Bandcamp artists independently.
> - **Anti-Captcha & Rate-Limit Pacing**: Configurable request delay with randomized jitter (e.g., $2.0\text{s} \pm 0.8\text{s}$) between downloads, plus an optional cool-down pause (e.g. pause 15s every 5 releases) to prevent Cloudflare/Bandcamp rate-limiting or captchas.
> - **Watchdog Polling**: Poll the Google Apps Script webhook every 5 seconds for up to 3 minutes, with an immediate manual "Re-check / Retry" action available on card rows.
> - **Companion Info ZIP**: Enabled by default alongside audio releases, containing untruncated `info.txt`, `cover.jpg`, `photos/`, `artist.jpg` (from `bio_pic`), and separate `.lrc` lyrics files for any tracks with lyrics.
> - **Interrupted Session Resumption**: When resuming, automatically proceed with pending items and retry previously failed items, while skipping completed items (with per-item re-download overrides).

---

### 1. Overview & Core Concept

- **What It Does**: 
  1. Scans complete Bandcamp artist catalogs (including unpaginated releases and dynamic client data).
  2. Resolves free and email-walled releases into their genuine studio audio archives/files (`.zip` or `.flac`) named cleanly by metadata (`Artist - 2026.10.30 - Album.zip` / `Artist - 2026.10.30 - Track.flac`).
  3. Generates a paired companion archive (`Artist - 2026.10.30 - Album (info).zip`) containing untruncated `info.txt`, `cover.jpg`, packaging `photos/`, `artist.jpg` (from Bandcamp `bio_pic`), and track-level `.lrc` lyrics files.
  4. Automatically monitors Gmail for email-walled Bandcamp download tokens via a user-deployed Google Apps Script (GAS) webhook, resolving and downloading studio files hands-free.
  5. Maintains persistent, namespaced queue state in local storage across multiple artist discographies, enabling 1-click **Resume Download** after interruptions with live stage logs for every item.
  6. Applies jittered delays and configurable cool-down intervals to respect Bandcamp server limits and avoid captcha triggers.
- **Target Audience**: Music collectors, archivists, and Bandcamp supporters seeking high-fidelity studio archives (FLAC/320) and organized artwork/metadata without manually clicking dozens of email confirmation links.
- **Key Value**: Eliminates manual email-checking loops and bloated multi-album re-compression, providing direct studio downloads with structured companion archives, anti-ban pacing, and crash-resilient multi-site session resumption.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Catalog Scan & Multi-Session Navigation**:
   - User inputs artist page or opens extension popup on any Bandcamp artist page.
   - The queue manager checks for an existing session for that specific artist (`esoctrilihum.bandcamp.com`, `ulver.bandcamp.com`, etc.).
   - If a session is incomplete, the primary action displays **Resume Download** with progress details (e.g., `4 of 12 completed · 1 failed`). A session switcher allows switching between ongoing artist queues.
2. **Download Initiation & Full-Tab Launch**:
   - Clicking **Start Download** (or **Resume Download**) in the extension immediately opens/focuses the dedicated full-tab dashboard (`dashboard.html`) to ensure persistent execution and prevent background worker termination.
   - Each release item displays its real-time stage:
     - `Pending` $\rightarrow$ `Checking Existing Mail` $\rightarrow$ `Triggering Email` $\rightarrow$ `Awaiting Link (GAS)` $\rightarrow$ `Resolving Audio` $\rightarrow$ `Downloading Audio` $\rightarrow$ `Packaging Info ZIP` $\rightarrow$ `Pacing Jitter` $\rightarrow$ `Completed`.
3. **Pacing, Jitter & Cool-Down Feedback**:
   - Between download tasks, a quiet countdown indicator displays the active jitter delay (e.g. `Pacing: 2.3s cooldown...`) to keep the user informed without intrusive banners.
   - After a batch threshold (e.g., 5 downloads), the dashboard indicates a brief cool-down phase (`Cooling down for 10s to avoid rate limits...`).
4. **Email-Walled Multi-Stage Pipeline**:
   - For email-walled NYP releases, the system first checks the GAS webhook for recently received links (using the configurable search window).
   - If not found, it submits `/email_download`, starts the 5-second polling watchdog (up to 3 minutes), and displays the countdown and search query in the item's live log.
   - Once GAS returns `{"found": true, "downloadPageUrl": "..."}`, the system immediately calls `statdownload` until the link is ready, streams the genuine studio ZIP, and saves it with formatted metadata.
5. **GAS Webhook & Pacing Setup**:
   - Settings panel includes:
     - Ready-to-copy Google Apps Script code snippet (`Code.gs`) with 1-click test button.
     - Pacing settings: Base Delay ($1\text{s}$–$10\text{s}$), Jitter ($\pm 50\%$), and Cool-Down Batch Interval ($N$ downloads, $S$ seconds).

#### Visual Identity & Theme
- **Color Discipline (60-30-10)**:
  - Neutral Canvas: Deep obsidian dark slate (`#0B0F17`) and structural surface panels (`#111827`, `#1E293B`).
  - Structural Hairlines: 1px dividers (`#334155`, `#1F2937`) with single-elevation depth.
  - Accent Color: Bandcamp cyan (`#00B4D8`) and electric sky (`#38BDF8`) reserved strictly for interactive CTAs, active filters, and progress bars.
  - Semantic Status: Emerald (`#10B981`) for completed, Amber (`#F59E0B`) for polling/awaiting, Crimson (`#EF4444`) for errors.
- **Typographic Hierarchy**:
  - Primary UI & Display: `Plus Jakarta Sans` for crisp navigation, buttons, and headers.
  - Body & Metadata: `DM Sans` for clean, unboxed metadata (`Year · 3 tracks · FLAC`).
  - Telemetry & Status Logs: Monospace with tabular numerals (`font-mono tabular-nums`) for timestamps, byte counters, and polling intervals.
- **Zero-Pill Metadata**:
  - Releases list items and dashboard cards use unboxed text with subtle typographic separators (`·` or `/`), never multi-layered pill enclosures.

---

### 3. Key Product Decisions & Trade-Offs

#### 1. Decoupled Audio Archive + Companion Info ZIP with Lyrics (.lrc)
- **Chosen Approach**:
  - For each release, download the official Bandcamp audio archive/file as a standalone asset (`Artist - 2026.10.30 - Album.zip` or `Artist - 2026.10.30 - Track.flac`).
  - Create a separate companion archive (`Artist - 2026.10.30 - Album (info).zip`) containing `info.txt`, `cover.jpg`, `photos/`, `artist.jpg` (from Bandcamp `bio_pic`), and separate `.lrc` lyrics files for any tracks that include lyrics.
- **Why**: Bandcamp's official archives are natively packaged with verified studio audio and tagging. A decoupled companion info ZIP provides complete archival artwork, unpadded liner notes, and synchronized lyrics files alongside studio files without browser memory exhaustion.
- **Alternatives Considered**: Dumping individual images into the download folder (clutters user's file system) or forcing audio re-encoding (degrades quality).

#### 2. Multi-Site Namespaced Persistence
- **Chosen Approach**:
  - Storage keys are scoped by normalized artist domain/origin:
    - Queue state: `bc_queue_<origin_hash>`
    - Scan cache: `bc_catalog_<origin_hash>`
    - Global preferences: `bc_global_settings` (formats, GAS URL, secret, pacing preferences).
- **Why**: Users scan multiple artist discographies. Namespaced storage ensures sessions for Artist A and Artist B do not overwrite each other, allowing users to pause, switch artists, and resume seamlessly.

#### 3. Jittered Pacing & Cool-Down Engine
- **Chosen Approach**:
  - Between consecutive release downloads, introduce a randomized delay:
    $$\Delta t = \text{baseDelay} + (\text{Math.random()} \times 2 - 1) \times \text{jitterAmount}$$
  - Default: $2.5\text{s} \pm 1.0\text{s}$ (range: $1.5\text{s}$–$3.5\text{s}$).
  - Cool-down: After every 5 downloads, pause for an additional 12 seconds.
- **Why**: Protects against Bandcamp's IP rate limiting and Cloudflare challenges when processing large 40+ release discographies.

#### 4. Naming Schema Adaptation for Album Archives
- **Chosen Approach**:
  - Default naming schema: `%artist% - %date% - %album%[%title%.%format%]`.
  - For multi-track album archives, track-specific tokens (`%title%`, `%track_num%`) inside bracket groups `[...]` are omitted, resolving to `Artist - 2026.10.30 - Album.zip`.
  - For single-track releases, resolves to `Artist - 2026.10.30 - Track.flac`.

#### 5. Untruncated Liner Notes via `tralbumData`
- **Chosen Approach**: Extract `aboutText` directly from `tralbumData.current.about` rather than scraping the rendered HTML div, avoiding truncated text behind "more..." spoilers.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DISCOGRAPHY SCANNER                                   │
│  - Reads ol#music-grid & data-client-items                                              │
│  - Fetches subpages & parses raw TralbumData (untruncated about notes, bio_pic, lyrics) │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│              MULTI-SITE NAMESPACED QUEUE CONTROLLER (Local Storage)                     │
│  - Keys: bc_queue_<artist_domain>, bc_catalog_<artist_domain>                           │
│  - Stores: { id, title, artist, date, state, audioUrl, infoZipStatus, logs, retryCount }│
│  - States: PENDING | CHECKING_MAIL | TRIGGER_EMAIL | POLLING_GAS | RESOLVING | COMPLETED│
│  - Actions: Start Download | Resume Download | Retry Single Item                        │
└──────────────┬───────────────────────────┬───────────────────────────────┬──────────────┘
               │                           │                               │
               ▼                           ▼                               ▼
     [Direct Free Link]          [Email-Walled NYP]               [Purchased / Paid]
               │                           │                               │
               │                  1. Check existing mail                   │ If owned: download
               │                  2. POST /email_download                  │ If not owned: skip
               │                  3. Poll GAS Webhook (5s)                 │ audio, generate
               │                  4. Receive downloadPageUrl               │ (info).zip only
               │                           │                               │
               └───────────────────────────┼───────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           BANDCAMP DOWNLOAD STAT RESOLVER                               │
│  - Calls /statdownload with .rand & retry token until download_url is ready             │
│  - Resolves genuine studio FLAC / MP3-320 archive URL                                   │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                      ┌────────────────────┴────────────────────┐
                      ▼                                         ▼
┌───────────────────────────────────────────┐ ┌───────────────────────────────────────────┐
│             STUDIO AUDIO FILE             │ │           COMPANION INFO ZIP              │
│  - File: Artist - Date - Album.zip        │ │  - File: Artist - Date - Album (info).zip │
│    or: Artist - Date - Track.flac         │ │  - Contents:                              │
│  - Downloaded via streaming blob or       │ │    - info.txt (untruncated tralbum data)  │
│    chrome.downloads with formatted name   │ │    - cover.jpg (_10.jpg hi-res artwork)   │
│                                           │ │    - photos/ (CD/LP packaging photos)     │
│                                           │ │    - artist.jpg (from bio_pic_id)         │
│                                           │ │    - *.lrc (synchronized track lyrics)    │
└─────────────────────┬─────────────────────┘ └─────────────────┬─────────────────────────┘
                      └────────────────────┬────────────────────┘
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           PACING & JITTER RATE-LIMIT ENGINE                             │
│  - Base delay: 2.5s ± 1.0s jitter between downloads                                     │
│  - Cool-down pause: 12s after every 5 completed releases                                │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Multi-Stage Processing Pipeline

| Stage | Action | Expected Output / Transition |
| :--- | :--- | :--- |
| `1. Inspection` | Checks release type (`freeDownloadPage`, `require_email`, `isPaid`) | Routes release to direct download, email workflow, or info-only. |
| `2. Existing Mail Check` | Calls GAS webhook with `since = custom_since` or `now - 86400` | If email was already received earlier, skip triggering duplicate email! |
| `3. Trigger Email` | POST to `https://<artist>.bandcamp.com/email_download` | Bandcamp returns `{"ok": true}`. Record `triggerEpoch`. |
| `4. Polling Watchdog` | Polls GAS webhook every 5s for up to 3 minutes: `.../exec?secret=...&since=...&id=...&title=...` | Receives `{"found": true, "downloadPageUrl": "..."}` or times out after 3 min with retry button. |
| `5. Stat Resolver` | Polls Bandcamp `statdownload` until `statResult` returns `download_url` | Obtains direct CDN download link for requested format (FLAC/320). |
| `6. Audio Download` | Downloads studio file / archive and saves as `%artist% - %date% - %album%[%title%.%format%]` | Saves `Artist - Date - Album.zip` or `Artist - Date - Track.flac`. |
| `7. Companion Archive` | If enabled (default: ON), builds `Artist - Date - Album (info).zip` with JSZip | Contains untruncated `info.txt`, `cover.jpg`, `photos/`, `artist.jpg`, and `.lrc` lyrics files. |
| `8. Pacing Jitter` | Waits randomized delay ($1.5\text{s}$–$3.5\text{s}$) + checks cool-down batch counter | Prevents rate-limits; logs wait time in UI. |
| `9. Completion` | Updates namespaced local storage queue, logs timestamp, marks item `Completed` | Increments completed count; triggers next queue item. |

#### Google Apps Script (GAS) Webhook Specification
- **Request Format**:
  `GET https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?secret=<SECRET>&since=<EPOCH_SECONDS>&id=<RELEASE_ID>&title=<ENCODED_TITLE>`
- **Response Format**:
  ```json
  {
    "found": true,
    "downloadPageUrl": "https://bandcamp.com/download?from=email&id=563538331&payment_id=12345&sig=abcdef0123456789&type=album",
    "subject": "Free download: Othaliël - Eternal Life in Metastasized Dreams",
    "receivedAt": 1793361234
  }
  ```
- **Included Script Template**: A self-contained Google Apps Script template will be embedded in the application settings with 1-click copy, searching Gmail threads efficiently (`from:noreply@bandcamp.com after:<date>`) and extracting the signed download URL.

---

### 5. Detailed Implementation Phases

1. **Phase 1: Multi-Site Namespaced Storage & Queue State**:
   - Create storage manager partitioning queues by normalized artist domain/origin (`bc_queue_<artist_domain>`).
   - Implement idempotent state machine: tracks individual release status (`pending`, `email_triggered`, `polling_gas`, `downloading_audio`, `packaging_info`, `completed`, `failed`), retry counters, and stage logs.
   - Update UI buttons to dynamically toggle between **Start Download** and **Resume Download** based on saved queue state for the active site.
2. **Phase 2: Jittered Pacing & Anti-Rate-Limit Engine**:
   - Implement jittered delay helper: `sleep(baseDelay + jitter)` between downloads.
   - Implement batch cool-down tracker (pause after every $N$ items).
   - Expose configurable pacing controls in Settings and Dashboard toolbar.
3. **Phase 3: GAS Webhook Watchdog & Settings UI**:
   - Add GAS configuration panel to Settings & Dashboard toolbar (Webhook URL, Secret Password, Fallback Email, Search Window).
   - Implement test webhook button with live validation feedback.
   - Provide copyable `Code.gs` script template with deployment instructions.
   - Build client and extension polling watchdog (5s interval, 3-minute timeout, manual retry).
4. **Phase 4: Companion Info ZIP with Lyrics (.lrc) & Naming Schema Engine**:
   - Update `formatFilenameBySchema` to automatically drop track tokens for album archives (`%artist% - %date% - %album%[%title%.%format%]`).
   - Implement `buildCompanionInfoZip` using JSZip:
     - Extracts untruncated `tralbumData.current.about`.
     - Renames `bio_pic` image to `artist.jpg`.
     - Generates `.lrc` lyrics files for all tracks with lyrics.
     - Packages `info.txt`, `cover.jpg`, `photos/`, `artist.jpg`, and `*.lrc` without any audio tracks.
     - Saves companion archive as `<release_name> (info).zip`.
5. **Phase 5: Extension Integration & Full-Tab Redirection**:
   - Update `popup.js` to immediately open/focus `dashboard.html` upon starting or resuming downloads.
   - Synchronize namespaced queue state between `popup.js`, `dashboard.js`, and `background.js` via `chrome.storage.local`.
   - Ensure all extension files compile cleanly with zero syntax errors.
6. **Phase 6: Verification & End-to-End Testing**:
   - Verify multi-stage execution with both direct free tracks and email-walled releases.
   - Test session interruption and resumption idempotency across multiple artist sites.
   - Test pacing jitter and cool-down intervals.
   - Validate compilation and linting.
