import JSZip from 'jszip';
import jszipMinSource from 'jszip/dist/jszip.min.js?raw';
import { CORE_JS_SOURCE } from './coreSource';
import { ExtensionFileItem } from '../types/bandcamp';
import { getExtensionIconBuffers } from './iconGenerator';
import { GAS_SCRIPT_TEMPLATE } from './gasTemplate';

const icons = getExtensionIconBuffers();

export const EXTENSION_FILES: ExtensionFileItem[] = [
  {
    name: 'jszip.min.js',
    path: 'jszip.min.js',
    language: 'javascript',
    description: 'JSZip library for client-side companion info ZIP packaging.',
    content: jszipMinSource,
  },
  {
    name: 'core.js',
    path: 'core.js',
    language: 'javascript',
    description: 'Unified Bandcamp core engine (parsing, statdownload polling, and naming schema).',
    content: CORE_JS_SOURCE,
  },
  {
    name: 'manifest.json',
    path: 'manifest.json',
    language: 'json',
    description: 'Manifest V3 configuration with host permissions for Bandcamp, bcbits, and Google Apps Script webhooks.',
    content: `{
  "manifest_version": 3,
  "name": "Bandcamp Free & NYP Bulk Downloader",
  "version": "2.0.0",
  "description": "Bulk download Bandcamp discographies: true lossless studio FLAC, companion (info).zip with untruncated info.txt, cover.jpg, artist.jpg, photos/, and lyrics, Gmail watchdog, and anti-captcha pacing.",
  "permissions": [
    "activeTab",
    "downloads",
    "storage",
    "scripting"
  ],
  "host_permissions": [
    "https://*.bandcamp.com/*",
    "https://*.bcbits.com/*",
    "https://script.google.com/*",
    "https://script.googleusercontent.com/*"
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
      "js": ["core.js", "content.js"],
      "run_at": "document_idle"
    }
  ]
}`
  },
  {
    name: 'background.js',
    path: 'background.js',
    language: 'javascript',
    description: 'Background Service Worker handling CORS-free fetching, token dispatch, statdownload resolution, GAS webhook queries, and downloads.',
    content: `// Bandcamp Bulk Downloader - Background Service Worker (Manifest V3)
importScripts('core.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get([
    'defaultFormat',
    'createCompanionInfoZip',
    'fallbackEmail',
    'namingSchema',
    'gasWebhookUrl',
    'gasSecret',
    'pacingBaseDelay',
    'pacingJitter',
    'cooldownBatch',
    'cooldownDuration'
  ], (res) => {
    const updates = {};
    if (!res.defaultFormat) updates.defaultFormat = 'flac';
    if (res.createCompanionInfoZip === undefined) updates.createCompanionInfoZip = true;
    if (!res.namingSchema) updates.namingSchema = '%artist% - %date% - %album%[%title%.%format%]';
    if (res.pacingBaseDelay === undefined) updates.pacingBaseDelay = 2.5;
    if (res.pacingJitter === undefined) updates.pacingJitter = 40;
    if (res.cooldownBatch === undefined) updates.cooldownBatch = 5;
    if (res.cooldownDuration === undefined) updates.cooldownDuration = 12;

    if (Object.keys(updates).length > 0) {
      chrome.storage.sync.set(updates);
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Fetch sub-page HTML with curl UA to bypass Fastly challenges
  if (request.action === 'FETCH_SUBPAGE') {
    fetch(request.url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
        'User-Agent': 'curl/8.4.0'
      }
    })
      .then(res => res.text())
      .then(html => sendResponse({ success: true, html }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 2. Resolve free/email download link via Bandcamp page blob + statdownload API (resolves true studio FLAC/ZIP)
  if (request.action === 'RESOLVE_DOWNLOAD_PAGE') {
    (async () => {
      try {
        const requestedFormat = request.format || 'flac';
        const resolved = await resolveBandcampDownload(request.url, requestedFormat);
        sendResponse(resolved);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 3. Submit email for free download token (dispatch)
  if (request.action === 'SUBMIT_EMAIL_DOWNLOAD') {
    const { artistUrl, itemId, itemType, email, format } = request;
    const body = new URLSearchParams({
      encoding_name: format || 'flac',
      item_id: String(itemId),
      item_type: itemType || 'album',
      address: email || 'listener@example.com',
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

  // 4. Query Google Apps Script Webhook
  if (request.action === 'QUERY_GAS_WEBHOOK') {
    const { gasUrl, secret, releaseId, title, since } = request;
    try {
      const url = new URL(gasUrl);
      url.searchParams.set('secret', secret);
      if (releaseId) url.searchParams.set('id', String(releaseId));
      if (title) url.searchParams.set('title', title);
      if (since) url.searchParams.set('since', String(since));

      fetch(url.toString(), {
        redirect: 'follow',
        headers: { 'Accept': 'application/json, text/plain, */*' }
      })
        .then(r => r.text())
        .then(text => {
          try {
            sendResponse({ success: true, data: JSON.parse(text) });
          } catch(e) {
            sendResponse({ success: false, error: 'Non-JSON response from Google Apps Script' });
          }
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
    } catch(urlErr) {
      sendResponse({ success: false, error: 'Invalid GAS Webhook URL' });
    }
    return true;
  }

  // 5. Open full Live Scanner tab
  if (request.action === 'OPEN_DASHBOARD_TAB') {
    const targetUrl = request.url ? ('dashboard.html?url=' + encodeURIComponent(request.url) + (request.autostart ? '&autostart=1' : '')) : 'dashboard.html';
    chrome.tabs.create({ url: chrome.runtime.getURL(targetUrl) });
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
    description: 'Content script scanning all discography releases with high-res artwork and bio image.',
    content: `// Bandcamp Content Script: Discography & Free Release Scanner

(function() {
  function scanFullDiscography() {
    const isBandcamp = window.location.hostname.endsWith('bandcamp.com');
    if (!isBandcamp) return { error: 'Not on a Bandcamp domain.' };

    const artistName = document.querySelector('#band-name-location .title')?.textContent?.trim() ||
                       document.querySelector('meta[property="og:site_name"]')?.content ||
                       window.location.hostname.split('.')[0];

    // Artist bio image (renamed to artist.jpg)
    const bioImg = document.querySelector('#bio-container .bio-pic img') ||
                   document.querySelector('.band-photo') ||
                   document.querySelector('img.photo');
    const artistBioPicUrl = bioImg ? (bioImg.getAttribute('src') || '').replace(/_\\d+\\.jpg/, '_10.jpg') : '';

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
      const artUrl = rawSrc ? rawSrc.replace(/_\\d+\\.jpg/, '_10.jpg') : '';

      itemsMap.set(href, {
        id: li.getAttribute('data-item-id') || href,
        itemId: li.getAttribute('data-item-id'),
        href: window.location.origin + href,
        pageUrl: href,
        title,
        artUrl,
        artist: artistName,
        artistBioPicUrl,
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
                artistBioPicUrl,
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
      artistBioPicUrl,
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
    description: 'Popup launcher with direct full tab redirection to prevent background worker termination.',
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
      <a href="options.html" target="_blank" class="opt-btn" title="Settings">⚙️ Settings</a>
    </div>
  </div>

  <div class="card-box">
    <div class="site-header">
      <span class="site-title" id="siteTitle">Detecting active page...</span>
      <span class="session-badge" id="sessionBadge">Checking</span>
    </div>
    <p class="desc" id="statusDesc">Connect to any Bandcamp catalog to scan releases, negotiate FLAC/320, and download paired studio audio & companion (info).zip.</p>

    <div class="actions">
      <button id="btnOpenDashboard" class="btn primary">
        ↗ Open Dedicated Live Scanner Tab
      </button>
      <button id="btnQuickResume" class="btn resume" style="display:none;">
        ▶ Resume Download In Dedicated Tab
      </button>
    </div>
  </div>

  <div class="footer-info">
    <span>Downloads run in a dedicated full tab to ensure worker and file streams stay alive.</span>
  </div>

  <script src="popup.js"></script>
</body>
</html>
`
  },
  {
    name: 'popup.css',
    path: 'popup.css',
    language: 'css',
    description: 'Popup launcher styling.',
    content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  width: 340px;
  background: #0b0f17;
  color: #f1f5f9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  padding: 14px;
}
.top-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: #00b4d8;
  font-size: 14px;
}
.opt-btn {
  color: #94a3b8;
  text-decoration: none;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 4px;
  background: #1e293b;
}
.opt-btn:hover { color: #fff; background: #334155; }
.card-box {
  background: #111827;
  border: 1px solid #1e293b;
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.site-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.site-title {
  font-weight: 600;
  font-size: 13px;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.session-badge {
  font-size: 10px;
  font-family: monospace;
  padding: 2px 6px;
  border-radius: 4px;
  background: #1e293b;
  color: #94a3b8;
}
.session-badge.ready { background: #064e3b; color: #6ee7b7; }
.session-badge.resume { background: #0284c7; color: #bae6fd; }
.desc {
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.4;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.btn {
  width: 100%;
  padding: 10px;
  border-radius: 6px;
  border: none;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.btn.primary { background: #00b4d8; color: #0b0f17; }
.btn.resume { background: #10b981; color: #0b0f17; }
.btn:hover { opacity: 0.9; }
.footer-info {
  margin-top: 10px;
  font-size: 10px;
  color: #64748b;
  text-align: center;
  line-height: 1.3;
}
`
  },
  {
    name: 'popup.js',
    path: 'popup.js',
    language: 'javascript',
    description: 'Popup launcher controller opening full dashboard to preserve downloads.',
    content: `// Bandcamp Bulk Downloader - Popup Script
document.addEventListener('DOMContentLoaded', () => {
  const siteTitle = document.getElementById('siteTitle');
  const sessionBadge = document.getElementById('sessionBadge');
  const statusDesc = document.getElementById('statusDesc');
  const btnOpenDashboard = document.getElementById('btnOpenDashboard');
  const btnQuickResume = document.getElementById('btnQuickResume');

  let activeUrl = 'https://esoctrilihum.bandcamp.com/music';
  let activeHostname = 'esoctrilihum.bandcamp.com';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('bandcamp.com')) {
      activeUrl = tab.url;
      try {
        activeHostname = new URL(activeUrl).hostname;
      } catch(e) {}
    }

    siteTitle.textContent = activeHostname;

    const sessionKey = 'bc_session_v2_' + activeHostname.toLowerCase();
    chrome.storage.local.get([sessionKey], (res) => {
      const sess = res[sessionKey];
      if (sess && sess.items) {
        const itemIds = Object.keys(sess.items);
        const completed = itemIds.filter(id => sess.items[id].stage === 'completed').length;
        const failed = itemIds.filter(id => sess.items[id].stage === 'failed').length;
        const pending = itemIds.filter(id => sess.items[id].stage === 'pending').length;

        if (completed > 0 && (pending > 0 || failed > 0)) {
          sessionBadge.textContent = 'Can Resume';
          sessionBadge.className = 'session-badge resume';
          statusDesc.textContent = 'Session active: ' + completed + ' completed, ' + (pending + failed) + ' remaining (' + failed + ' failed). Click Resume to continue without re-downloading finished releases.';
          btnQuickResume.style.display = 'block';
          btnQuickResume.textContent = '▶ Resume Download (' + (pending + failed) + ' remaining)';
        } else {
          sessionBadge.textContent = completed + '/' + itemIds.length + ' done';
          sessionBadge.className = 'session-badge ready';
          statusDesc.textContent = 'Catalog cached: ' + itemIds.length + ' releases discovered. Ready to scan and download paired studio audio & companion info ZIPs.';
        }
      } else {
        sessionBadge.textContent = 'New Site';
        statusDesc.textContent = 'Ready to discover releases and download lossless FLAC with untruncated info.txt, artwork, photos, and lyrics.';
      }
    });
  });

  btnOpenDashboard.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'OPEN_DASHBOARD_TAB',
      url: activeUrl,
      autostart: false
    });
    window.close();
  });

  btnQuickResume.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'OPEN_DASHBOARD_TAB',
      url: activeUrl,
      autostart: true
    });
    window.close();
  });
});
`
  },
  {
    name: 'dashboard.html',
    path: 'dashboard.html',
    language: 'html',
    description: 'Full-page Live Scanner tab providing persistent multi-site queue, companion info zip builder, GAS watchdog, and anti-captcha pacing.',
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
      <button id="btnOpenGasModal" class="nav-btn">Watchdog Settings ⚙️</button>
      <a href="options.html" target="_blank" class="nav-link">Extension Options</a>
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
        <input type="text" id="dashSchemaInput" value="%artist% - %date% - %album%[%title%.%format%]">
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

          <label class="cb-label">
            <input type="checkbox" id="cbCompanionZip" checked>
            <span>Companion (info).zip</span>
          </label>

          <div class="action-buttons">
            <button id="btnResumeDownload" class="btn resume" style="display:none;">▶ Resume Download</button>
            <button id="btnBulkDownload" class="btn download">Start Download (0)</button>
          </div>
        </div>
      </div>
    </div>

    <div id="pacingNotice" class="pacing-notice" style="display:none;"></div>
    <div id="statusNotice" class="status-notice"></div>

    <div id="discographyGrid" class="discography-grid"></div>
  </main>

  <!-- Google Apps Script Modal -->
  <div id="gasModal" class="modal-backdrop" style="display:none;">
    <div class="modal-card">
      <div class="modal-header">
        <h3>Google Apps Script Email-Walled Watchdog</h3>
        <button id="btnCloseGasModal" class="close-btn">✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-desc">
          Automate receiving signed Bandcamp download links for email-walled Name Your Price releases using your deployed Google Apps Script web app.
        </p>

        <label class="modal-label">GAS Web App URL:</label>
        <input type="url" id="modalGasUrl" placeholder="https://script.google.com/macros/s/.../exec" class="modal-input">

        <label class="modal-label">Secret Password (Matches SECRET in Code.gs):</label>
        <input type="text" id="modalGasSecret" placeholder="my_secure_secret" class="modal-input">

        <div class="modal-actions">
          <button id="btnTestGasModal" class="btn secondary">Test Webhook</button>
          <button id="btnCopyGasScript" class="btn secondary">Copy Code.gs Template</button>
          <button id="btnSaveGasModal" class="btn primary">Save Watchdog Settings</button>
        </div>
        <div id="modalGasStatus" class="modal-status"></div>
      </div>
    </div>
  </div>

  <script src="jszip.min.js"></script>
  <script src="core.js"></script>
  <script src="dashboard.js"></script>
</body>
</html>
`
  },
  {
    name: 'dashboard.css',
    path: 'dashboard.css',
    language: 'css',
    description: 'Dashboard tab styling.',
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
  gap: 16px;
}
.artist-name {
  font-size: 13px;
  color: #94a3b8;
}
.nav-btn {
  background: #1e293b;
  border: 1px solid #334155;
  color: #fbbf24;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.nav-btn:hover { background: #334155; color: #fff; }
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
  margin-bottom: 20px;
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
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s;
}
.btn.primary { background: #00b4d8; color: #0b0f17; }
.btn.secondary { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; }
.btn.download { background: #00b4d8; color: #0b0f17; font-weight: 700; }
.btn.resume { background: #10b981; color: #0b0f17; font-weight: 700; }
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
.cb-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #cbd5e1;
  font-size: 12px;
  cursor: pointer;
}
.action-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}
select {
  background: #0b0f17;
  color: #f1f5f9;
  border: 1px solid #334155;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.status-notice {
  margin-bottom: 20px;
  font-size: 13px;
  color: #94a3b8;
}
.pacing-notice {
  margin-bottom: 14px;
  padding: 10px 16px;
  background: #082f49;
  border: 1px solid #0284c7;
  border-radius: 8px;
  color: #38bdf8;
  font-size: 12px;
  font-family: monospace;
}
.discography-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
}
.card {
  background: #111827;
  border: 1px solid #1e293b;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform 0.15s, border-color 0.15s;
}
.card.selected {
  border-color: #00b4d8;
  background: #0e1e33;
}
.card-art {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
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
  background: rgba(0, 0, 0, 0.6);
  padding: 4px;
  border-radius: 4px;
}
.card-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  text-transform: uppercase;
}
.badge-free { background: #064e3b; color: #6ee7b7; }
.badge-nyp { background: #78350f; color: #fde68a; }
.badge-paid { background: #334155; color: #94a3b8; }
.badge-completed { background: #064e3b; color: #6ee7b7; }
.badge-failed { background: #7f1d1d; color: #fca5a5; }
.badge-progress { background: #0369a1; color: #bae6fd; }

.card-body {
  padding: 12px;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.card-title {
  font-weight: 600;
  font-size: 13px;
  color: #fff;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-meta {
  font-size: 11px;
  color: #94a3b8;
}
.card-stage-info {
  margin-top: 8px;
  padding: 6px;
  background: #090d16;
  border-radius: 4px;
  font-size: 10px;
  color: #cbd5e1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.btn-retry-card {
  background: #7f1d1d;
  color: #fff;
  border: none;
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 10px;
  cursor: pointer;
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
}
.modal-card {
  background: #111827;
  border: 1px solid #334155;
  border-radius: 12px;
  max-width: 600px;
  width: 100%;
  padding: 24px;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.modal-header h3 {
  font-size: 16px;
  color: #fbbf24;
}
.close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 16px;
  cursor: pointer;
}
.modal-desc {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 14px;
  line-height: 1.4;
}
.modal-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
  color: #e2e8f0;
}
.modal-input {
  width: 100%;
  background: #0b0f17;
  border: 1px solid #334155;
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}
.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.modal-status {
  margin-top: 12px;
  font-size: 12px;
  font-family: monospace;
}
`
  },
  {
    name: 'dashboard.js',
    path: 'dashboard.js',
    language: 'javascript',
    description: 'Dashboard controller managing multi-site queue persistence, companion info zip builder, GAS email polling, and pacing.',
    content: `// Bandcamp Live Scanner Dashboard - Multi-Site Persistent Controller
let dashReleases = [];
let currentHostname = 'esoctrilihum.bandcamp.com';
let isRunningQueue = false;
let isCancelled = false;

// GAS Script Template Embedded
const GAS_CODE_GS = ${JSON.stringify(GAS_SCRIPT_TEMPLATE)};

// Inherit single source of truth from core.js
const {
  formatFilenameBySchema,
  getCompanionInfoZipName,
  parseReleasePageData,
  extractBandcampTralbum,
  extractArtistBioPicUrl,
  cleanHtmlText,
  formatDateToDotString,
} = window.BandcampCore || globalThis;

function sanitize(s) {
  return cleanHtmlText(s).replace(/[:*?"<>|/]/g, '_').trim();
}

function calculateDelay(base, jitterPercent) {
  const baseMs = Math.max(500, base * 1000);
  const frac = (jitterPercent || 40) / 100;
  const variation = (Math.random() * 2 - 1) * (baseMs * frac);
  return Math.max(400, Math.round(baseMs + variation));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

document.addEventListener('DOMContentLoaded', () => {
  const targetUrlInput = document.getElementById('targetUrlInput');
  const btnScan = document.getElementById('btnDashboardScan');
  const btnRefresh = document.getElementById('btnDashboardRefresh');
  const schemaInput = document.getElementById('dashSchemaInput');
  const dashPreview = document.getElementById('dashPreview');
  const formatSelect = document.getElementById('dashFormatSelect');
  const cbCompanionZip = document.getElementById('cbCompanionZip');
  const btnBulkDownload = document.getElementById('btnBulkDownload');
  const btnResumeDownload = document.getElementById('btnResumeDownload');
  const grid = document.getElementById('discographyGrid');
  const statusNotice = document.getElementById('statusNotice');
  const pacingNotice = document.getElementById('pacingNotice');

  // GAS Modal elements
  const btnOpenGasModal = document.getElementById('btnOpenGasModal');
  const gasModal = document.getElementById('gasModal');
  const btnCloseGasModal = document.getElementById('btnCloseGasModal');
  const modalGasUrl = document.getElementById('modalGasUrl');
  const modalGasSecret = document.getElementById('modalGasSecret');
  const btnTestGasModal = document.getElementById('btnTestGasModal');
  const btnCopyGasScript = document.getElementById('btnCopyGasScript');
  const btnSaveGasModal = document.getElementById('btnSaveGasModal');
  const modalGasStatus = document.getElementById('modalGasStatus');

  // Check URL query parameters
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('url')) {
    targetUrlInput.value = decodeURIComponent(urlParams.get('url'));
  }

  try {
    currentHostname = new URL(targetUrlInput.value.trim()).hostname;
  } catch(e) {}

  // Load preferences
  chrome.storage.sync.get([
    'defaultFormat',
    'createCompanionInfoZip',
    'namingSchema',
    'gasWebhookUrl',
    'gasSecret',
    'fallbackEmail',
    'pacingBaseDelay',
    'pacingJitter',
    'cooldownBatch',
    'cooldownDuration'
  ], (d) => {
    if (d.defaultFormat) formatSelect.value = d.defaultFormat;
    if (d.createCompanionInfoZip !== undefined) cbCompanionZip.checked = d.createCompanionInfoZip;
    if (d.namingSchema) schemaInput.value = d.namingSchema;
    if (d.gasWebhookUrl) modalGasUrl.value = d.gasWebhookUrl;
    if (d.gasSecret) modalGasSecret.value = d.gasSecret;
    updatePreview();
  });

  function updatePreview() {
    const fmt = formatSelect.value || 'flac';
    dashPreview.textContent = 'Preview: ' + formatFilenameBySchema(schemaInput.value, {
      artist: 'Esoctrilihum',
      album: 'Almost Dead',
      title: 'Almost Dead',
      trackNum: 1,
      totalTracks: 1,
      date: '2025.10.31',
      year: 2025,
      format: fmt
    }, { isArchive: false });
  }

  schemaInput.addEventListener('input', () => {
    updatePreview();
    chrome.storage.sync.set({ namingSchema: schemaInput.value });
  });

  formatSelect.addEventListener('change', () => {
    updatePreview();
    chrome.storage.sync.set({ defaultFormat: formatSelect.value });
  });

  cbCompanionZip.addEventListener('change', () => {
    chrome.storage.sync.set({ createCompanionInfoZip: cbCompanionZip.checked });
  });

  document.querySelectorAll('.dash-tag').forEach(b => {
    b.addEventListener('click', () => {
      schemaInput.value += ' ' + b.dataset.t;
      updatePreview();
      chrome.storage.sync.set({ namingSchema: schemaInput.value });
    });
  });

  // Modal handlers
  btnOpenGasModal.addEventListener('click', () => {
    gasModal.style.display = 'flex';
  });

  btnCloseGasModal.addEventListener('click', () => {
    gasModal.style.display = 'none';
  });

  btnCopyGasScript.addEventListener('click', () => {
    navigator.clipboard.writeText(GAS_CODE_GS);
    modalGasStatus.textContent = '✓ Copied Code.gs template to clipboard!';
    modalGasStatus.style.color = '#34d399';
  });

  btnSaveGasModal.addEventListener('click', () => {
    chrome.storage.sync.set({
      gasWebhookUrl: modalGasUrl.value.trim(),
      gasSecret: modalGasSecret.value.trim()
    }, () => {
      modalGasStatus.textContent = '✓ Saved watchdog settings!';
      modalGasStatus.style.color = '#34d399';
      setTimeout(() => { gasModal.style.display = 'none'; }, 1000);
    });
  });

  btnTestGasModal.addEventListener('click', () => {
    const url = modalGasUrl.value.trim();
    const secret = modalGasSecret.value.trim();
    if (!url) {
      modalGasStatus.textContent = 'Please enter a webhook URL first.';
      modalGasStatus.style.color = '#f87171';
      return;
    }

    modalGasStatus.textContent = 'Testing connection to Google Apps Script...';
    modalGasStatus.style.color = '#38bdf8';

    chrome.runtime.sendMessage({
      action: 'QUERY_GAS_WEBHOOK',
      gasUrl: url,
      secret: secret,
      since: Math.floor(Date.now() / 1000)
    }, (res) => {
      if (res && res.success) {
        modalGasStatus.textContent = '✓ Webhook is online and authorized successfully!';
        modalGasStatus.style.color = '#34d399';
      } else {
        modalGasStatus.textContent = 'Error: ' + (res?.error || 'Failed connecting to webhook');
        modalGasStatus.style.color = '#f87171';
      }
    });
  });

  // Load session from chrome.storage.local
  function loadLocalSession() {
    try {
      currentHostname = new URL(targetUrlInput.value.trim()).hostname;
    } catch(e) {}

    const sessionKey = 'bc_session_v2_' + currentHostname.toLowerCase();
    chrome.storage.local.get([sessionKey], (res) => {
      const sess = res[sessionKey];
      if (sess && sess.releases && sess.releases.length > 0) {
        dashReleases = sess.releases;
        statusNotice.textContent = '⚡ Loaded ' + dashReleases.length + ' releases from session for ' + currentHostname;
        renderGrid();

        if (urlParams.get('autostart') === '1' && !isRunningQueue) {
          executeQueue(true);
        }
      } else {
        runScan(false);
      }
    });
  }

  loadLocalSession();

  btnScan.addEventListener('click', () => runScan(false));
  btnRefresh.addEventListener('click', () => runScan(true));

  async function runScan(force) {
    const targetUrl = targetUrlInput.value.trim();
    if (!targetUrl) return;

    try {
      currentHostname = new URL(targetUrl).hostname;
    } catch(e) {}

    btnScan.disabled = true;
    btnScan.textContent = 'Discovering catalog...';
    grid.innerHTML = '<div style="color:#94a3b8;">Discovering all releases from ' + currentHostname + '...</div>';

    try {
      const pageRes = await fetch(targetUrl);
      const html = await pageRes.text();

      const itemsMap = new Map();
      const origin = new URL(targetUrl).origin;

      // Extract artist bio picture
      const bioPicIdMatch = html.match(/"bio_pic_id"\\s*:\\s*(\\d+)/);
      let artistBioPicUrl = bioPicIdMatch ? ('https://f4.bcbits.com/img/00' + bioPicIdMatch[1] + '_10.jpg') : '';

      // Extract initial <li> items
      const liRegex = new RegExp('<li[^>]*data-item-id="([^"]*)"[^>]*>([\\\\s\\\\S]*?)<\\/li>', 'gi');
      const liMatches = Array.from(html.matchAll(liRegex));

      for (const m of liMatches) {
        const hrefMatch = m[2].match(/href="([^"]+)"/);
        const titleMatch = m[2].match(/<p class="title">\\s*([^<]+)/);
        const artMatch = m[2].match(/<img[^>]*src="([^"]+)"/);
        if (hrefMatch) {
          itemsMap.set(hrefMatch[1], {
            id: m[1] || hrefMatch[1],
            itemId: m[1],
            href: origin + hrefMatch[1],
            pageUrl: hrefMatch[1],
            title: titleMatch ? titleMatch[1].trim() : 'Release',
            artUrl: artMatch ? artMatch[1].replace(/_\\d+\\.jpg/, '_10.jpg') : '',
            artistBioPicUrl,
            type: hrefMatch[1].startsWith('/album/') ? 'album' : 'track'
          });
        }
      }

      // Extract client items
      const clientMatch = html.match(/data-client-items="([^"]+)"/i);
      if (clientMatch) {
        try {
          const clientItems = JSON.parse(clientMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
          clientItems.forEach(item => {
            if (!itemsMap.has(item.page_url)) {
              itemsMap.set(item.page_url, {
                id: (item.type || 'item') + '-' + item.id,
                itemId: item.id,
                href: origin + item.page_url,
                pageUrl: item.page_url,
                title: item.title,
                artUrl: item.art_id ? ('https://f4.bcbits.com/img/a' + item.art_id + '_10.jpg') : '',
                artistBioPicUrl,
                type: item.type === 'album' || item.page_url.startsWith('/album/') ? 'album' : 'track'
              });
            }
          });
        } catch(e) {}
      }

      const artistName = html.match(/<meta property="og:site_name" content="([^"]+)"/)?.[1] || currentHostname.split('.')[0];
      const rawReleases = Array.from(itemsMap.values()).map(r => ({
        ...r,
        artist: artistName,
        stage: 'pending',
        stageProgress: 0,
        statusText: 'Pending'
      }));

      dashReleases = rawReleases;
      renderGrid();

      // Enrich releases with subpages
      for (let i = 0; i < dashReleases.length; i++) {
        const rel = dashReleases[i];
        btnScan.textContent = 'Enriching (' + (i + 1) + '/' + dashReleases.length + ')...';

        try {
          const subRes = await fetch(rel.href);
          const subHtml = await subRes.text();

          const tralbum = extractBandcampTralbum(subHtml);
          const parsed = parseReleasePageData(subHtml, tralbum, {
            id: rel.id,
            itemId: rel.itemId,
            url: rel.href,
            title: rel.title,
            artUrl: rel.artUrl,
            type: rel.type
          }, origin, artistName, artistBioPicUrl);

          rel.title = parsed.releaseTitle;
          rel.artist = parsed.artist;
          rel.artUrl = parsed.artUrl;
          rel.artistBioPicUrl = parsed.artistBioPicUrl;
          rel.extraImages = parsed.allImages || parsed.extraImages;
          rel.releaseDate = parsed.dotDate || '';
          rel.humanDate = parsed.humanDate || '';
          rel.fromAlbumTitle = parsed.fromAlbumTitle || '';
          rel.isFree = parsed.isFree;
          rel.isNyp = parsed.isNyp;
          rel.isPaid = parsed.isPaid;
          rel.isPurchased = parsed.isPurchased;
          rel.minPrice = parsed.minPrice;
          rel.label = parsed.priceFormatted;
          rel.selected = parsed.isFree || parsed.isNyp;
          rel.audioStreams = parsed.audioStreams;
          rel.totalTracks = parsed.audioStreams.length;
          rel.tags = parsed.tagsMatches;
          rel.aboutText = parsed.aboutText;
          rel.creditsText = parsed.creditsText;
          rel.infoText = parsed.infoText;
          rel.freeDownloadPage = parsed.freeDlPage || null;
          rel.requiresEmail = parsed.requireEmail;
        } catch(e) {}
        updateCard(i);
      }

      saveSession();
      statusNotice.textContent = '✓ Scan complete: ' + dashReleases.length + ' releases discovered for ' + currentHostname;
    } catch(err) {
      statusNotice.textContent = 'Scan error: ' + err.message;
    } finally {
      btnScan.disabled = false;
      btnScan.textContent = 'Scan Discography';
    }
  }

  function saveSession() {
    const sessionKey = 'bc_session_v2_' + currentHostname.toLowerCase();
    const sessObj = {};
    const itemsMap = {};
    dashReleases.forEach(r => { itemsMap[r.id] = r; });
    sessObj[sessionKey] = {
      hostname: currentHostname,
      updatedAt: new Date().toISOString(),
      releases: dashReleases,
      items: itemsMap
    };
    chrome.storage.local.set(sessObj);
  }

  function renderGrid() {
    grid.innerHTML = '';
    dashReleases.forEach((rel, idx) => {
      const card = document.createElement('div');
      card.className = 'card' + (rel.selected ? ' selected' : '');
      card.id = 'dash-card-' + idx;

      let badgeClass = 'badge-paid';
      if (rel.stage === 'completed') badgeClass = 'badge-completed';
      else if (rel.stage === 'failed') badgeClass = 'badge-failed';
      else if (rel.stage && rel.stage !== 'pending') badgeClass = 'badge-progress';
      else if (rel.isFree) badgeClass = 'badge-free';
      else if (rel.isNyp) badgeClass = 'badge-nyp';

      card.innerHTML = [
        '<div class="card-art">',
        '  <img src="' + (rel.artUrl || 'https://bandcamp.com/img/0.gif') + '" alt="" onerror="this.src=\\'https://bandcamp.com/img/0.gif\\'">',
        '  <div class="cb-wrap">',
        '    <input type="checkbox" data-index="' + idx + '" ' + (rel.selected ? 'checked' : '') + '>',
        '  </div>',
        '  <span class="card-badge ' + badgeClass + '" id="badge-' + idx + '">' + (rel.stage !== 'pending' ? rel.stage : (rel.label || 'Checking')) + '</span>',
        '</div>',
        '<div class="card-body">',
        '  <div>',
        '    <div class="card-title" title="' + rel.title + '">' + rel.title + '</div>',
        '    <div class="card-meta">' + (rel.artist || currentHostname) + ' · ' + (rel.type ? rel.type.toUpperCase() : 'ALBUM') + '</div>',
        '  </div>',
        '  <div class="card-stage-info" id="stage-info-' + idx + '">',
        '    <span class="truncate">' + (rel.statusText || 'Pending') + '</span>',
        '    ' + (rel.stage === 'failed' ? '<button class="btn-retry-card" data-idx="' + idx + '">Retry</button>' : ''),
        '  </div>',
        '</div>'
      ].join('');

      const cb = card.querySelector('input');
      cb.addEventListener('change', (e) => {
        dashReleases[idx].selected = e.target.checked;
        card.className = 'card' + (e.target.checked ? ' selected' : '');
        updateCount();
      });

      const btnRetry = card.querySelector('.btn-retry-card');
      if (btnRetry) {
        btnRetry.addEventListener('click', () => {
          dashReleases[idx].stage = 'pending';
          dashReleases[idx].statusText = 'Ready for retry';
          updateCard(idx);
          saveSession();
        });
      }

      grid.appendChild(card);
    });
    updateCount();
  }

  function updateCard(idx) {
    const rel = dashReleases[idx];
    const badge = document.getElementById('badge-' + idx);
    const cb = document.querySelector('input[data-index="' + idx + '"]');
    const stageInfo = document.getElementById('stage-info-' + idx);

    if (badge) {
      let bClass = 'badge-paid';
      if (rel.stage === 'completed') bClass = 'badge-completed';
      else if (rel.stage === 'failed') bClass = 'badge-failed';
      else if (rel.stage && rel.stage !== 'pending') bClass = 'badge-progress';
      else if (rel.isFree) bClass = 'badge-free';
      else if (rel.isNyp) bClass = 'badge-nyp';

      badge.className = 'card-badge ' + bClass;
      badge.textContent = rel.stage !== 'pending' ? rel.stage : (rel.label || 'Checking');
    }

    if (stageInfo) {
      stageInfo.innerHTML = '<span class="truncate">' + (rel.statusText || 'Pending') + '</span>' +
        (rel.stage === 'failed' ? '<button class="btn-retry-card" data-idx="' + idx + '">Retry</button>' : '');
      const rBtn = stageInfo.querySelector('.btn-retry-card');
      if (rBtn) {
        rBtn.addEventListener('click', () => {
          dashReleases[idx].stage = 'pending';
          dashReleases[idx].statusText = 'Ready for retry';
          updateCard(idx);
          saveSession();
        });
      }
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
    const completed = sel.filter(r => r.stage === 'completed').length;
    const remaining = sel.filter(r => r.stage !== 'completed').length;

    btnBulkDownload.textContent = 'Start Download (' + sel.length + ')';
    btnBulkDownload.disabled = sel.length === 0 || isRunningQueue;

    if (completed > 0 && remaining > 0) {
      btnResumeDownload.style.display = 'inline-block';
      btnResumeDownload.textContent = '▶ Resume Download (' + remaining + ' remaining)';
      btnResumeDownload.disabled = isRunningQueue;
    } else {
      btnResumeDownload.style.display = 'none';
    }
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

  // Download Pipeline
  btnBulkDownload.addEventListener('click', () => executeQueue(false));
  btnResumeDownload.addEventListener('click', () => executeQueue(true));

  async function executeQueue(resumeOnly) {
    isRunningQueue = true;
    isCancelled = false;
    updateCount();

    const prefs = await new Promise(res => {
      chrome.storage.sync.get([
        'defaultFormat',
        'createCompanionInfoZip',
        'namingSchema',
        'gasWebhookUrl',
        'gasSecret',
        'gasSearchFilterType',
        'gasSearchOffsetHours',
        'gasSearchStartDate',
        'fallbackEmail',
        'pacingBaseDelay',
        'pacingJitter',
        'cooldownBatch',
        'cooldownDuration'
      ], res);
    });

    const chosenFormat = formatSelect.value || prefs.defaultFormat || 'flac';
    const schema = schemaInput.value || prefs.namingSchema || '%artist% - %date% - %album%[%title%.%format%]';
    const doCompanion = cbCompanionZip.checked;
    const gasUrl = prefs.gasWebhookUrl || '';
    const gasSecret = prefs.gasSecret || '';
    const email = prefs.fallbackEmail || 'listener@example.com';
    const baseDelay = prefs.pacingBaseDelay || 2.5;
    const jitter = prefs.pacingJitter || 40;
    const cooldownBatch = prefs.cooldownBatch || 5;
    const cooldownDuration = prefs.cooldownDuration || 12;

    let targetItems = dashReleases.filter(r => r.selected);
    if (resumeOnly) {
      targetItems = targetItems.filter(r => r.stage !== 'completed');
      targetItems.forEach(r => {
        if (r.stage === 'failed') r.stage = 'pending';
      });
    }

    let batchCount = 0;

    for (let i = 0; i < targetItems.length; i++) {
      if (isCancelled) break;

      const r = targetItems[i];
      const rIdx = dashReleases.indexOf(r);

      const updateStage = (stage, text) => {
        r.stage = stage;
        r.statusText = text;
        updateCard(rIdx);
        saveSession();
      };

      try {
        let downloadPageUrl = r.freeDownloadPage;

        // Stage 1: Check GAS Webhook if configured using user-specified timeframe
        if (!downloadPageUrl && gasUrl) {
          updateStage('checking_mail', 'Searching Gmail via GAS watchdog...');

          let searchSince = 0;
          if (prefs.gasSearchFilterType === 'start_date' && prefs.gasSearchStartDate) {
            const d = new Date(prefs.gasSearchStartDate);
            if (!isNaN(d.getTime())) searchSince = Math.floor(d.getTime() / 1000);
          }
          if (!searchSince) {
            const offsetHours = prefs.gasSearchOffsetHours || 72;
            searchSince = Math.floor(Date.now() / 1000) - (offsetHours * 3600);
          }

          const searchRes = await new Promise(resolve => {
            chrome.runtime.sendMessage({
              action: 'QUERY_GAS_WEBHOOK',
              gasUrl,
              secret: gasSecret,
              releaseId: r.itemId,
              title: r.title,
              since: searchSince
            }, resolve);
          });

          if (searchRes?.success && searchRes.data?.found && searchRes.data?.downloadPageUrl) {
            downloadPageUrl = searchRes.data.downloadPageUrl;
            updateStage('checking_mail', 'Found signed download link in Gmail! Skipping email dispatch.');
          }
        }

        // Stage 2: Trigger Bandcamp email dispatch ONLY if not already found in mail
        const isEmailWalled = r.requiresEmail || r.isNyp;
        if (!downloadPageUrl && isEmailWalled) {
          updateStage('triggering_email', 'Triggering email dispatch to ' + email + '...');
          const triggerTime = Math.floor(Date.now() / 1000);

          await new Promise(resolve => {
            chrome.runtime.sendMessage({
              action: 'SUBMIT_EMAIL_DOWNLOAD',
              artistUrl: new URL(r.href).origin,
              itemId: r.itemId,
              itemType: r.type,
              email: email,
              format: chosenFormat
            }, resolve);
          });

          // Stage 3: Poll GAS watchdog
          if (gasUrl) {
            updateStage('polling_gas', 'Polling Gmail watchdog every 5s...');
            let pollSuccess = false;
            for (let attempt = 0; attempt < 36; attempt++) {
              if (isCancelled) break;
              await sleep(5000);
              updateStage('polling_gas', 'Polling Gmail watchdog (attempt ' + (attempt + 1) + '/36)...');

              const pollRes = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                  action: 'QUERY_GAS_WEBHOOK',
                  gasUrl,
                  secret: gasSecret,
                  releaseId: r.itemId,
                  title: r.title,
                  since: triggerTime - 15
                }, resolve);
              });

              if (pollRes?.success && pollRes.data?.found && pollRes.data?.downloadPageUrl) {
                downloadPageUrl = pollRes.data.downloadPageUrl;
                pollSuccess = true;
                updateStage('polling_gas', 'Received signed link from Bandcamp email!');
                break;
              }
            }

            if (!pollSuccess && !downloadPageUrl) {
              throw new Error('Watchdog timeout: email not detected within 3 minutes.');
            }
          }
        }

        // Stage 4: Resolving studio download link via statdownload
        updateStage('resolving_stat', 'Resolving studio master (' + chosenFormat.toUpperCase() + ')...');

        let audioDownloadUrl = null;
        let isArchive = r.type === 'album';

        if (downloadPageUrl) {
          const dlRes = await new Promise(resolve => {
            chrome.runtime.sendMessage({
              action: 'RESOLVE_DOWNLOAD_PAGE',
              url: downloadPageUrl,
              format: chosenFormat
            }, resolve);
          });

          if (dlRes?.success && dlRes.downloadUrl) {
            audioDownloadUrl = dlRes.downloadUrl;
            isArchive = Boolean(dlRes.isArchive);
          }
        }

        // Stage 5: Downloading Audio File
        updateStage('downloading_audio', 'Downloading studio audio release...');

        const audioFilename = formatFilenameBySchema(schema, {
          artist: r.artist || 'Bandcamp',
          album: r.fromAlbumTitle || r.title,
          title: r.title,
          trackNum: 1,
          totalTracks: r.totalTracks || 1,
          date: r.releaseDate || '',
          format: chosenFormat,
          type: r.type,
          isArchive: isArchive
        }, { isArchive });

        if (r.isPaid && !audioDownloadUrl) {
          updateStage('downloading_audio', 'Paid release (' + (r.label || 'audio skipped per policy') + '). Packaging companion info zip...');
        } else if (audioDownloadUrl) {
          chrome.downloads.download({
            url: audioDownloadUrl,
            filename: 'Bandcamp/' + audioFilename,
            conflictAction: 'uniquify'
          });
          batchCount++;
        } else if (chosenFormat === 'mp3-128' && r.audioStreams && r.audioStreams.length > 0) {
          for (const s of r.audioStreams) {
            if (s.url) {
              const streamName = formatFilenameBySchema(schema, {
                artist: r.artist || 'Bandcamp',
                album: r.fromAlbumTitle || r.title,
                title: s.title,
                trackNum: s.trackNum,
                totalTracks: r.audioStreams.length,
                date: r.releaseDate || '',
                format: 'mp3',
                type: 'track'
              }, { isArchive: false });

              chrome.downloads.download({
                url: s.url,
                filename: 'Bandcamp/' + streamName,
                conflictAction: 'uniquify'
              });
              await sleep(500);
            }
          }
          batchCount++;
        } else {
          throw new Error('Studio master download URL could not be resolved for ' + chosenFormat.toUpperCase());
        }

        // Stage 6: Companion (info).zip
        if (doCompanion) {
          updateStage('packaging_info', 'Building companion (info).zip...');
          const zip = new JSZip();

          // 1. Untruncated info.txt
          const infoContent = r.infoText || ('Title: ' + r.title + String.fromCharCode(10) + 'Artist: ' + r.artist + String.fromCharCode(10) + 'URL: ' + r.href);
          zip.file('info.txt', infoContent);

          // 2. cover.jpg
          if (r.artUrl) {
            try {
              const artRes = await fetch(r.artUrl);
              if (artRes.ok) {
                const artBuf = await artRes.arrayBuffer();
                zip.file('cover.jpg', artBuf);
              }
            } catch(e) {}
          }

          // 3. artist.jpg (from bio_pic)
          if (r.artistBioPicUrl) {
            try {
              const bioRes = await fetch(r.artistBioPicUrl);
              if (bioRes.ok) {
                const bioBuf = await bioRes.arrayBuffer();
                zip.file('artist.jpg', bioBuf);
              }
            } catch(e) {}
          }

          // 4. photos/
          if (r.extraImages && r.extraImages.length > 0) {
            for (let pIdx = 0; pIdx < r.extraImages.length; pIdx++) {
              try {
                const pRes = await fetch(r.extraImages[pIdx]);
                if (pRes.ok) {
                  const pBuf = await pRes.arrayBuffer();
                  zip.file('photos/photo_' + (pIdx + 1) + '.jpg', pBuf);
                }
              } catch(e) {}
            }
          }

          // 5. *.lrc lyrics files
          if (r.audioStreams && r.audioStreams.length > 0) {
            for (const stream of r.audioStreams) {
              if (stream.lyrics && stream.lyrics.trim().length > 0) {
                const padLen = Math.max(2, String(r.audioStreams.length).length);
                const pfx = r.audioStreams.length > 1 ? (String(stream.trackNum || 1).padStart(padLen, '0') + '. ') : '';
                const lrcName = (pfx + sanitize(stream.title)) + '.lrc';
                const lrcContent = '[ti:' + stream.title + ']' + String.fromCharCode(10) +
                  '[ar:' + r.artist + ']' + String.fromCharCode(10) +
                  '[al:' + r.title + ']' + String.fromCharCode(10) + String.fromCharCode(10) +
                  stream.lyrics + String.fromCharCode(10);
                zip.file(lrcName, lrcContent);
              }
            }
          }

          const infoZipBlob = await zip.generateAsync({ type: 'blob' });
          const infoZipName = getCompanionInfoZipName(audioFilename);
          chrome.downloads.download({
            url: URL.createObjectURL(infoZipBlob),
            filename: 'Bandcamp/' + infoZipName,
            conflictAction: 'uniquify'
          });
        }

        // Stage 7: Anti-Captcha Pacing & Cool-Down
        if (i < targetItems.length - 1 && !isCancelled) {
          updateStage('pacing', 'Applying pacing pause...');
          if (cooldownBatch > 0 && batchCount % cooldownBatch === 0) {
            pacingNotice.style.display = 'block';
            pacingNotice.textContent = 'Batch threshold reached (' + batchCount + ' releases). Anti-captcha cooldown for ' + cooldownDuration + 's...';
            await sleep(cooldownDuration * 1000);
            pacingNotice.style.display = 'none';
          } else {
            const delay = calculateDelay(baseDelay, jitter);
            pacingNotice.style.display = 'block';
            pacingNotice.textContent = 'Pacing jitter pause (' + (delay / 1000).toFixed(1) + 's)...';
            await sleep(delay);
            pacingNotice.style.display = 'none';
          }
        }

        updateStage('completed', 'Download completed!');
      } catch(err) {
        updateStage('failed', 'Error: ' + err.message);
      }
    }

    isRunningQueue = false;
    updateCount();
  }
});
`
  },
  {
    name: 'options.html',
    path: 'options.html',
    language: 'html',
    description: 'Extension settings interface with GAS watchdog, companion info zip, and anti-captcha pacing.',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bandcamp Downloader Preferences</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #0b0f17;
      color: #f1f5f9;
      padding: 40px;
      max-width: 680px;
      margin: 0 auto;
    }
    h2 { color: #00b4d8; margin-bottom: 24px; font-size: 22px; display: flex; align-items: center; gap: 10px; }
    h3 { color: #fbbf24; margin: 24px 0 12px; font-size: 15px; border-top: 1px solid #1e293b; padding-top: 16px; }
    .form-group { margin-bottom: 18px; }
    label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 13px; color: #e2e8f0; }
    p.hint { font-size: 12px; color: #94a3b8; margin-top: 4px; line-height: 1.4; }
    input[type="text"], input[type="email"], input[type="url"], input[type="number"], select {
      width: 100%;
      padding: 9px 12px;
      background: #131c2e;
      border: 1px solid #334155;
      border-radius: 6px;
      color: #fff;
      box-sizing: border-box;
      font-size: 13px;
    }
    .grid-2 { display: grid; grid-cols: 1fr 1fr; gap: 12px; }
    .cb-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
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
    .btn.sec { background: #1e293b; color: #fbbf24; border: 1px solid #334155; margin-right: 10px; }
    .btn:hover { opacity: 0.9; }
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
    <label for="defaultFormat">Default Audio Format</label>
    <select id="defaultFormat">
      <option value="flac" selected>FLAC (Lossless Studio Master - Default)</option>
      <option value="mp3-320">MP3 320kbps (High Quality CBR)</option>
      <option value="mp3-v0">MP3 V0 (High Quality VBR)</option>
      <option value="wav">WAV 16-bit PCM</option>
      <option value="aac-hi">AAC (VBR)</option>
      <option value="alac">ALAC</option>
    </select>
  </div>

  <div class="form-group">
    <label class="cb-row">
      <input type="checkbox" id="createCompanionInfoZip" checked>
      <span>Generate Companion (info).zip Alongside Audio Release</span>
    </label>
    <p class="hint">Creates a paired zip with untruncated info.txt, cover.jpg, artist.jpg (bio_pic), photos/, and .lrc lyrics.</p>
  </div>

  <div class="form-group">
    <label for="namingSchema">File Naming Schema</label>
    <input type="text" id="namingSchema" value="%artist% - %date% - %album%[%title%.%format%]">
    <p class="hint">For whole-album archives, [%title%.%format%] is automatically omitted.</p>
  </div>

  <div class="form-group">
    <label for="fallbackEmail">Auto-fill Fallback Email</label>
    <input type="email" id="fallbackEmail" placeholder="listener@example.com">
    <p class="hint">Sent to Bandcamp when receiving free or NYP download tokens.</p>
  </div>

  <h3>Google Apps Script Email-Walled Watchdog</h3>
  <div class="form-group">
    <label for="gasWebhookUrl">GAS Web App URL</label>
    <input type="url" id="gasWebhookUrl" placeholder="https://script.google.com/macros/s/.../exec">
    <p class="hint">Deployed Web App URL for automatic Gmail search of incoming download links.</p>
  </div>

  <div class="form-group">
    <label for="gasSecret">Secret Password</label>
    <input type="text" id="gasSecret" placeholder="my_secret_key">
  </div>

  <div class="form-group">
    <label for="gasSearchOffsetHours">Mailbox Search Window (Time Offset)</label>
    <select id="gasSearchOffsetHours">
      <option value="1">Last 1 Hour</option>
      <option value="6">Last 6 Hours</option>
      <option value="24">Last 24 Hours (1 Day)</option>
      <option value="72" selected>Last 3 Days (Recommended)</option>
      <option value="168">Last 7 Days (1 Week)</option>
      <option value="720">Last 30 Days (1 Month)</option>
    </select>
    <p class="hint">Searching only recent emails drastically speeds up search and avoids reading unrelated emails.</p>
  </div>

  <h3>Anti-Captcha Pacing & Rate Limits</h3>
  <div style="display:flex; gap:12px;">
    <div class="form-group" style="flex:1;">
      <label for="pacingBaseDelay">Base Delay (seconds)</label>
      <input type="number" step="0.5" id="pacingBaseDelay" value="2.5">
    </div>
    <div class="form-group" style="flex:1;">
      <label for="pacingJitter">Jitter Variation (%)</label>
      <input type="number" id="pacingJitter" value="40">
    </div>
  </div>

  <div style="display:flex; gap:12px;">
    <div class="form-group" style="flex:1;">
      <label for="cooldownBatch">Cool-Down Frequency</label>
      <input type="number" id="cooldownBatch" value="5">
      <p class="hint">Pause every N downloads.</p>
    </div>
    <div class="form-group" style="flex:1;">
      <label for="cooldownDuration">Cool-Down Pause (seconds)</label>
      <input type="number" id="cooldownDuration" value="12">
    </div>
  </div>

  <div style="margin-top:24px;">
    <button id="copyScriptBtn" class="btn sec">Copy Code.gs Script</button>
    <button id="saveBtn" class="btn">Save Preferences</button>
  </div>
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
    description: 'Options page controller handling chrome.storage.sync persistence.',
    content: `// Bandcamp Bulk Downloader - Options Script
const GAS_CODE_GS = ${JSON.stringify(GAS_SCRIPT_TEMPLATE)};

document.addEventListener('DOMContentLoaded', () => {
  const defaultFormat = document.getElementById('defaultFormat');
  const createCompanionInfoZip = document.getElementById('createCompanionInfoZip');
  const namingSchema = document.getElementById('namingSchema');
  const fallbackEmail = document.getElementById('fallbackEmail');
  const gasWebhookUrl = document.getElementById('gasWebhookUrl');
  const gasSecret = document.getElementById('gasSecret');
  const gasSearchOffsetHours = document.getElementById('gasSearchOffsetHours');
  const pacingBaseDelay = document.getElementById('pacingBaseDelay');
  const pacingJitter = document.getElementById('pacingJitter');
  const cooldownBatch = document.getElementById('cooldownBatch');
  const cooldownDuration = document.getElementById('cooldownDuration');
  const copyScriptBtn = document.getElementById('copyScriptBtn');
  const saveBtn = document.getElementById('saveBtn');
  const toast = document.getElementById('toast');

  chrome.storage.sync.get([
    'defaultFormat',
    'createCompanionInfoZip',
    'namingSchema',
    'fallbackEmail',
    'gasWebhookUrl',
    'gasSecret',
    'gasSearchOffsetHours',
    'pacingBaseDelay',
    'pacingJitter',
    'cooldownBatch',
    'cooldownDuration'
  ], (data) => {
    if (data.defaultFormat) defaultFormat.value = data.defaultFormat;
    if (data.createCompanionInfoZip !== undefined) createCompanionInfoZip.checked = data.createCompanionInfoZip;
    if (data.namingSchema) namingSchema.value = data.namingSchema;
    if (data.fallbackEmail) fallbackEmail.value = data.fallbackEmail;
    if (data.gasWebhookUrl) gasWebhookUrl.value = data.gasWebhookUrl;
    if (data.gasSecret) gasSecret.value = data.gasSecret;
    if (data.gasSearchOffsetHours) gasSearchOffsetHours.value = String(data.gasSearchOffsetHours);
    if (data.pacingBaseDelay !== undefined) pacingBaseDelay.value = data.pacingBaseDelay;
    if (data.pacingJitter !== undefined) pacingJitter.value = data.pacingJitter;
    if (data.cooldownBatch !== undefined) cooldownBatch.value = data.cooldownBatch;
    if (data.cooldownDuration !== undefined) cooldownDuration.value = data.cooldownDuration;
  });

  copyScriptBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(GAS_CODE_GS);
    toast.textContent = '✓ Copied Code.gs template to clipboard!';
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
  });

  saveBtn.addEventListener('click', () => {
    chrome.storage.sync.set({
      defaultFormat: defaultFormat.value,
      createCompanionInfoZip: createCompanionInfoZip.checked,
      namingSchema: namingSchema.value,
      fallbackEmail: fallbackEmail.value,
      gasWebhookUrl: gasWebhookUrl.value.trim(),
      gasSecret: gasSecret.value.trim(),
      gasSearchOffsetHours: parseInt(gasSearchOffsetHours.value, 10) || 72,
      pacingBaseDelay: parseFloat(pacingBaseDelay.value) || 2.5,
      pacingJitter: parseInt(pacingJitter.value, 10) || 40,
      cooldownBatch: parseInt(cooldownBatch.value, 10) || 5,
      cooldownDuration: parseInt(cooldownDuration.value, 10) || 12
    }, () => {
      toast.textContent = '✓ Preferences saved successfully!';
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3000);
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

A Chrome-compatible browser extension designed to scan Bandcamp artist music catalogs, identify free and pay-what-you-want ($0.00) albums, and bulk download genuine audio paired with companion info archives.

## Key Features
- **Paired Studio Audio & Companion Info ZIP Architecture**:
  - Downloads the studio master audio file or archive (\`Artist - 2026.10.30 - Album.zip\` or \`Artist - 2026.10.30 - Track.flac\`).
  - Automatically pairs it with a companion \`(info).zip\` containing untruncated \`info.txt\` (with complete liner notes from raw \`tralbumData\`), hi-res \`cover.jpg\`, \`artist.jpg\` (from bio_pic), album artwork in \`photos/\`, and synchronized/plain \`*.lrc\` lyrics files.
  - The companion ZIP never includes audio tracks.
- **Idempotent Multi-Site Persistent Queue**:
  - Discography sessions are automatically tracked and namespaced by artist domain (\`bc_session_v2_<hostname>\`).
  - Seamless resume: if a session is interrupted, 1-click **Resume Download** picks up remaining items, auto-retries failed releases, and skips completed items.
- **Email-Walled Watchdog via Google Apps Script (GAS)**:
  - Automates retrieving unique payment/signature signed download links from Bandcamp emails.
  - Checks existing emails before triggering, polls deployed web app every 5s up to 3 minutes, and resolves final studio master downloads.
- **Anti-Captcha Pacing & Cool-Down**:
  - Randomized jitter delay (2.5s ± 1.0s) and configurable cool-down pauses prevent bot detection and 429 rate limits.
- **Dedicated Full Tab Workflow**:
  - Starts and resumes directly inside a dedicated tab (\`dashboard.html\`) to keep the service worker and download streams alive.

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
   - Click the extension icon to view cached items or open the full tab scanner!
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
