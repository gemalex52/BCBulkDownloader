# Bandcamp Free & Name-Your-Price Bulk Downloader (Chrome Extension)

A Chrome-compatible browser extension designed to scan Bandcamp artist music catalogs, identify free and pay-what-you-want ($0.00) albums, and bulk download genuine audio paired with companion info archives.

## Key Features
- **Paired Studio Audio & Companion Info ZIP Architecture**:
  - Downloads the studio master audio file or archive (`Artist - 2026.10.30 - Album.zip` or `Artist - 2026.10.30 - Track.flac`).
  - Automatically pairs it with a companion `(info).zip` containing untruncated `info.txt` (with complete liner notes from raw `tralbumData`), hi-res `cover.jpg`, `artist.jpg` (from bio_pic), album artwork in `photos/`, and synchronized/plain `*.lrc` lyrics files.
  - The companion ZIP never includes audio tracks.
- **Idempotent Multi-Site Persistent Queue**:
  - Discography sessions are automatically tracked and namespaced by artist domain (`bc_session_v2_<hostname>`).
  - Seamless resume: if a session is interrupted, 1-click **Resume Download** picks up remaining items, auto-retries failed releases, and skips completed items.
- **Email-Walled Watchdog via Google Apps Script (GAS)**:
  - Automates retrieving unique payment/signature signed download links from Bandcamp emails.
  - Checks existing emails before triggering, polls deployed web app every 5s up to 3 minutes, and resolves final studio master downloads.
- **Anti-Captcha Pacing & Cool-Down**:
  - Randomized jitter delay (2.5s ± 1.0s) and configurable cool-down pauses prevent bot detection and 429 rate limits.
- **Dedicated Full Tab Workflow**:
  - Starts and resumes directly inside a dedicated tab (`dashboard.html`) to keep the service worker and download streams alive.

## Installation in Google Chrome / Brave / Edge

1. **Download and Extract**:
   - Click **Download Extension (.zip)** from the web companion and extract the folder.
2. **Open Extensions Manager**:
   - In Chrome, open a new tab and enter: `chrome://extensions`
   - (In Brave: `brave://extensions` | In Edge: `edge://extensions`)
3. **Enable Developer Mode**:
   - Toggle the switch in the upper-right corner labeled **"Developer mode"**.
4. **Load the Extension**:
   - Click the button in the top-left labeled **"Load unpacked"**.
   - In the file dialog, select the folder containing `manifest.json`.
5. **Pin to Toolbar**:
   - Click the puzzle piece icon in Chrome's top bar and pin **Bandcamp Bulk DL**.
6. **Usage**:
   - Visit an artist page, such as `https://esoctrilihum.bandcamp.com/music`
   - Click the extension icon to view cached items or open the full tab scanner!
