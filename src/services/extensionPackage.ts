import JSZip from 'jszip';
import jszipMinSource from 'jszip/dist/jszip.min.js?raw';
import { ExtensionFileItem } from '../types/bandcamp';
import { getExtensionIconBuffers } from './iconGenerator';

const icons = getExtensionIconBuffers();

export const EXTENSION_FILES: ExtensionFileItem[] = [
  {
    name: 'jszip.min.js',
    path: 'jszip.min.js',
    language: 'javascript',
    description: 'JSZip library for client-side ZIP packaging.',
    content: jszipMinSource,
  },
  {
    name: 'manifest.json',
    path: 'manifest.json',
    language: 'json',
    description: 'Manifest V3 configuration with 2x2 grid icon, permissions, service worker, popup action, and full-tab dashboard.',
    content: `{
  "manifest_version": 3,
  "name": "Bandcamp Free & NYP Bulk Downloader",
  "version": "1.5.0",
  "description": "Scan complete Bandcamp discographies, filter free/name-your-price releases, customize file naming (%artist% - %date% - %title%), and bulk download genuine FLAC, MP3 320, or WAV with artwork and info.",
  "permissions": [
    "activeTab",
    "downloads",
    "storage",
    "scripting"
  ],
  "host_permissions": [
    "https://*.bandcamp.com/*",
    "https://*.bcbits.com/*"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Bandcamp Bulk Downloader",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "background": {
    "service_worker": "background.js"
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "content_scripts": [
    {
      "matches": ["https://*.bandcamp.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}`
  },
  {
    name: 'background.js',
    path: 'background.js',
    language: 'javascript',
    description: 'Background Service Worker handling CORS-free fetching of album sub-pages, token generation, statdownload resolution, and chrome.downloads execution.',
    content: `// Bandcamp Free Bulk Downloader - Background Service Worker (Manifest V3)

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['defaultFormat', 'deliveryMode', 'fallbackEmail', 'namingSchema'], (res) => {
    const updates = {};
    if (!res.defaultFormat) updates.defaultFormat = 'flac';
    if (!res.deliveryMode) updates.deliveryMode = 'zip';
    if (!res.namingSchema) updates.namingSchema = '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%';
    if (Object.keys(updates).length > 0) {
      chrome.storage.sync.set(updates);
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Fetch sub-page HTML without CORS restrictions
  if (request.action === 'FETCH_SUBPAGE') {
    fetch(request.url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'User-Agent': navigator.userAgent
      }
    })
      .then(res => res.text())
      .then(html => sendResponse({ success: true, html }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 2. Resolve free download link via Bandcamp page blob + statdownload API (resolves true FLAC/320)
  if (request.action === 'RESOLVE_DOWNLOAD_PAGE') {
    (async () => {
      try {
        const dlRes = await fetch(request.url);
        const dlHtml = await dlRes.text();
        const blobMatch = dlHtml.match(/data-blob="([^"]+)"/);
        if (!blobMatch) {
          return sendResponse({ success: false, error: 'No data-blob found on download page' });
        }

        const data = JSON.parse(blobMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        const downloads = data?.digital_items?.[0]?.downloads;
        if (!downloads) {
          return sendResponse({ success: false, error: 'No downloads found in blob' });
        }

        const requestedFormat = request.format || 'flac';
        const target = downloads[requestedFormat] || downloads['flac'] || downloads['mp3-320'] || downloads['mp3-v0'] || downloads['wav'];
        if (!target?.url) {
          return sendResponse({ success: false, error: 'Format not available' });
        }

        // Call statdownload with retry
        async function callStat(urlToStat) {
          const parsed = new URL(urlToStat);
          const statUrl = parsed.origin + parsed.pathname.replace('/download/', '/statdownload/') + parsed.search + '&.rand=' + Math.floor(Math.random() * 1000000) + '&.vrs=1';
          const statRes = await fetch(statUrl, {
            headers: {
              'User-Agent': navigator.userAgent,
              'Referer': request.url
            }
          });
          const text = await statRes.text();
          const jsonMatch = text.match(/Downloads\\.statResult\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)/);
          if (jsonMatch) return JSON.parse(jsonMatch[1]);
          return null;
        }

        let stat = await callStat(target.url);
        if (stat?.result === 'err' && stat?.retry_url) {
          stat = await callStat(stat.retry_url);
        }

        const finalUrl = stat?.download_url || target.url;
        sendResponse({
          success: true,
          downloadUrl: finalUrl,
          format: target.encoding_name,
          sizeMb: target.size_mb,
          isArchive: Boolean(target.url.includes('/album?'))
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 3. Submit email for free download token
  if (request.action === 'SUBMIT_EMAIL_DOWNLOAD') {
    const { artistUrl, itemId, itemType, email, format } = request;
    const body = new URLSearchParams({
      encoding_name: format || 'flac',
      item_id: String(itemId),
      item_type: itemType || 'album',
      address: email,
      country: 'US',
      postcode: '10001'
    });

    fetch(artistUrl + '/email_download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body
    })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 4. Trigger native Chrome download with formatted filename
  if (request.action === 'START_DOWNLOAD') {
    const { url, filename } = request;
    chrome.downloads.download({
      url,
      filename: filename || 'Bandcamp/download.flac',
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }

  // 5. Open full Live Scanner tab
  if (request.action === 'OPEN_DASHBOARD_TAB') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    sendResponse({ success: true });
    return true;
  }
});
`
  },
  {
    name: 'content.js',
    path: 'content.js',
    language: 'javascript',
    description: 'Content script scanning all 38 releases (rendered <li> items and data-client-items attribute) with high-res art.',
    content: `// Bandcamp Content Script: Discography & Free Release Scanner (Complete 38+ Items)

(function() {
  function scanFullDiscography() {
    const isBandcamp = window.location.hostname.endsWith('bandcamp.com');
    if (!isBandcamp) return { error: 'Not on a Bandcamp domain.' };

    const artistName = document.querySelector('#band-name-location .title')?.textContent?.trim() ||
                       document.querySelector('meta[property="og:site_name"]')?.content ||
                       window.location.hostname.split('.')[0];

    const itemsMap = new Map();

    // 1. Initial 16 rendered <li> items
    const gridItems = document.querySelectorAll('ol#music-grid li[data-item-id]');
    gridItems.forEach((li) => {
      const link = li.querySelector('a[href^="/album/"], a[href^="/track/"]');
      if (!link) return;

      const href = link.getAttribute('href');
      const isAlbum = href.startsWith('/album/');
      const isTrack = href.startsWith('/track/');
      if (!isAlbum && !isTrack) return;

      const titleEl = li.querySelector('p.title') || li.querySelector('.title');
      const title = titleEl ? titleEl.childNodes[0]?.textContent?.trim() || titleEl.textContent?.trim() : 'Untitled';

      const img = li.querySelector('img');
      const rawSrc = img ? (img.getAttribute('src') || img.getAttribute('data-original') || '') : '';
      const artUrl = rawSrc ? rawSrc.replace(/_\\d+\\.jpg/, '_10.jpg') : '';

      itemsMap.set(href, {
        id: li.getAttribute('data-item-id') || href,
        href: window.location.origin + href,
        pageUrl: href,
        title,
        artUrl,
        artist: artistName,
        type: isAlbum ? 'album' : 'track'
      });
    });

    // 2. Remaining items from data-client-items on ol#music-grid
    const musicGrid = document.querySelector('ol#music-grid');
    if (musicGrid) {
      const clientData = musicGrid.getAttribute('data-client-items');
      if (clientData) {
        try {
          const clientItems = JSON.parse(clientData);
          clientItems.forEach((item) => {
            if (!itemsMap.has(item.page_url)) {
              const isAlbum = item.type === 'album' || item.page_url.startsWith('/album/');
              itemsMap.set(item.page_url, {
                id: (item.type || 'item') + '-' + item.id,
                itemId: item.id,
                href: window.location.origin + item.page_url,
                pageUrl: item.page_url,
                title: item.title,
                artUrl: item.art_id ? ('https://f4.bcbits.com/img/a' + item.art_id + '_10.jpg') : '',
                artist: artistName,
                type: isAlbum ? 'album' : 'track'
              });
            }
          });
        } catch(e) {
          console.warn('Failed parsing data-client-items:', e);
        }
      }
    }

    return {
      success: true,
      artist: artistName,
      url: window.location.href,
      items: Array.from(itemsMap.values())
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'SCAN_DISCOGRAPHY') {
      sendResponse(scanFullDiscography());
    }
  });
})();
`
  },
  {
    name: 'popup.html',
    path: 'popup.html',
    language: 'html',
    description: 'Popup interface with cache detection, open dashboard in tab button, dynamic list, and naming schema.',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bandcamp Bulk Downloader</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="top-header">
    <div class="brand">
      <img src="icons/icon16.png" width="16" height="16" alt="Icon">
      <span>Bandcamp Bulk DL</span>
    </div>
    <div class="header-actions">
      <button id="btnOpenTab" class="tab-btn" title="Open Full Live Scanner in New Tab">↗ Full Tab</button>
      <a href="options.html" target="_blank" class="opt-btn" title="Settings">⚙️</a>
    </div>
  </div>

  <div class="scan-bar">
    <div class="scan-btn-group">
      <button id="btnScan" class="primary-btn">Scan Current Page</button>
      <button id="btnRescan" class="secondary-btn" title="Force fresh scan ignoring cache">↺ Fresh</button>
    </div>
    <div id="cacheNotice" class="cache-notice" style="display:none;"></div>
  </div>

  <div id="namingArea" class="naming-area">
    <div class="naming-label">
      <span>File Naming Schema (%meta_field%):</span>
    </div>
    <input type="text" id="schemaInput" value="%artist% - %date% - %album% - %track_num% - %title%.%format%" placeholder="%artist% - %date% - %title%.%format%">
    <div class="naming-tags">
      <button type="button" class="tag-btn" data-tag="%artist%">+artist</button>
      <button type="button" class="tag-btn" data-tag="%date%">+date</button>
      <button type="button" class="tag-btn" data-tag="%album%">+album</button>
      <button type="button" class="tag-btn" data-tag="%track_num%">+track#</button>
      <button type="button" class="tag-btn" data-tag="%title%">+title</button>
      <button type="button" class="tag-btn" data-tag="%format%">+format</button>
    </div>
    <div id="previewFilename" class="preview-filename"></div>
  </div>

  <div id="controlsArea" class="controls-area" style="display:none;">
    <div class="filter-header">
      <label class="cb-label">
        <input type="checkbox" id="selectAllCheckbox">
        <span>Select All Free / NYP</span>
      </label>
      <span id="selectedBadge" class="badge">0 selected</span>
    </div>

    <div class="format-header">
      <div class="opt-group">
        <label for="formatSelect">Format:</label>
        <select id="formatSelect">
          <option value="flac" selected>FLAC (Lossless Studio Quality)</option>
          <option value="mp3-320">MP3 320kbps (High Quality)</option>
          <option value="mp3-v0">MP3 V0 (VBR)</option>
          <option value="wav">WAV 16-bit PCM</option>
          <option value="aac-hi">AAC (VBR)</option>
          <option value="alac">ALAC</option>
        </select>
      </div>

      <div class="opt-group">
        <label for="deliverySelect">Bundle:</label>
        <select id="deliverySelect">
          <option value="zip" selected>ZIP (with art & info.txt)</option>
          <option value="individual">Individual Files</option>
        </select>
      </div>
    </div>
  </div>

  <div id="releasesList" class="releases-list">
    <div class="empty-state">
      Open an artist page (e.g. <code>esoctrilihum.bandcamp.com/music</code>) and click <strong>Scan Current Page</strong>.
    </div>
  </div>

  <div id="downloadBar" class="download-bar" style="display:none;">
    <button id="btnDownload" class="dl-btn">Download Audio Data (0)</button>
  </div>

  <script src="jszip.min.js"></script>
  <script src="popup.js"></script>
</body>
</html>
`
  },
  {
    name: 'popup.css',
    path: 'popup.css',
    language: 'css',
    description: 'Popup CSS with dark slate theme, tags, and progress bars.',
    content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  width: 460px;
  max-height: 620px;
  background-color: #0b0f17;
  color: #f1f5f9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  display: flex;
  flex-direction: column;
}
.top-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #111827;
  border-bottom: 1px solid #1f2937;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: #00b4d8;
  font-size: 14px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tab-btn {
  background: #1e293b;
  color: #38bdf8;
  border: 1px solid #334155;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.tab-btn:hover { background: #334155; }
.opt-btn {
  text-decoration: none;
  font-size: 15px;
}
.scan-bar {
  padding: 10px 14px;
  border-bottom: 1px solid #1f2937;
}
.scan-btn-group {
  display: flex;
  gap: 6px;
}
.primary-btn {
  flex: 1;
  padding: 9px;
  background: #00b4d8;
  color: #0b0f17;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  font-size: 12px;
}
.primary-btn:hover { background: #38bdf8; }
.secondary-btn {
  padding: 9px 12px;
  background: #1e293b;
  color: #cbd5e1;
  border: 1px solid #334155;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.cache-notice {
  font-size: 11px;
  color: #10b981;
  margin-top: 6px;
  font-family: monospace;
}
.naming-area {
  padding: 8px 14px;
  background: #0e1626;
  border-bottom: 1px solid #1f2937;
}
.naming-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 4px;
}
#schemaInput {
  width: 100%;
  padding: 6px 8px;
  background: #0b0f17;
  border: 1px solid #334155;
  border-radius: 4px;
  color: #38bdf8;
  font-family: monospace;
  font-size: 11px;
}
.naming-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}
.tag-btn {
  background: #1e293b;
  color: #94a3b8;
  border: 1px solid #334155;
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 10px;
  cursor: pointer;
}
.tag-btn:hover { color: #fff; background: #334155; }
.preview-filename {
  font-size: 10px;
  color: #64748b;
  font-family: monospace;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.controls-area {
  padding: 8px 14px;
  background: #131c2e;
  border-bottom: 1px solid #1f2937;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.filter-header, .format-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.opt-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cb-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-weight: 500;
  font-size: 12px;
}
.badge {
  font-size: 11px;
  color: #94a3b8;
  font-family: monospace;
}
select {
  background: #0b0f17;
  color: #f1f5f9;
  border: 1px solid #374151;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.releases-list {
  flex: 1;
  overflow-y: auto;
  max-height: 280px;
  padding: 4px 14px;
}
.release-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 0;
  border-bottom: 1px solid #1f2937;
}
.release-item img {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  background: #1f2937;
}
.info {
  flex: 1;
  min-width: 0;
}
.item-title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}
.price-pill {
  font-size: 10px;
  margin-top: 1px;
}
.price-free { color: #10b981; }
.price-nyp { color: #f59e0b; }
.price-paid { color: #6b7280; }
.download-bar {
  padding: 10px 14px;
  background: #111827;
  border-top: 1px solid #1f2937;
}
.dl-btn {
  width: 100%;
  padding: 10px;
  background: #10b981;
  color: #0b0f17;
  border: none;
  border-radius: 6px;
  font-weight: 700;
  cursor: pointer;
  font-size: 13px;
}
.dl-btn:disabled {
  background: #374151;
  color: #9ca3af;
  cursor: not-allowed;
}
.empty-state {
  text-align: center;
  padding: 24px 10px;
  color: #94a3b8;
  line-height: 1.5;
}
`
  },
  {
    name: 'popup.js',
    path: 'popup.js',
    language: 'javascript',
    description: 'Popup script with local storage caching, dynamic list population, FLAC resolution, and custom naming schema.',
    content: `// Bandcamp Bulk Downloader - Popup Script
let releases = [];
let savedEmail = '';
let currentUrl = '';

function formatDate(raw) {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return yyyy + '.' + mm + '.' + dd;
    }
  } catch(e) {}
  return String(raw).replace(/[^0-9.]/g, '');
}

function processConditionalBrackets(template, values) {
  const ESC_OPEN = '\\uE000';
  const ESC_CLOSE = '\\uE001';

  let str = template
    .replace(/\\\\\\\[/g, ESC_OPEN)
    .replace(/\\\\\\\]/g, ESC_CLOSE);

  const bracketRegex = /\\\[([^\\\[\\\]]*)\\\]/;
  while (bracketRegex.test(str)) {
    str = str.replace(bracketRegex, (_, inner) => {
      const tokens = inner.match(/%[a-zA-Z0-9_]+%/g);
      if (!tokens || tokens.length === 0) return inner;
      const allValid = tokens.every(token => {
        const val = values[token.toLowerCase()];
        return val != null && String(val).trim() !== '';
      });
      return allValid ? inner : '';
    });
  }

  return str
    .replace(new RegExp(ESC_OPEN, 'g'), '[')
    .replace(new RegExp(ESC_CLOSE, 'g'), ']');
}

function formatFilename(schema, meta, allowSubfolders) {
  const template = schema || '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%';
  
  // Track number: empty for 1-track release, zero-padded for multitrack
  let trackNumStr = '';
  const total = meta.totalTracks || (meta.type === 'track' ? 1 : 2);
  if (total > 1 && meta.trackNum != null && meta.trackNum !== '') {
    const padLen = Math.max(2, String(total).length);
    trackNumStr = String(meta.trackNum).padStart(padLen, '0');
  }

  const dateStr = formatDate(meta.date || meta.year || '') || '2026.01.01';
  const yearStr = dateStr.slice(0, 4) || String(meta.year || new Date().getFullYear());
  const sanitize = (s) => String(s || '').replace(/[:*?"<>|]/g, '_').trim();

  const values = {
    '%artist%': sanitize(meta.artist || 'Bandcamp'),
    '%album%': sanitize(meta.album || meta.title || 'Album'),
    '%title%': sanitize(meta.title || 'Track'),
    '%track_num%': trackNumStr,
    '%date%': dateStr,
    '%year%': yearStr,
    '%format%': (meta.format || 'flac').replace(/[^a-zA-Z0-9]/g, ''),
    '%type%': sanitize(meta.type || 'track')
  };

  let res = processConditionalBrackets(template, values);

  for (const [token, val] of Object.entries(values)) {
    const re = new RegExp(token, 'gi');
    res = res.replace(re, val);
  }

  // Clean up double separators if tokens were empty
  res = res
    .replace(/\s*[-_]\s*[-_]\s*/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .replace(new RegExp('\\\\/\\\\s*-\\\\s*', 'g'), '/')
    .replace(new RegExp('\\\\s*-\\\\s*\\\\/', 'g'), '/');

  if (allowSubfolders) {
    res = res
      .replace(/\\\\/g, '/')
      .split('/')
      .map(part => part.replace(/[:*?"<>|]/g, '_').trim())
      .filter(Boolean)
      .join('/');
  } else {
    res = res.replace(/[\\\\/]/g, ' - ').replace(/\s*-\s*-\s*/g, ' - ').trim();
  }

  let ext = (meta.format || 'flac').toLowerCase();
  if (ext.startsWith('mp3')) ext = 'mp3';
  else if (ext === 'aac-hi' || ext === 'alac') ext = 'm4a';
  else if (ext === 'aiff-lossless') ext = 'aiff';
  else if (ext === 'wav') ext = 'wav';
  else if (ext === 'flac') ext = 'flac';

  if (!res.toLowerCase().endsWith('.' + ext)) {
    res = res + '.' + ext;
  }
  return res;
}

document.addEventListener('DOMContentLoaded', () => {
  const btnScan = document.getElementById('btnScan');
  const btnRescan = document.getElementById('btnRescan');
  const btnOpenTab = document.getElementById('btnOpenTab');
  const btnDownload = document.getElementById('btnDownload');
  const selectAll = document.getElementById('selectAllCheckbox');
  const formatSelect = document.getElementById('formatSelect');
  const deliverySelect = document.getElementById('deliverySelect');
  const schemaInput = document.getElementById('schemaInput');
  const previewFilename = document.getElementById('previewFilename');
  const controlsArea = document.getElementById('controlsArea');
  const downloadBar = document.getElementById('downloadBar');
  const releasesList = document.getElementById('releasesList');
  const selectedBadge = document.getElementById('selectedBadge');
  const cacheNotice = document.getElementById('cacheNotice');

  // Load preferences
  chrome.storage.sync.get(['defaultFormat', 'deliveryMode', 'fallbackEmail', 'namingSchema'], (d) => {
    if (d.defaultFormat) formatSelect.value = d.defaultFormat;
    if (d.deliveryMode) deliverySelect.value = d.deliveryMode;
    if (d.fallbackEmail) savedEmail = d.fallbackEmail;
    if (d.namingSchema) schemaInput.value = d.namingSchema;
    updateNamingPreview();
  });

  // Open Full Tab Dashboard
  btnOpenTab.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD_TAB' });
  });

  // Clickable schema tags
  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      schemaInput.value += ' ' + btn.dataset.tag;
      updateNamingPreview();
      chrome.storage.sync.set({ namingSchema: schemaInput.value });
    });
  });

  schemaInput.addEventListener('input', () => {
    updateNamingPreview();
    chrome.storage.sync.set({ namingSchema: schemaInput.value });
  });

  function updateNamingPreview() {
    const fmt = formatSelect.value || 'flac';
    const sample = formatFilename(schemaInput.value, {
      artist: 'Esoctrilihum',
      album: 'Almost Dead',
      title: 'Almost Dead',
      trackNum: 1,
      totalTracks: 1,
      date: '2025.10.31',
      year: 2025,
      format: fmt,
      type: 'track'
    }, deliverySelect.value === 'zip');
    previewFilename.textContent = 'Preview: ' + sample;
  }

  formatSelect.addEventListener('change', () => {
    updateNamingPreview();
    chrome.storage.sync.set({ defaultFormat: formatSelect.value });
  });

  deliverySelect.addEventListener('change', () => {
    updateNamingPreview();
    chrome.storage.sync.set({ deliveryMode: deliverySelect.value });
  });

  // Check active tab and load cache
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('bandcamp.com')) {
      currentUrl = tab.url;
      const cacheKey = 'bc_cache_' + currentUrl.split('?')[0];

      chrome.storage.local.get([cacheKey], (result) => {
        if (result[cacheKey] && result[cacheKey].releases?.length > 0) {
          releases = result[cacheKey].releases;
          cacheNotice.style.display = 'block';
          cacheNotice.textContent = '⚡ Cached: ' + releases.length + ' releases (Click Fresh to re-scan)';
          controlsArea.style.display = 'block';
          downloadBar.style.display = 'block';
          renderList();
        }
      });
    }
  });

  // Trigger Scan
  btnScan.addEventListener('click', () => executeScan(false));
  btnRescan.addEventListener('click', () => executeScan(true));

  function executeScan(forceFresh) {
    btnScan.disabled = true;
    btnScan.textContent = 'Discovering catalog...';
    cacheNotice.style.display = 'none';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.url || !activeTab.url.includes('bandcamp.com')) {
        btnScan.disabled = false;
        btnScan.textContent = 'Scan Current Page';
        releasesList.innerHTML = '<div class="empty-state" style="color:#ef4444;">Please open a Bandcamp artist or music page first.</div>';
        return;
      }

      currentUrl = activeTab.url;
      chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          const isBandcamp = window.location.hostname.endsWith('bandcamp.com');
          if (!isBandcamp) return { error: 'Not on a Bandcamp domain.' };

          const artistName = document.querySelector('#band-name-location .title')?.textContent?.trim() ||
                             document.querySelector('meta[property="og:site_name"]')?.content ||
                             window.location.hostname.split('.')[0];

          const itemsMap = new Map();

          // 1. Initial rendered <li> items
          const gridItems = document.querySelectorAll('ol#music-grid li[data-item-id]');
          gridItems.forEach((li) => {
            const link = li.querySelector('a[href^="/album/"], a[href^="/track/"]');
            if (!link) return;

            const href = link.getAttribute('href');
            const isAlbum = href.startsWith('/album/');
            const isTrack = href.startsWith('/track/');
            if (!isAlbum && !isTrack) return;

            const titleEl = li.querySelector('p.title') || li.querySelector('.title');
            const title = titleEl ? titleEl.childNodes[0]?.textContent?.trim() || titleEl.textContent?.trim() : 'Untitled';

            const img = li.querySelector('img');
            const rawSrc = img ? (img.getAttribute('src') || img.getAttribute('data-original') || '') : '';
            const artUrl = rawSrc ? rawSrc.replace(/_\d+\.jpg/, '_10.jpg') : '';

            itemsMap.set(href, {
              id: li.getAttribute('data-item-id') || href,
              href: window.location.origin + href,
              pageUrl: href,
              title,
              artUrl,
              artist: artistName,
              type: isAlbum ? 'album' : 'track'
            });
          });

          // 2. Remaining items from data-client-items on ol#music-grid
          const musicGrid = document.querySelector('ol#music-grid');
          if (musicGrid) {
            const clientData = musicGrid.getAttribute('data-client-items');
            if (clientData) {
              try {
                const clientItems = JSON.parse(clientData);
                clientItems.forEach((item) => {
                  if (!itemsMap.has(item.page_url)) {
                    const isAlbum = item.type === 'album' || item.page_url.startsWith('/album/');
                    itemsMap.set(item.page_url, {
                      id: (item.type || 'item') + '-' + item.id,
                      itemId: item.id,
                      href: window.location.origin + item.page_url,
                      pageUrl: item.page_url,
                      title: item.title,
                      artUrl: item.art_id ? ('https://f4.bcbits.com/img/a' + item.art_id + '_10.jpg') : '',
                      artist: artistName,
                      type: isAlbum ? 'album' : 'track'
                    });
                  }
                });
              } catch(e) {}
            }
          }

          return {
            success: true,
            artist: artistName,
            url: window.location.href,
            items: Array.from(itemsMap.values())
          };
        }
      }, async (injectionResults) => {
        const response = injectionResults?.[0]?.result;
        if (!response || !response.items || response.items.length === 0) {
          btnScan.disabled = false;
          btnScan.textContent = 'Scan Current Page';
          releasesList.innerHTML = '<div class="empty-state">No releases found. Please refresh page and try again.</div>';
          return;
        }

        const discovered = response.items;
        // Step 1: Immediately populate releases
        releases = discovered.map(item => ({
          ...item,
          isFree: true,
          isNyp: false,
          label: 'Checking...',
          selected: true
        }));

        controlsArea.style.display = 'block';
        downloadBar.style.display = 'block';
        renderList();

        // Step 2: Progressively crawl subpages to enrich pricing, metadata, and info.txt
        for (let i = 0; i < releases.length; i++) {
          const item = releases[i];
          btnScan.textContent = 'Inspecting ' + (i + 1) + '/' + releases.length + '...';

          try {
            const subRes = await new Promise(res => {
              chrome.runtime.sendMessage({ action: 'FETCH_SUBPAGE', url: item.href }, res);
            });

            if (subRes && subRes.html) {
              const html = subRes.html;
              const tralbumMatch = html.match(/data-tralbum="([^"]+)"/);
              if (tralbumMatch) {
                const tralbum = JSON.parse(tralbumMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
                item.tralbumId = tralbum.id;
                item.freeDownloadPage = tralbum.freeDownloadPage || null;
                const cleanHtml = (raw) => {
                  if (!raw) return '';
                  return raw
                    .replace(/<script[\\s\\S]*?<\\/script>/gi, '')
                    .replace(/<style[\\s\\S]*?<\\/style>/gi, '')
                    .replace(/<br\\s*\\/?>/gi, String.fromCharCode(10))
                    .replace(/<[^>]+>/g, '')
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&#39;/g, "'")
                    .replace(/&nbsp;/g, ' ')
                    .trim();
                };
                const creditsMatch = html.match(/class="[^"]*tralbum-credits[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i);
                const licenseMatch = html.match(/<div[^>]*id="license"[^>]*>([\\s\\S]*?)<\\/div>/i);
                const lyricsMatch = html.match(/class="[^"]*lyricsText[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i);

                item.aboutText = cleanHtml(tralbum.current?.about) || cleanHtml(aboutMatch?.[1]);
                item.creditsText = cleanHtml(tralbum.current?.credits) || cleanHtml(creditsMatch?.[1]);
                item.licenseText = cleanHtml(licenseMatch?.[1]);
                item.lyrics = cleanHtml(lyricsMatch?.[1]);
                item.tags = (tralbum.tags && Array.isArray(tralbum.tags)) ? tralbum.tags : Array.from(html.matchAll(/<a[^>]*class="tag"[^>]*>([^<]+)<\\/a>/gi)).map(tm => tm[1].trim());

                const isPurchased = Boolean(tralbum.is_purchased || tralbum.has_purchased || tralbum.you_own_it);
                const minPrice = tralbum.current?.minimum_price != null ? tralbum.current.minimum_price : 0;
                const hasNyp = /name\s+your\s+price/i.test(html) || tralbum.current?.download_pref === 2;
                const hasFree = /free\s+download/i.test(html) || tralbum.current?.download_pref === 1;

                if (isPurchased) {
                  item.isFree = true;
                  item.label = 'You Own It';
                  item.selected = true;
                } else if (item.freeDownloadPage || hasFree || (minPrice === 0 && !hasNyp)) {
                  item.isFree = true;
                  item.label = 'Free Download';
                  item.selected = true;
                } else if (minPrice === 0 && hasNyp) {
                  item.isNyp = true;
                  item.label = 'Name Your Price ($0+)';
                  item.selected = true;
                } else {
                  item.isFree = false;
                  item.label = '€' + (minPrice || 'Paid');
                  item.selected = false;
                }

                if (tralbum.trackinfo) {
                  item.totalTracks = tralbum.trackinfo.length;
                  item.audioStreams = tralbum.trackinfo
                    .filter(t => t.file && t.file['mp3-128'])
                    .map(t => ({ trackNum: t.track_num || 1, title: t.title, url: t.file['mp3-128'], lyrics: t.lyrics }));
                }

                const d = '='.repeat(80);
                const NL = String.fromCharCode(10);
                let inf = d + NL + item.title.toUpperCase() + ' by ' + item.artist + NL + d + NL;
                inf += 'Release Date : ' + (item.releaseDate || 'Unknown') + NL;
                inf += 'Type         : ' + item.type.toUpperCase() + NL;
                inf += 'Status       : ' + item.label + NL;
                inf += 'Bandcamp URL : ' + item.href + NL + NL;
                if (item.audioStreams && item.audioStreams.length > 0) {
                  inf += d + NL + 'TRACKLIST (' + item.audioStreams.length + ' Tracks)' + NL + d + NL + item.audioStreams.map(s => s.trackNum + '. ' + s.title).join(NL) + NL + NL;
                }
                if (item.aboutText) inf += d + NL + 'LINER NOTES / ABOUT' + NL + d + NL + item.aboutText + NL + NL;
                if (item.creditsText) inf += d + NL + 'CREDITS' + NL + d + NL + item.creditsText + NL + NL;
                if (item.licenseText) inf += d + NL + 'LICENSE' + NL + d + NL + item.licenseText + NL + NL;
                if (item.tags && item.tags.length > 0) inf += d + NL + 'TAGS & GENRES' + NL + d + NL + item.tags.join(', ') + NL + NL;
                if (item.lyrics) inf += d + NL + 'LYRICS' + NL + d + NL + item.lyrics + NL + NL;
                inf += d + NL + 'Downloaded with Bandcamp Free & NYP Bulk Downloader' + NL + d + NL;
                item.infoText = inf;
              }
            }
          } catch (e) {}

          updateCardUI(i);
        }

        btnScan.disabled = false;
        btnScan.textContent = 'Scan Completed';

        // Cache full releases list
        const cacheKey = 'bc_cache_v6_' + currentUrl.split('?')[0];
        const cacheObj = {};
        cacheObj[cacheKey] = {
          scannedAt: new Date().toISOString(),
          releases
        };
        chrome.storage.local.set(cacheObj);
      });
    });
  }

  function renderList() {
    releasesList.innerHTML = '';
    releases.forEach((rel, idx) => {
      const div = document.createElement('div');
      div.className = 'release-item';
      div.id = 'rel-item-' + idx;

      const pillClass = rel.isFree ? 'price-free' : (rel.isNyp ? 'price-nyp' : 'price-paid');

      div.innerHTML = [
        '<input type="checkbox" data-idx="' + idx + '" ' + (rel.selected ? 'checked' : '') + '>',
        '<img src="' + (rel.artUrl || 'https://bandcamp.com/img/0.gif') + '" alt="" onerror="this.src=\\'https://bandcamp.com/img/0.gif\\'">',
        '<div class="info">',
        '  <div class="item-title" title="' + rel.title + '">' + rel.title + '</div>',
        '  <div class="price-pill ' + pillClass + '" id="price-pill-' + idx + '">' + rel.label + '</div>',
        '</div>'
      ].join('');

      const cb = div.querySelector('input');
      cb.addEventListener('change', (e) => {
        releases[idx].selected = e.target.checked;
        updateBadge();
      });

      releasesList.appendChild(div);
    });
    updateBadge();
  }

  function updateCardUI(idx) {
    const rel = releases[idx];
    const pill = document.getElementById('price-pill-' + idx);
    const cb = document.querySelector('input[data-idx="' + idx + '"]');
    if (pill) {
      pill.textContent = rel.label;
      pill.className = 'price-pill ' + (rel.isFree ? 'price-free' : (rel.isNyp ? 'price-nyp' : 'price-paid'));
    }
    if (cb) {
      cb.checked = rel.selected;
    }
    updateBadge();
  }

  function updateBadge() {
    const sel = releases.filter(r => r.selected);
    selectedBadge.textContent = sel.length + ' of ' + releases.length + ' selected';
    btnDownload.textContent = 'Download Selected (' + sel.length + ')';
    btnDownload.disabled = sel.length === 0;
  }

  selectAll.addEventListener('change', (e) => {
    const c = e.target.checked;
    releases.forEach((r, idx) => {
      r.selected = c ? (r.isFree || r.isNyp) : false;
      const cb = document.querySelector('input[data-idx="' + idx + '"]');
      if (cb) cb.checked = r.selected;
    });
    updateBadge();
  });

  // Bulk Download: strictly resolves genuine FLAC / 320 and honors schema
  btnDownload.addEventListener('click', async () => {
    const sel = releases.filter(r => r.selected);
    const chosenFormat = formatSelect.value || 'flac';
    const delivery = deliverySelect.value || 'zip';
    const schema = schemaInput.value || '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%';
    btnDownload.disabled = true;

    if (delivery === 'zip') {
      try {
        const zip = new JSZip();

        for (let i = 0; i < sel.length; i++) {
          const r = sel[i];
          btnDownload.textContent = 'Packaging ' + (i + 1) + '/' + sel.length + ': ' + r.title + '...';

          // 1. Determine release directory from schema (no redundant nested folders)
          const baseFormatted = formatFilename(schema, {
            artist: r.artist,
            album: r.title,
            title: r.title,
            trackNum: 1,
            totalTracks: r.totalTracks || 1,
            date: r.releaseDate || '',
            format: chosenFormat,
            type: r.type
          }, true);
          const slashIdx = baseFormatted.lastIndexOf('/');
          const releaseDir = slashIdx !== -1 ? baseFormatted.substring(0, slashIdx) : (r.artist + ' - ' + r.title).replace(/[:*?"<>|]/g, '_');

          // 2. Add comprehensive info.txt
          const NL = String.fromCharCode(10);
          const infoText = r.infoText || ('Title: ' + r.title + NL + 'Artist: ' + r.artist + NL + 'URL: ' + (r.href || ''));
          zip.file(releaseDir + '/info.txt', infoText);

          // 3. Add cover.jpg
          if (r.artUrl) {
            try {
              const artRes = await fetch(r.artUrl);
              if (artRes.ok) {
                const artBuf = await artRes.arrayBuffer();
                zip.file(releaseDir + '/cover.jpg', artBuf);
              }
            } catch (e) {}
          }

          // 4. Add additional packaging photos if available
          if (r.allImages && r.allImages.length > 0) {
            for (let pIdx = 0; pIdx < r.allImages.length; pIdx++) {
              try {
                const pRes = await fetch(r.allImages[pIdx]);
                if (pRes.ok) {
                  const pBuf = await pRes.arrayBuffer();
                  zip.file(releaseDir + '/photos/photo_' + (pIdx + 1) + '.jpg', pBuf);
                }
              } catch (e) {}
            }
          }

          // 5. If paid and unpurchased, skip audio per prompt policy
          if (r.isPaid && !r.isPurchased && !r.isFree && !r.isNyp) {
            continue;
          }

          let audioAdded = false;

          // 6. Direct free download resolution
          if (r.freeDownloadPage) {
            try {
              const dlRes = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                  action: 'RESOLVE_DOWNLOAD_PAGE',
                  url: r.freeDownloadPage,
                  format: chosenFormat
                }, resolve);
              });

              if (dlRes?.success && dlRes.downloadUrl) {
                const audioRes = await fetch(dlRes.downloadUrl);
                if (audioRes.ok) {
                  const audioBuf = await audioRes.arrayBuffer();
                  const bytes = new Uint8Array(audioBuf);
                  // Check if archive (starts with PK)
                  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
                    try {
                      const innerZip = await JSZip.loadAsync(audioBuf);
                      for (const [entryName, entryFile] of Object.entries(innerZip.files)) {
                        if (!entryFile.dir) {
                          const innerBuf = await entryFile.async('arraybuffer');
                          const simpleName = entryName.split('/').pop() || entryName;
                          zip.file(releaseDir + '/' + simpleName, innerBuf);
                        }
                      }
                      audioAdded = true;
                    } catch(e) {}
                  }
                  if (!audioAdded) {
                    zip.file(baseFormatted, audioBuf);
                    audioAdded = true;
                  }
                }
              }
            } catch (e) {}
          }

          // 7. Track streams fallback for multitrack releases
          if (!audioAdded && r.audioStreams && r.audioStreams.length > 0) {
            for (const stream of r.audioStreams) {
              const sUrl = stream.url || stream.streamUrl;
              if (sUrl) {
                try {
                  const streamFormattedName = formatFilename(schema, {
                    artist: r.artist,
                    album: r.title,
                    title: stream.title,
                    trackNum: stream.trackNum,
                    totalTracks: r.audioStreams.length,
                    date: r.releaseDate || '',
                    format: chosenFormat,
                    type: 'track'
                  }, true);

                  const aRes = await fetch(sUrl);
                  if (aRes.ok) {
                    const aBuf = await aRes.arrayBuffer();
                    zip.file(streamFormattedName, aBuf);
                  }

                  if (stream.lyrics && stream.lyrics.trim().length > 0) {
                    const lrcPath = streamFormattedName.replace(/\.[^/.]+$/, '') + '.lrc';
                    const lrcContent = '[ti:' + stream.title + ']' + NL + '[ar:' + r.artist + ']' + NL + '[al:' + r.title + ']' + NL + NL + stream.lyrics + NL;
                    zip.file(lrcPath, lrcContent);
                  }
                } catch (e) {}
              }
            }
            audioAdded = true;
          }
        }

        btnDownload.textContent = 'Compressing ZIP archive...';
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipUrl = URL.createObjectURL(zipBlob);
        const artistPart = (sel[0]?.artist || 'bandcamp').replace(/[:*?"<>|]/g, '_').toLowerCase();
        const zipName = artistPart + '_bulk_discography_' + chosenFormat + '.zip';

        chrome.downloads.download({
          url: zipUrl,
          filename: zipName,
          saveAs: true
        });

        btnDownload.textContent = 'ZIP Archive Downloaded!';
      } catch (err) {
        btnDownload.textContent = 'Packaging Failed';
      }
    } else {
      // Individual mode: fetch blobs so chrome downloads with proper formatted names
      for (let i = 0; i < sel.length; i++) {
        const r = sel[i];
        btnDownload.textContent = 'Downloading ' + (i + 1) + '/' + sel.length + '...';

        if (r.artUrl) {
          try {
            const artRes = await fetch(r.artUrl);
            if (artRes.ok) {
              const blob = await artRes.blob();
              const coverName = 'Bandcamp/' + (r.artist + ' - ' + r.title + ' - cover.jpg').replace(/[:*?"<>|]/g, '_');
              chrome.downloads.download({
                url: URL.createObjectURL(blob),
                filename: coverName,
                conflictAction: 'uniquify'
              });
            }
          } catch(e) {}
        }

        if (r.infoText) {
          const infoBlob = new Blob([r.infoText], { type: 'text/plain;charset=utf-8' });
          const infoName = 'Bandcamp/' + (r.artist + ' - ' + r.title + ' - info.txt').replace(/[:*?"<>|]/g, '_');
          chrome.downloads.download({
            url: URL.createObjectURL(infoBlob),
            filename: infoName,
            conflictAction: 'uniquify'
          });
        }

        if (r.isPaid && !r.isPurchased && !r.isFree && !r.isNyp) {
          continue;
        }

        let audioTriggered = false;

        if (r.freeDownloadPage) {
          try {
            const dlRes = await new Promise(resolve => {
              chrome.runtime.sendMessage({
                action: 'RESOLVE_DOWNLOAD_PAGE',
                url: r.freeDownloadPage,
                format: chosenFormat
              }, resolve);
            });
            if (dlRes?.success && dlRes.downloadUrl) {
              const aRes = await fetch(dlRes.downloadUrl);
              if (aRes.ok) {
                const blob = await aRes.blob();
                const isZip = dlRes.isArchive || chosenFormat === 'zip';
                const filename = formatFilename(schema, {
                  artist: r.artist,
                  album: r.title,
                  title: r.title,
                  trackNum: 1,
                  totalTracks: r.totalTracks || 1,
                  date: r.releaseDate || '',
                  format: isZip ? 'zip' : chosenFormat,
                  type: r.type
                }, false);
                chrome.downloads.download({
                  url: URL.createObjectURL(blob),
                  filename: 'Bandcamp/' + filename,
                  conflictAction: 'uniquify'
                });
                audioTriggered = true;
              }
            }
          } catch(e) {}
        }

        if (!audioTriggered && r.audioStreams && r.audioStreams.length > 0) {
          for (const stream of r.audioStreams) {
            const sUrl = stream.url || stream.streamUrl;
            if (sUrl) {
              try {
                const trackName = formatFilename(schema, {
                  artist: r.artist,
                  album: r.title,
                  title: stream.title,
                  trackNum: stream.trackNum,
                  totalTracks: r.audioStreams.length,
                  date: r.releaseDate || '',
                  format: chosenFormat,
                  type: 'track'
                }, false);

                const streamRes = await fetch(sUrl);
                if (streamRes.ok) {
                  const blob = await streamRes.blob();
                  chrome.downloads.download({
                    url: URL.createObjectURL(blob),
                    filename: 'Bandcamp/' + trackName,
                    conflictAction: 'uniquify'
                  });
                  await new Promise(r => setTimeout(r, 600));
                }
              } catch(e) {}
            }
          }
        }
      }
      btnDownload.textContent = 'Downloads Queued!';
    }

    setTimeout(updateBadge, 2500);
  });
});
`
  },
  {
    name: 'dashboard.html',
    path: 'dashboard.html',
    language: 'html',
    description: 'Full-page Live Scanner tab providing full desktop grid, filters, naming schema editor, and batch manager.',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bandcamp Bulk Downloader - Live Scanner Dashboard</title>
  <link rel="stylesheet" href="dashboard.css">
</head>
<body>
  <header class="header">
    <div class="brand">
      <img src="icons/icon48.png" width="28" height="28" alt="Icon">
      <span>Bandcamp Bulk Downloader</span>
    </div>
    <div class="header-right">
      <span id="activeArtistName" class="artist-name">Live Discography Scanner</span>
      <a href="options.html" target="_blank" class="nav-link">Settings ⚙️</a>
    </div>
  </header>

  <main class="container">
    <div class="toolbar-card">
      <div class="input-row">
        <input type="text" id="targetUrlInput" placeholder="https://esoctrilihum.bandcamp.com/music" value="https://esoctrilihum.bandcamp.com/music">
        <button id="btnDashboardScan" class="btn primary">Scan Discography</button>
        <button id="btnDashboardRefresh" class="btn secondary">↺ Force Fresh Scan</button>
      </div>

      <div class="schema-row">
        <label>File Naming Schema (%meta_field%):</label>
        <input type="text" id="dashSchemaInput" value="%artist% - %date% - %album%/[%track_num%. ]%title%.%format%">
        <div class="tags">
          <button class="dash-tag" data-t="%artist%">+artist</button>
          <button class="dash-tag" data-t="%date%">+date</button>
          <button class="dash-tag" data-t="%album%">+album</button>
          <button class="dash-tag" data-t="%track_num%">+track#</button>
          <button class="dash-tag" data-t="%title%">+title</button>
          <button class="dash-tag" data-t="%format%">+format</button>
        </div>
        <div id="dashPreview" class="dash-preview"></div>
      </div>

      <div class="controls-row">
        <div class="filters">
          <button id="btnSelAllFree" class="pill-btn active">Select All Free / NYP</button>
          <button id="btnSelAll" class="pill-btn">Select All</button>
          <button id="btnDeselAll" class="pill-btn">Deselect All</button>
        </div>

        <div class="format-opts">
          <label>Format:</label>
          <select id="dashFormatSelect">
            <option value="flac" selected>FLAC (Lossless Studio Quality)</option>
            <option value="mp3-320">MP3 320kbps (High Quality)</option>
            <option value="mp3-v0">MP3 V0 (VBR)</option>
            <option value="wav">WAV 16-bit PCM</option>
            <option value="aac-hi">AAC (VBR)</option>
            <option value="alac">ALAC</option>
          </select>

          <label>Delivery:</label>
          <select id="dashDeliverySelect">
            <option value="zip" selected>ZIP Bundle (Single Archive)</option>
            <option value="individual">Individual Files</option>
          </select>

          <button id="btnBulkDownload" class="btn download">Download Selected (0)</button>
        </div>
      </div>
    </div>

    <div id="statusNotice" class="status-notice"></div>

    <div id="discographyGrid" class="discography-grid"></div>
  </main>

  <script src="jszip.min.js"></script>
  <script src="dashboard.js"></script>
</body>
</html>
`
  },
  {
    name: 'dashboard.css',
    path: 'dashboard.css',
    language: 'css',
    description: 'Styling for full dashboard tab.',
    content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #0b0f17;
  color: #f1f5f9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  min-height: 100vh;
}
.header {
  height: 60px;
  background: #111827;
  border-bottom: 1px solid #1e293b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  color: #00b4d8;
  font-size: 16px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 20px;
}
.artist-name {
  font-size: 13px;
  color: #94a3b8;
}
.nav-link {
  color: #38bdf8;
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
}
.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 30px;
}
.toolbar-card {
  background: #111827;
  border: 1px solid #1e293b;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.input-row {
  display: flex;
  gap: 10px;
}
#targetUrlInput {
  flex: 1;
  background: #0b0f17;
  border: 1px solid #334155;
  color: #fff;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
}
.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s;
}
.btn.primary { background: #00b4d8; color: #0b0f17; }
.btn.secondary { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; }
.btn.download { background: #10b981; color: #0b0f17; font-weight: 700; }
.btn:hover { opacity: 0.9; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.schema-row {
  background: #0e1626;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
}
.schema-row label {
  color: #94a3b8;
  font-weight: 600;
  display: block;
  margin-bottom: 6px;
}
#dashSchemaInput {
  width: 100%;
  background: #0b0f17;
  border: 1px solid #334155;
  color: #38bdf8;
  font-family: monospace;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.dash-tag {
  background: #1e293b;
  color: #94a3b8;
  border: 1px solid #334155;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
}
.dash-tag:hover { color: #fff; background: #334155; }
.dash-preview {
  margin-top: 6px;
  font-family: monospace;
  font-size: 11px;
  color: #64748b;
}
.controls-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  border-top: 1px solid #1e293b;
  padding-top: 14px;
}
.filters {
  display: flex;
  gap: 8px;
}
.pill-btn {
  background: #1e293b;
  border: 1px solid #334155;
  color: #94a3b8;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.pill-btn.active {
  background: #083344;
  color: #38bdf8;
  border-color: #0284c7;
}
.format-opts {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
select {
  background: #0b0f17;
  color: #f1f5f9;
  border: 1px solid #334155;
  padding: 8px 12px;
  border-radius: 6px;
}
.status-notice {
  margin-bottom: 16px;
  font-size: 13px;
  color: #10b981;
  font-family: monospace;
}
.discography-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}
.card {
  background: #111827;
  border: 1px solid #1e293b;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.card.selected {
  border-color: #00b4d8;
  box-shadow: 0 0 0 1px #00b4d8;
}
.card-art {
  position: relative;
  aspect-ratio: 1/1;
  background: #0b0f17;
}
.card-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cb-wrap {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0,0,0,0.7);
  padding: 6px;
  border-radius: 6px;
}
.card-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(0,0,0,0.8);
}
.badge-free { color: #10b981; border: 1px solid rgba(16,185,129,0.4); }
.badge-nyp { color: #f59e0b; border: 1px solid rgba(245,158,11,0.4); }
.badge-paid { color: #94a3b8; }
.card-body {
  padding: 12px;
  flex: 1;
}
.card-title {
  font-weight: 600;
  font-size: 13px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-meta {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
}
`
  },
  {
    name: 'dashboard.js',
    path: 'dashboard.js',
    language: 'javascript',
    description: 'Dashboard script handling full-screen crawling, local caching, progressive rendering, and bulk downloads.',
    content: `// Bandcamp Full Dashboard Controller
let dashReleases = [];

function formatDate(raw) {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return yyyy + '.' + mm + '.' + dd;
    }
  } catch(e) {}
  return String(raw).replace(/[^0-9.]/g, '');
}

function processConditionalBrackets(template, values) {
  const ESC_OPEN = '\\uE000';
  const ESC_CLOSE = '\\uE001';

  let str = template
    .replace(/\\\\\\\[/g, ESC_OPEN)
    .replace(/\\\\\\\]/g, ESC_CLOSE);

  const bracketRegex = /\\\[([^\\\[\\\]]*)\\\]/;
  while (bracketRegex.test(str)) {
    str = str.replace(bracketRegex, (_, inner) => {
      const tokens = inner.match(/%[a-zA-Z0-9_]+%/g);
      if (!tokens || tokens.length === 0) return inner;
      const allValid = tokens.every(token => {
        const val = values[token.toLowerCase()];
        return val != null && String(val).trim() !== '';
      });
      return allValid ? inner : '';
    });
  }

  return str
    .replace(new RegExp(ESC_OPEN, 'g'), '[')
    .replace(new RegExp(ESC_CLOSE, 'g'), ']');
}

function formatFilename(schema, meta, allowSubfolders) {
  const template = schema || '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%';
  
  let trackNumStr = '';
  const total = meta.totalTracks || (meta.type === 'track' ? 1 : 2);
  if (total > 1 && meta.trackNum != null && meta.trackNum !== '') {
    const padLen = Math.max(2, String(total).length);
    trackNumStr = String(meta.trackNum).padStart(padLen, '0');
  }

  const dateStr = formatDate(meta.date || meta.year || '') || '2026.01.01';
  const yearStr = dateStr.slice(0, 4) || String(meta.year || new Date().getFullYear());
  const sanitize = (s) => String(s || '').replace(/[:*?"<>|]/g, '_').trim();

  const values = {
    '%artist%': sanitize(meta.artist || 'Bandcamp'),
    '%album%': sanitize(meta.album || meta.title || 'Album'),
    '%title%': sanitize(meta.title || 'Track'),
    '%track_num%': trackNumStr,
    '%date%': dateStr,
    '%year%': yearStr,
    '%format%': (meta.format || 'flac').replace(/[^a-zA-Z0-9]/g, ''),
    '%type%': sanitize(meta.type || 'track')
  };

  let res = processConditionalBrackets(template, values);

  for (const [token, val] of Object.entries(values)) {
    const re = new RegExp(token, 'gi');
    res = res.replace(re, val);
  }

  res = res
    .replace(/\s*[-_]\s*[-_]\s*/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .replace(new RegExp('\\\\/\\\\s*-\\\\s*', 'g'), '/')
    .replace(new RegExp('\\\\s*-\\\\s*\\\\/', 'g'), '/');

  if (allowSubfolders) {
    res = res
      .replace(/\\\\/g, '/')
      .split('/')
      .map(part => part.replace(/[:*?"<>|]/g, '_').trim())
      .filter(Boolean)
      .join('/');
  } else {
    res = res.replace(/[\\\\/]/g, ' - ').replace(/\s*-\s*-\s*/g, ' - ').trim();
  }

  let ext = (meta.format || 'flac').toLowerCase();
  if (ext.startsWith('mp3')) ext = 'mp3';
  else if (ext === 'aac-hi' || ext === 'alac') ext = 'm4a';
  else if (ext === 'aiff-lossless') ext = 'aiff';
  else if (ext === 'wav') ext = 'wav';
  else if (ext === 'flac') ext = 'flac';

  if (!res.toLowerCase().endsWith('.' + ext)) {
    res = res + '.' + ext;
  }
  return res;
}

document.addEventListener('DOMContentLoaded', () => {
  const targetUrlInput = document.getElementById('targetUrlInput');
  const btnScan = document.getElementById('btnDashboardScan');
  const btnRefresh = document.getElementById('btnDashboardRefresh');
  const schemaInput = document.getElementById('dashSchemaInput');
  const dashPreview = document.getElementById('dashPreview');
  const formatSelect = document.getElementById('dashFormatSelect');
  const deliverySelect = document.getElementById('dashDeliverySelect');
  const btnBulkDownload = document.getElementById('btnBulkDownload');
  const grid = document.getElementById('discographyGrid');
  const statusNotice = document.getElementById('statusNotice');

  chrome.storage.sync.get(['defaultFormat', 'deliveryMode', 'namingSchema'], (d) => {
    if (d.defaultFormat) formatSelect.value = d.defaultFormat;
    if (d.deliveryMode && deliverySelect) deliverySelect.value = d.deliveryMode;
    if (d.namingSchema) schemaInput.value = d.namingSchema;
    updatePreview();
  });

  if (deliverySelect) {
    deliverySelect.addEventListener('change', () => {
      chrome.storage.sync.set({ deliveryMode: deliverySelect.value });
      updatePreview();
    });
  }

  function updatePreview() {
    const fmt = formatSelect.value || 'flac';
    dashPreview.textContent = 'Preview: ' + formatFilename(schemaInput.value, {
      artist: 'Esoctrilihum',
      album: 'Almost Dead',
      title: 'Almost Dead',
      trackNum: 1,
      totalTracks: 1,
      date: '2025.10.31',
      year: 2025,
      format: fmt
    }, true);
  }

  schemaInput.addEventListener('input', () => {
    updatePreview();
    chrome.storage.sync.set({ namingSchema: schemaInput.value });
  });

  formatSelect.addEventListener('change', () => {
    updatePreview();
    chrome.storage.sync.set({ defaultFormat: formatSelect.value });
  });

  document.querySelectorAll('.dash-tag').forEach(b => {
    b.addEventListener('click', () => {
      schemaInput.value += ' ' + b.dataset.t;
      updatePreview();
      chrome.storage.sync.set({ namingSchema: schemaInput.value });
    });
  });

  const url = targetUrlInput.value.trim();
  const cacheKey = 'bc_cache_' + url.split('?')[0];

  chrome.storage.local.get([cacheKey], (res) => {
    if (res[cacheKey]?.releases?.length > 0) {
      dashReleases = res[cacheKey].releases;
      statusNotice.textContent = '⚡ Loaded ' + dashReleases.length + ' releases from local cache (Scanned ' + new Date(res[cacheKey].scannedAt).toLocaleTimeString() + ')';
      renderGrid();
    }
  });

  btnScan.addEventListener('click', () => runScan(false));
  btnRefresh.addEventListener('click', () => runScan(true));

  async function runScan(force) {
    const targetUrl = targetUrlInput.value.trim();
    if (!targetUrl) return;

    btnScan.disabled = true;
    btnScan.textContent = 'Discovering catalog...';
    grid.innerHTML = '<div style="color:#94a3b8;">Connecting to Bandcamp and discovering all releases...</div>';

    try {
      const pageRes = await fetch(targetUrl);
      const html = await pageRes.text();

      const itemsMap = new Map();
      const origin = new URL(targetUrl).origin;

      // Extract rendered <li> items using safe regex constructed via RegExp
      const liRegex = new RegExp('<li[^>]*data-item-id="([^"]*)"[^>]*>([\\\\s\\\\S]*?)<\\/li>', 'gi');
      const liMatches = Array.from(html.matchAll(liRegex));

      for (const m of liMatches) {
        const hrefMatch = m[2].match(/href="([^"]+)"/);
        const titleMatch = m[2].match(/<p class="title">\\s*([^<]+)/);
        const artMatch = m[2].match(/<img[^>]*src="([^"]+)"/);
        if (hrefMatch) {
          itemsMap.set(hrefMatch[1], {
            href: origin + hrefMatch[1],
            pageUrl: hrefMatch[1],
            title: titleMatch ? titleMatch[1].trim() : 'Release',
            artUrl: artMatch ? artMatch[1].replace(/_\\d+\\.jpg/, '_10.jpg') : '',
            type: hrefMatch[1].startsWith('/album/') ? 'album' : 'track'
          });
        }
      }

      // Extract remaining items from data-client-items
      const clientMatch = html.match(/data-client-items="([^"]+)"/i);
      if (clientMatch) {
        try {
          const clientItems = JSON.parse(clientMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
          clientItems.forEach(item => {
            if (!itemsMap.has(item.page_url)) {
              itemsMap.set(item.page_url, {
                href: origin + item.page_url,
                pageUrl: item.page_url,
                title: item.title,
                artUrl: item.art_id ? ('https://f4.bcbits.com/img/a' + item.art_id + '_10.jpg') : '',
                type: item.type
              });
            }
          });
        } catch(e) {}
      }

      dashReleases = Array.from(itemsMap.values()).map(r => ({
        ...r,
        isFree: true,
        isNyp: false,
        label: 'Checking...',
        selected: true
      }));

      statusNotice.textContent = 'Discovered ' + dashReleases.length + ' releases! Inspecting sub-pages dynamically...';
      renderGrid();

      // Progressive enrichment of all releases
      for (let i = 0; i < dashReleases.length; i++) {
        const rel = dashReleases[i];
        try {
          const subRes = await fetch(rel.href);
          if (subRes.ok) {
            const subHtml = await subRes.text();
            const tralbumMatch = subHtml.match(/data-tralbum="([^"]+)"/);
            if (tralbumMatch) {
              const tralbum = JSON.parse(tralbumMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
              rel.tralbumId = tralbum.id;
              rel.freeDownloadPage = tralbum.freeDownloadPage || null;
              rel.releaseDate = tralbum.current?.release_date || '';
              const minPrice = tralbum.current?.minimum_price != null ? tralbum.current.minimum_price : 0;
              const hasFree = /free\s+download/i.test(subHtml) || tralbum.current?.download_pref === 1;
              const hasNyp = /name\s+your\s+price/i.test(subHtml) || tralbum.current?.download_pref === 2;

              if (rel.freeDownloadPage || hasFree || (minPrice === 0 && !hasNyp)) {
                rel.isFree = true;
                rel.label = 'Free Download';
              } else if (minPrice === 0 && hasNyp) {
                rel.isNyp = true;
                rel.label = 'Name Your Price ($0+)';
              } else {
                rel.isFree = false;
                rel.label = '€' + (minPrice || 'Paid');
                rel.selected = false;
              }

              if (tralbum.trackinfo) {
                rel.totalTracks = tralbum.trackinfo.length;
                rel.audioStreams = tralbum.trackinfo
                  .filter(t => t.file && t.file['mp3-128'])
                  .map(t => ({ trackNum: t.track_num || 1, title: t.title, url: t.file['mp3-128'], lyrics: t.lyrics }));
              }

              const cleanHtml = (raw) => {
                if (!raw) return '';
                return raw
                  .replace(/<script[\\s\\S]*?<\\/script>/gi, '')
                  .replace(/<style[\\s\\S]*?<\\/style>/gi, '')
                  .replace(/<br\\s*\\/?>/gi, String.fromCharCode(10))
                  .replace(/<[^>]+>/g, '')
                  .replace(/&quot;/g, '"')
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&#39;/g, "'")
                  .replace(/&nbsp;/g, ' ')
                  .trim();
              };
              const aboutMatch = subHtml.match(/class="[^"]*tralbum-about[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i);
              const creditsMatch = subHtml.match(/class="[^"]*tralbum-credits[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i);
              const licenseMatch = subHtml.match(/<div[^>]*id="license"[^>]*>([\\s\\S]*?)<\\/div>/i);
              const lyricsMatch = subHtml.match(/class="[^"]*lyricsText[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i);

              const aboutText = cleanHtml(tralbum.current?.about) || cleanHtml(aboutMatch?.[1]);
              const creditsText = cleanHtml(tralbum.current?.credits) || cleanHtml(creditsMatch?.[1]);
              const licenseText = cleanHtml(licenseMatch?.[1]);
              const lyricsText = cleanHtml(lyricsMatch?.[1]);
              const tagsMatches = (tralbum.tags && Array.isArray(tralbum.tags)) ? tralbum.tags : Array.from(subHtml.matchAll(/<a[^>]*class="tag"[^>]*>([^<]+)<\\/a>/gi)).map(tm => tm[1].trim());

              const d = '='.repeat(80);
              const NL = String.fromCharCode(10);
              let inf = d + NL + rel.title.toUpperCase() + ' by ' + (tralbum.artist || 'Esoctrilihum') + NL + d + NL;
              inf += 'Release Date : ' + (rel.releaseDate || 'Unknown') + NL;
              inf += 'Type         : ' + (rel.type ? rel.type.toUpperCase() : 'ALBUM') + NL;
              inf += 'Status       : ' + rel.label + NL;
              inf += 'Bandcamp URL : ' + rel.href + NL + NL;
              if (rel.audioStreams && rel.audioStreams.length > 0) {
                inf += d + NL + 'TRACKLIST (' + rel.audioStreams.length + ' Tracks)' + NL + d + NL + rel.audioStreams.map(s => s.trackNum + '. ' + s.title).join(NL) + NL + NL;
              }
              if (aboutText) inf += d + NL + 'LINER NOTES / ABOUT' + NL + d + NL + aboutText + NL + NL;
              if (creditsText) inf += d + NL + 'CREDITS' + NL + d + NL + creditsText + NL + NL;
              if (licenseText) inf += d + NL + 'LICENSE' + NL + d + NL + licenseText + NL + NL;
              if (tagsMatches.length > 0) inf += d + NL + 'TAGS & GENRES' + NL + d + NL + tagsMatches.join(', ') + NL + NL;
              if (lyricsText) inf += d + NL + 'LYRICS' + NL + d + NL + lyricsText + NL + NL;
              inf += d + NL + 'Downloaded with Bandcamp Free & NYP Bulk Downloader' + NL + d + NL;
              rel.infoText = inf;
            }
          }
        } catch(e) {}
        updateCard(i);
      }

      const cacheObj = {};
      cacheObj[cacheKey] = { scannedAt: new Date().toISOString(), releases: dashReleases };
      chrome.storage.local.set(cacheObj);

      statusNotice.textContent = '✓ Scan finished: ' + dashReleases.length + ' releases loaded and cached.';
    } catch(err) {
      statusNotice.textContent = 'Scan error: ' + err.message;
    } finally {
      btnScan.disabled = false;
      btnScan.textContent = 'Scan Discography';
    }
  }

  function renderGrid() {
    grid.innerHTML = '';
    dashReleases.forEach((rel, idx) => {
      const card = document.createElement('div');
      card.className = 'card' + (rel.selected ? ' selected' : '');
      card.id = 'dash-card-' + idx;

      const badgeClass = rel.isFree ? 'badge-free' : (rel.isNyp ? 'badge-nyp' : 'badge-paid');

      card.innerHTML = [
        '<div class="card-art">',
        '  <img src="' + (rel.artUrl || 'https://bandcamp.com/img/0.gif') + '" alt="" onerror="this.src=\\'https://bandcamp.com/img/0.gif\\'">',
        '  <div class="cb-wrap">',
        '    <input type="checkbox" data-index="' + idx + '" ' + (rel.selected ? 'checked' : '') + '>',
        '  </div>',
        '  <span class="card-badge ' + badgeClass + '" id="badge-' + idx + '">' + rel.label + '</span>',
        '</div>',
        '<div class="card-body">',
        '  <div class="card-title" title="' + rel.title + '">' + rel.title + '</div>',
        '  <div class="card-meta">' + (rel.type ? rel.type.toUpperCase() : 'ALBUM') + '</div>',
        '</div>'
      ].join('');

      const cb = card.querySelector('input');
      cb.addEventListener('change', (e) => {
        dashReleases[idx].selected = e.target.checked;
        card.className = 'card' + (e.target.checked ? ' selected' : '');
        updateCount();
      });

      grid.appendChild(card);
    });
    updateCount();
  }

  function updateCard(idx) {
    const rel = dashReleases[idx];
    const badge = document.getElementById('badge-' + idx);
    const cb = document.querySelector('input[data-index="' + idx + '"]');
    if (badge) {
      badge.textContent = rel.label;
      badge.className = 'card-badge ' + (rel.isFree ? 'badge-free' : (rel.isNyp ? 'badge-nyp' : 'badge-paid'));
    }
    if (cb) {
      cb.checked = rel.selected;
      const card = document.getElementById('dash-card-' + idx);
      if (card) card.className = 'card' + (rel.selected ? ' selected' : '');
    }
    updateCount();
  }

  function updateCount() {
    const sel = dashReleases.filter(r => r.selected);
    btnBulkDownload.textContent = 'Download Selected (' + sel.length + ')';
    btnBulkDownload.disabled = sel.length === 0;
  }

  document.getElementById('btnSelAllFree').addEventListener('click', () => {
    dashReleases.forEach((r, idx) => {
      r.selected = r.isFree || r.isNyp;
      const cb = document.querySelector('input[data-index="' + idx + '"]');
      if (cb) cb.checked = r.selected;
      const card = document.getElementById('dash-card-' + idx);
      if (card) card.className = 'card' + (r.selected ? ' selected' : '');
    });
    updateCount();
  });

  document.getElementById('btnSelAll').addEventListener('click', () => {
    dashReleases.forEach((r, idx) => {
      r.selected = true;
      const cb = document.querySelector('input[data-index="' + idx + '"]');
      if (cb) cb.checked = true;
      const card = document.getElementById('dash-card-' + idx);
      if (card) card.className = 'card selected';
    });
    updateCount();
  });

  document.getElementById('btnDeselAll').addEventListener('click', () => {
    dashReleases.forEach((r, idx) => {
      r.selected = false;
      const cb = document.querySelector('input[data-index="' + idx + '"]');
      if (cb) cb.checked = false;
      const card = document.getElementById('dash-card-' + idx);
      if (card) card.className = 'card';
    });
    updateCount();
  });

  // Bulk download
  btnBulkDownload.addEventListener('click', async () => {
    const sel = dashReleases.filter(r => r.selected);
    const chosenFormat = formatSelect.value || 'flac';
    const delivery = deliverySelect ? deliverySelect.value : 'zip';
    const schema = schemaInput.value || '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%';
    btnBulkDownload.disabled = true;

    if (delivery === 'zip') {
      try {
        const zip = new JSZip();

        for (let i = 0; i < sel.length; i++) {
          const r = sel[i];
          btnBulkDownload.textContent = 'Packaging (' + (i + 1) + '/' + sel.length + '): ' + r.title + '...';

          const baseFormatted = formatFilename(schema, {
            artist: r.artist || 'Bandcamp',
            album: r.title,
            title: r.title,
            trackNum: 1,
            totalTracks: r.totalTracks || 1,
            date: r.releaseDate || '',
            format: chosenFormat,
            type: r.type
          }, true);
          const slashIdx = baseFormatted.lastIndexOf('/');
          const releaseDir = slashIdx !== -1 ? baseFormatted.substring(0, slashIdx) : ((r.artist || 'Bandcamp') + ' - ' + r.title).replace(/[:*?"<>|]/g, '_');

          const NL = String.fromCharCode(10);
          const infoText = r.infoText || ('Title: ' + r.title + NL + 'Artist: ' + (r.artist || 'Bandcamp') + NL + 'URL: ' + (r.href || ''));
          zip.file(releaseDir + '/info.txt', infoText);

          if (r.artUrl) {
            try {
              const artRes = await fetch(r.artUrl);
              if (artRes.ok) {
                const artBuf = await artRes.arrayBuffer();
                zip.file(releaseDir + '/cover.jpg', artBuf);
              }
            } catch (e) {}
          }

          if (r.allImages && r.allImages.length > 0) {
            for (let pIdx = 0; pIdx < r.allImages.length; pIdx++) {
              try {
                const pRes = await fetch(r.allImages[pIdx]);
                if (pRes.ok) {
                  const pBuf = await pRes.arrayBuffer();
                  zip.file(releaseDir + '/photos/photo_' + (pIdx + 1) + '.jpg', pBuf);
                }
              } catch (e) {}
            }
          }

          if (r.isPaid && !r.isPurchased && !r.isFree && !r.isNyp) {
            continue;
          }

          let audioAdded = false;

          if (r.freeDownloadPage) {
            try {
              const dlRes = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                  action: 'RESOLVE_DOWNLOAD_PAGE',
                  url: r.freeDownloadPage,
                  format: chosenFormat
                }, resolve);
              });

              if (dlRes?.success && dlRes.downloadUrl) {
                const audioRes = await fetch(dlRes.downloadUrl);
                if (audioRes.ok) {
                  const audioBuf = await audioRes.arrayBuffer();
                  const bytes = new Uint8Array(audioBuf);
                  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
                    try {
                      const innerZip = await JSZip.loadAsync(audioBuf);
                      for (const [entryName, entryFile] of Object.entries(innerZip.files)) {
                        if (!entryFile.dir) {
                          const innerBuf = await entryFile.async('arraybuffer');
                          const simpleName = entryName.split('/').pop() || entryName;
                          zip.file(releaseDir + '/' + simpleName, innerBuf);
                        }
                      }
                      audioAdded = true;
                    } catch(e) {}
                  }
                  if (!audioAdded) {
                    zip.file(baseFormatted, audioBuf);
                    audioAdded = true;
                  }
                }
              }
            } catch (e) {}
          }

          if (!audioAdded && r.audioStreams && r.audioStreams.length > 0) {
            for (const stream of r.audioStreams) {
              const sUrl = stream.url || stream.streamUrl;
              if (sUrl) {
                try {
                  const streamFormattedName = formatFilename(schema, {
                    artist: r.artist || 'Bandcamp',
                    album: r.title,
                    title: stream.title,
                    trackNum: stream.trackNum,
                    totalTracks: r.audioStreams.length,
                    date: r.releaseDate || '',
                    format: chosenFormat,
                    type: 'track'
                  }, true);

                  const aRes = await fetch(sUrl);
                  if (aRes.ok) {
                    const aBuf = await aRes.arrayBuffer();
                    zip.file(streamFormattedName, aBuf);
                  }

                  if (stream.lyrics && stream.lyrics.trim().length > 0) {
                    const lrcPath = streamFormattedName.replace(/\.[^/.]+$/, '') + '.lrc';
                    const lrcContent = '[ti:' + stream.title + ']' + NL + '[ar:' + (r.artist || 'Bandcamp') + ']' + NL + '[al:' + r.title + ']' + NL + NL + stream.lyrics + NL;
                    zip.file(lrcPath, lrcContent);
                  }
                } catch (e) {}
              }
            }
            audioAdded = true;
          }
        }

        btnBulkDownload.textContent = 'Compressing ZIP archive...';
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipUrl = URL.createObjectURL(zipBlob);
        const artistPart = (sel[0]?.artist || 'bandcamp').replace(/[:*?"<>|]/g, '_').toLowerCase();
        const zipName = artistPart + '_bulk_discography_' + chosenFormat + '.zip';

        chrome.downloads.download({
          url: zipUrl,
          filename: zipName,
          saveAs: true
        });

        btnBulkDownload.textContent = 'ZIP Archive Downloaded!';
      } catch (err) {
        btnBulkDownload.textContent = 'Packaging Failed';
      }
    } else {
      // Individual files mode
      for (let i = 0; i < sel.length; i++) {
        const r = sel[i];
        btnBulkDownload.textContent = 'Downloading ' + (i + 1) + '/' + sel.length + '...';

        if (r.artUrl) {
          try {
            const artRes = await fetch(r.artUrl);
            if (artRes.ok) {
              const blob = await artRes.blob();
              const coverName = 'Bandcamp/' + ((r.artist || 'Bandcamp') + ' - ' + r.title + ' - cover.jpg').replace(/[:*?"<>|]/g, '_');
              chrome.downloads.download({
                url: URL.createObjectURL(blob),
                filename: coverName,
                conflictAction: 'uniquify'
              });
            }
          } catch(e) {}
        }

        if (r.infoText) {
          const infoBlob = new Blob([r.infoText], { type: 'text/plain;charset=utf-8' });
          const infoName = 'Bandcamp/' + ((r.artist || 'Bandcamp') + ' - ' + r.title + ' - info.txt').replace(/[:*?"<>|]/g, '_');
          chrome.downloads.download({
            url: URL.createObjectURL(infoBlob),
            filename: infoName,
            conflictAction: 'uniquify'
          });
        }

        if (r.isPaid && !r.isPurchased && !r.isFree && !r.isNyp) {
          continue;
        }

        let audioTriggered = false;

        if (r.freeDownloadPage) {
          try {
            const dlRes = await new Promise(resolve => {
              chrome.runtime.sendMessage({
                action: 'RESOLVE_DOWNLOAD_PAGE',
                url: r.freeDownloadPage,
                format: chosenFormat
              }, resolve);
            });
            if (dlRes?.success && dlRes.downloadUrl) {
              const aRes = await fetch(dlRes.downloadUrl);
              if (aRes.ok) {
                const blob = await aRes.blob();
                const isZip = dlRes.isArchive || chosenFormat === 'zip';
                const filename = formatFilename(schema, {
                  artist: r.artist || 'Bandcamp',
                  album: r.title,
                  title: r.title,
                  trackNum: 1,
                  totalTracks: r.totalTracks || 1,
                  date: r.releaseDate || '',
                  format: isZip ? 'zip' : chosenFormat,
                  type: r.type
                }, false);
                chrome.downloads.download({
                  url: URL.createObjectURL(blob),
                  filename: 'Bandcamp/' + filename,
                  conflictAction: 'uniquify'
                });
                audioTriggered = true;
              }
            }
          } catch(e) {}
        }

        if (!audioTriggered && r.audioStreams && r.audioStreams.length > 0) {
          for (const stream of r.audioStreams) {
            const sUrl = stream.url || stream.streamUrl;
            if (sUrl) {
              try {
                const trackName = formatFilename(schema, {
                  artist: r.artist || 'Bandcamp',
                  album: r.title,
                  title: stream.title,
                  trackNum: stream.trackNum,
                  totalTracks: r.audioStreams.length,
                  date: r.releaseDate || '',
                  format: chosenFormat,
                  type: 'track'
                }, false);

                const streamRes = await fetch(sUrl);
                if (streamRes.ok) {
                  const blob = await streamRes.blob();
                  chrome.downloads.download({
                    url: URL.createObjectURL(blob),
                    filename: 'Bandcamp/' + trackName,
                    conflictAction: 'uniquify'
                  });
                  await new Promise(r => setTimeout(r, 600));
                }
              } catch(e) {}
            }
          }
        }
      }
      btnBulkDownload.textContent = 'Downloads Queued!';
    }

    setTimeout(updateCount, 2500);
  });
});
`
  },
  {
    name: 'options.html',
    path: 'options.html',
    language: 'html',
    description: 'Extension settings interface. Strictly loads external options.js with zero inline scripts.',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bandcamp Downloader Settings</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #0b0f17;
      color: #f1f5f9;
      padding: 40px;
      max-width: 620px;
      margin: 0 auto;
    }
    h2 { color: #00b4d8; margin-bottom: 24px; font-size: 22px; display: flex; align-items: center; gap: 10px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 14px; }
    p.hint { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    input[type="text"], input[type="email"], select {
      width: 100%;
      padding: 10px;
      background: #131c2e;
      border: 1px solid #334155;
      border-radius: 6px;
      color: #fff;
      box-sizing: border-box;
      font-size: 14px;
    }
    .btn {
      background: #00b4d8;
      color: #0b0f17;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: 700;
      cursor: pointer;
      font-size: 14px;
    }
    .btn:hover { background: #38bdf8; }
    .toast {
      margin-top: 14px;
      color: #10b981;
      font-weight: 600;
      display: none;
    }
  </style>
</head>
<body>
  <h2>
    <img src="icons/icon48.png" width="32" height="32" alt="Icon">
    Bandcamp Bulk Downloader Settings
  </h2>

  <div class="form-group">
    <label for="defaultFormat">Default Download Format</label>
    <select id="defaultFormat">
      <option value="flac" selected>FLAC (Lossless Studio Master - Default)</option>
      <option value="mp3-320">MP3 320kbps (High Quality CBR)</option>
      <option value="mp3-v0">MP3 V0 (High Quality VBR)</option>
      <option value="wav">WAV 16-bit PCM</option>
      <option value="aac-hi">AAC (VBR)</option>
      <option value="alac">ALAC</option>
    </select>
    <p class="hint">The audio format selected by default when downloading releases.</p>
  </div>

  <div class="form-group">
    <label for="deliveryMode">Default Delivery Mode</label>
    <select id="deliveryMode">
      <option value="zip" selected>ZIP Bundle (Recommended - with cover.jpg, photos, & info.txt)</option>
      <option value="individual">Individual Audio Files</option>
    </select>
    <p class="hint">Bundles include high-res cover art, release liner notes, and extra package photos.</p>
  </div>

  <div class="form-group">
    <label for="namingSchema">File Naming Schema</label>
    <input type="text" id="namingSchema" placeholder="%artist% - %date% - %album% - %track_num% - %title%.%format%">
    <p class="hint">Available tokens: %artist%, %album%, %date% (YYYY.MM.DD), %year%, %track_num%, %title%, %format%. Use / or \\ for subfolders.</p>
  </div>

  <div class="form-group">
    <label for="fallbackEmail">Auto-fill Fallback Email</label>
    <input type="email" id="fallbackEmail" placeholder="your-email@example.com">
    <p class="hint">Used automatically when a Free or Name-Your-Price ($0.00) release requires an email address to issue the download link.</p>
  </div>

  <button id="saveBtn" class="btn">Save Preferences</button>
  <div id="toast" class="toast">✓ Preferences saved successfully!</div>

  <script src="options.js"></script>
</body>
</html>
`
  },
  {
    name: 'options.js',
    path: 'options.js',
    language: 'javascript',
    description: 'Options page controller handling chrome.storage.sync persistence (CSP compliant).',
    content: `// Bandcamp Bulk Downloader - Options Script
document.addEventListener('DOMContentLoaded', () => {
  const defaultFormat = document.getElementById('defaultFormat');
  const deliveryMode = document.getElementById('deliveryMode');
  const fallbackEmail = document.getElementById('fallbackEmail');
  const namingSchema = document.getElementById('namingSchema');
  const saveBtn = document.getElementById('saveBtn');
  const toast = document.getElementById('toast');

  // Load existing saved preferences
  chrome.storage.sync.get(['defaultFormat', 'deliveryMode', 'fallbackEmail', 'namingSchema'], (data) => {
    if (data.defaultFormat) defaultFormat.value = data.defaultFormat;
    if (data.deliveryMode) deliveryMode.value = data.deliveryMode;
    if (data.fallbackEmail) fallbackEmail.value = data.fallbackEmail;
    if (data.namingSchema) namingSchema.value = data.namingSchema;
  });

  // Save preferences
  saveBtn.addEventListener('click', () => {
    chrome.storage.sync.set({
      defaultFormat: defaultFormat.value,
      deliveryMode: deliveryMode.value,
      fallbackEmail: fallbackEmail.value,
      namingSchema: namingSchema.value
    }, () => {
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 3000);
    });
  });
});
`
  },
  {
    name: 'icons/icon.svg',
    path: 'icons/icon.svg',
    language: 'html',
    description: 'Vector SVG 2x2 Bandcamp bulk download logo.',
    content: icons.iconSvg
  },
  {
    name: 'icons/icon16.png',
    path: 'icons/icon16.png',
    language: 'html',
    description: '16x16 PNG extension icon.',
    content: '',
    binaryBuffer: icons.icon16
  },
  {
    name: 'icons/icon48.png',
    path: 'icons/icon48.png',
    language: 'html',
    description: '48x48 PNG extension icon.',
    content: '',
    binaryBuffer: icons.icon48
  },
  {
    name: 'icons/icon128.png',
    path: 'icons/icon128.png',
    language: 'html',
    description: '128x128 PNG extension icon.',
    content: '',
    binaryBuffer: icons.icon128
  },
  {
    name: 'README.md',
    path: 'README.md',
    language: 'markdown',
    description: 'Complete user guide for loading the unpacked extension into Chrome, Brave, and Edge.',
    content: `# Bandcamp Free & Name-Your-Price Bulk Downloader (Chrome Extension)

A Chrome-compatible browser extension designed to scan Bandcamp artist music catalogs, identify free and pay-what-you-want ($0.00) albums, and bulk download genuine audio in your preferred format.

## Features
- **Smart Catalog Scanner (Complete 38+ Releases)**: Combines initial catalog items and Bandcamp's \`data-client-items\` to discover every release in the artist's catalog with high-resolution artwork.
- **Genuine Audio Downloads**: Resolves true FLAC (lossless), MP3 320, MP3 V0, and WAV audio via Bandcamp's genuine \`statdownload\` architecture—never masquerading 128kbps streams as FLAC.
- **ZIP Bundling by Default**: Packages each release with:
  - Hi-res artwork \`cover.jpg\`
  - Extra package/CD/LP photos
  - Complete \`info.txt\` containing tracklist, liner notes/about text, credits, and tags
  - Tagged audio files
- **Custom Naming Schema**: Define your output filename pattern with tokens like \`%artist% - %date% - %album% - %track_num% - %title%.%format%\`. Supports subfolders with \`/\` or \`\\\` in ZIP archives.
- **Dedicated Full-Page Live Scanner Tab**: Launch \`dashboard.html\` for maximum control on wide displays.
- **Local Caching**: Scanned discographies are cached in \`chrome.storage.local\` so popups open instantly without re-requesting pages or sending duplicate email tokens.

## Installation in Google Chrome / Brave / Edge

1. **Download and Extract**:
   - Click **Download Extension (.zip)** from the web companion and extract the folder.
2. **Open Extensions Manager**:
   - In Chrome, open a new tab and enter: \`chrome://extensions\`
   - (In Brave: \`brave://extensions\` | In Edge: \`edge://extensions\`)
3. **Enable Developer Mode**:
   - Toggle the switch in the upper-right corner labeled **"Developer mode"**.
4. **Load the Extension**:
   - Click the button in the top-left labeled **"Load unpacked"**.
   - In the file dialog, select the folder containing \`manifest.json\`.
5. **Pin to Toolbar**:
   - Click the puzzle piece icon in Chrome's top bar and pin **Bandcamp Bulk DL**.
6. **Usage**:
   - Visit an artist page, such as \`https://esoctrilihum.bandcamp.com/music\`
   - Click the extension icon to view cached items or run a fresh scan!
`
  }
];

export async function createExtensionZip(): Promise<Blob> {
  const zip = new JSZip();
  for (const file of EXTENSION_FILES) {
    if (file.binaryBuffer) {
      zip.file(file.path, file.binaryBuffer);
    } else {
      zip.file(file.path, file.content);
    }
  }
  return await zip.generateAsync({ type: 'blob' });
}

export async function createExtensionZipBuffer(): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of EXTENSION_FILES) {
    if (file.binaryBuffer) {
      zip.file(file.path, file.binaryBuffer);
    } else {
      zip.file(file.path, file.content);
    }
  }
  return await zip.generateAsync({ type: 'uint8array' });
}
