import JSZip from 'jszip';
import jszipMinSource from 'jszip/dist/jszip.min.js?raw';
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
    content: '// Compiled from src/services/bandcampCore.ts',
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
    "*://*.bandcamp.com/*",
    "*://*.bcbits.com/*",
    "*://script.google.com/*",
    "*://script.googleusercontent.com/*"
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
    description: 'Background Service Worker handling CORS-free fetching, token dispatch, statdownload resolution, GAS watchdog queries, and Chrome downloads.',
    content: `// Bandcamp Bulk Downloader - Unified Background Service Worker (Manifest V3)
importScripts('core.js');

// Map of URLs and download IDs to custom sanitized filenames for chrome.downloads.onDeterminingFilename
const pendingUrlFilenameMap = new Map();
const downloadFilenameMap = new Map();
const pendingDownloadsQueue = [];

function sanitizeChromeDownloadFilename(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return 'download.zip';
  const normalized = pathStr.split('\\\\').join('/');
  const segments = normalized.split('/').filter(Boolean);
  const cleanSegments = segments.map((seg) => {
    let clean = seg.replace(/[:*?"<>|]/g, '_').trim();
    while (clean.startsWith('.')) clean = clean.slice(1).trim();
    return clean || 'download';
  });
  return cleanSegments.length > 0 ? cleanSegments.join('/') : 'download.zip';
}

function resolvePendingFilename(item) {
  if (item && downloadFilenameMap.has(item.id)) {
    return downloadFilenameMap.get(item.id);
  }
  if (item && item.url && pendingUrlFilenameMap.has(item.url)) {
    return pendingUrlFilenameMap.get(item.url);
  }
  if (item && item.finalUrl && pendingUrlFilenameMap.has(item.finalUrl)) {
    return pendingUrlFilenameMap.get(item.finalUrl);
  }

  // Handle Bandcamp CDN 302 redirects (e.g. popplers -> p4.bcbits) by matching payment_id or album ID
  if (item && (item.url || item.finalUrl)) {
    const fullUrl = (item.url || '') + ' ' + (item.finalUrl || '');
    for (const [pUrl, fname] of pendingUrlFilenameMap.entries()) {
      const idMatch = pUrl.match(/[?&]id=(\d+)/);
      const payMatch = pUrl.match(/[?&]payment_id=(\d+)/);
      if (idMatch && (fullUrl.includes('id=' + idMatch[1]) || fullUrl.includes('/' + idMatch[1]))) {
        return fname;
      }
      if (payMatch && fullUrl.includes('payment_id=' + payMatch[1])) {
        return fname;
      }
    }
  }

  // Fallback: match most recent download initiated within the last 60 seconds
  const now = Date.now();
  for (let i = pendingDownloadsQueue.length - 1; i >= 0; i--) {
    const p = pendingDownloadsQueue[i];
    if (!p.used && (now - p.time < 60000)) {
      p.used = true;
      return p.filename;
    }
  }

  return null;
}

if (chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    try {
      const customName = resolvePendingFilename(item);
      if (customName) {
        const sanitized = sanitizeChromeDownloadFilename(customName);
        suggest({ filename: sanitized, conflictAction: 'uniquify' });
        if (item && item.id) downloadFilenameMap.delete(item.id);
        if (item && item.url) pendingUrlFilenameMap.delete(item.url);
      } else {
        suggest();
      }
    } catch (e) {
      // Gracefully ignore if download interrupted or completed rapidly
    }
    return false;
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([
    'defaultFormat',
    'createCompanionInfoZip',
    'fallbackEmail',
    'namingSchema',
    'gasWebhookUrl',
    'gasSecret',
    'pacingBaseDelaySeconds',
    'pacingJitterPercent',
    'cooldownBatchInterval',
    'cooldownDurationSeconds'
  ], (res) => {
    const updates = {};
    if (!res.defaultFormat) updates.defaultFormat = 'flac';
    if (res.createCompanionInfoZip === undefined) updates.createCompanionInfoZip = true;
    if (!res.namingSchema) updates.namingSchema = '%artist% - %date% - %album%[%title%.%format%]';
    if (res.pacingBaseDelaySeconds === undefined) updates.pacingBaseDelaySeconds = 2.5;
    if (res.pacingJitterPercent === undefined) updates.pacingJitterPercent = 40;
    if (res.cooldownBatchInterval === undefined) updates.cooldownBatchInterval = 5;
    if (res.cooldownDurationSeconds === undefined) updates.cooldownDurationSeconds = 12;

    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Discover full catalog (CORS-free in background worker)
  if (request.action === 'DISCOVER_CATALOG') {
    (async () => {
      try {
        const { url } = request;
        let targetUrl = typeof cleanBandcampUrl === 'function' ? cleanBandcampUrl(url) : url;
        const parsedUrl = new URL(targetUrl);
        const origin = parsedUrl.origin;
        const isTrackOrAlbumPage = parsedUrl.pathname.startsWith('/track/') || parsedUrl.pathname.startsWith('/album/');

        if (!isTrackOrAlbumPage && !targetUrl.includes('/music')) {
          while (targetUrl.endsWith('/')) targetUrl = targetUrl.slice(0, -1);
          targetUrl += '/music';
        }

        const res = await fetch(targetUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*'
          }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const html = await res.text();

        const artistMatch = html.match(/id="band-name-location"[^>]*>[\\s\\S]*?class="title"[^>]*>([^<]+)/i) ||
                            html.match(/property="og:site_name"[^>]*content="([^"]+)"/i) ||
                            html.match(/<title>([^-|]+)/i);
        const artistName = artistMatch ? cleanHtmlText(artistMatch[1]) : parsedUrl.hostname.split('.')[0];
        const artistBioPicUrl = extractArtistBioPicUrl(html);

        const itemsMap = new Map();

        // 1. Single release detection: check if current page is an album or track release
        const tralbum = typeof extractBandcampTralbum === 'function' ? extractBandcampTralbum(html) : null;
        if (tralbum && tralbum.current) {
          const isAlbum = tralbum.current.type === 'album' || parsedUrl.pathname.startsWith('/album/');
          const releaseTitle = cleanHtmlText(tralbum.current.title) || 'Release';
          const artUrl = tralbum.art_id ? ('https://f4.bcbits.com/img/a' + tralbum.art_id + '_10.jpg') : '';
          const rawId = (tralbum.current.type || (isAlbum ? 'album' : 'track')) + '-' + tralbum.current.id;
          itemsMap.set(parsedUrl.pathname || '/', {
            id: rawId,
            itemId: tralbum.current.id || 0,
            url: targetUrl,
            title: releaseTitle,
            artUrl,
            type: isAlbum ? 'album' : 'track'
          });
        }
        const liMatches = Array.from(html.matchAll(/<li[^>]*data-item-id="([^"]*)"[^>]*>([\\s\\S]*?)<\\/li>/gi));
        for (const m of liMatches) {
          const rawId = m[1];
          const content = m[2];
          const hrefMatch = content.match(/href="([^"]+)"/);
          if (!hrefMatch) continue;
          const href = hrefMatch[1];
          const isAlbum = href.startsWith('/album/');
          const isTrack = href.startsWith('/track/');
          if (!isAlbum && !isTrack) continue;
          const fullUrl = href.startsWith('http') ? href : (origin + href);
          const titleMatch = content.match(/<p class="title">\\s*([^<]+)/);
          const artMatch = content.match(/<img[^>]*src="([^"]+)"/);
          const artUrl = artMatch ? artMatch[1].replace(/_(\\d+)\\.jpg/, '_10.jpg') : '';
          const numId = parseInt(rawId.replace(/\\D/g, '') || '0', 10);
          itemsMap.set(href, {
            id: rawId,
            itemId: numId,
            url: fullUrl,
            title: titleMatch ? cleanHtmlText(titleMatch[1]) : 'Release',
            artUrl,
            type: isAlbum ? 'album' : 'track'
          });
        }

        const clientMatch = html.match(/data-client-items="([^"]+)"/i);
        if (clientMatch) {
          try {
            const raw = clientMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const clientItems = JSON.parse(raw);
            for (const item of clientItems) {
              if (!itemsMap.has(item.page_url)) {
                const isAlbum = item.type === 'album' || item.page_url.startsWith('/album/');
                const fullUrl = item.page_url.startsWith('http') ? item.page_url : (origin + item.page_url);
                const artUrl = item.art_id ? ('https://f4.bcbits.com/img/a' + item.art_id + '_10.jpg') : '';
                itemsMap.set(item.page_url, {
                  id: (item.type || 'item') + '-' + item.id,
                  itemId: item.id || 0,
                  url: fullUrl,
                  title: cleanHtmlText(item.title) || 'Release',
                  artUrl,
                  type: isAlbum ? 'album' : 'track'
                });
              }
            }
          } catch(e) {}
        }

        sendResponse({
          success: true,
          artistName,
          origin,
          artistBioPicUrl,
          items: Array.from(itemsMap.values())
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 2. Inspect single release subpage
  if (request.action === 'INSPECT_RELEASE') {
    (async () => {
      try {
        const origin = request.origin || '';
        const artistName = request.artistName || '';
        const item = request.item || {};
        const globalBioUrl = request.globalBioUrl || '';
        if (!item.url) {
          throw new Error('Missing release URL in item');
        }
        const res = await fetch(item.url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
          }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const subHtml = await res.text();
        const tralbum = typeof extractBandcampTralbum === 'function' ? extractBandcampTralbum(subHtml) : null;
        const parsed = typeof parseReleasePageData === 'function'
          ? parseReleasePageData(subHtml, tralbum, item, origin, artistName, globalBioUrl)
          : {
              releaseTitle: item.title || 'Release',
              artist: artistName,
              artUrl: item.artUrl || '',
              artistBioPicUrl: globalBioUrl,
              allImages: [],
              isFree: true,
              isNyp: false,
              isPurchased: false,
              isPaid: false,
              badgeType: 'free',
              minPrice: 0,
              priceFormatted: 'Free',
              requireEmail: false,
              freeDlPage: null,
              trackListFormatted: [item.title || 'Track 1'],
              audioStreams: [],
              aboutText: '',
              creditsText: '',
              infoText: '',
              tagsMatches: []
            };

        sendResponse({
          success: true,
          release: {
            id: item.id,
            itemId: tralbum?.current?.id || item.itemId || 0,
            itemType: item.type || 'album',
            title: parsed.releaseTitle,
            artist: parsed.artist,
            artistUrl: origin,
            url: item.url,
            artUrl: parsed.artUrl,
            artistBioPicUrl: parsed.artistBioPicUrl,
            extraImages: parsed.allImages,
            releaseDate: parsed.humanDate,
            isoDate: parsed.dotDate,
            isFree: parsed.isFree,
            isNameYourPrice: parsed.isNyp,
            isPurchased: parsed.isPurchased,
            isPaid: parsed.isPaid,
            badgeType: parsed.badgeType,
            minPrice: parsed.minPrice,
            currency: tralbum?.current?.currency || 'EUR',
            priceFormatted: parsed.priceFormatted,
            requiresEmail: parsed.requireEmail,
            freeDownloadPageUrl: parsed.freeDlPage || undefined,
            trackCount: parsed.trackListFormatted.length,
            trackList: parsed.trackListFormatted,
            audioStreams: parsed.audioStreams,
            aboutText: parsed.aboutText,
            creditsText: parsed.creditsText,
            infoText: parsed.infoText,
            tags: parsed.tagsMatches,
            selected: parsed.badgeType !== 'paid',
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 3. Resolve download link via statdownload / popplers CDN
  if (request.action === 'RESOLVE_DOWNLOAD') {
    (async () => {
      try {
        const { downloadPageUrl, format, albumUrl, release } = request;
        let effectivePageUrl = downloadPageUrl || release?.freeDownloadPageUrl;
        const isEmailWalled = Boolean(
          release?.requiresEmail ||
          release?.badgeType === 'email' ||
          release?.isNameYourPrice
        );

        // Never use a raw fsig= temporary download page for email-walled releases (requires real email delivery)
        if (effectivePageUrl && isEmailWalled && !effectivePageUrl.includes('from=email') && !effectivePageUrl.includes('payment_id=')) {
          effectivePageUrl = undefined;
        }

        // If no downloadPageUrl but albumUrl is present, fetch album page to see if freeDownloadPage is available (only for direct free releases)
        if (!effectivePageUrl && albumUrl && !isEmailWalled) {
          try {
            const pageRes = await fetch(albumUrl, {
              headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*'
              }
            });
            if (pageRes.ok) {
              const pageHtml = await pageRes.text();
              const tralbum = typeof extractBandcampTralbum === 'function' ? extractBandcampTralbum(pageHtml) : null;
              if (tralbum && tralbum.freeDownloadPage) {
                effectivePageUrl = tralbum.freeDownloadPage;
              }
            }
          } catch (pageErr) {}
        }

        if (effectivePageUrl) {
          const resolved = await resolveBandcampDownload(effectivePageUrl, format || 'flac');
          sendResponse({
            ...resolved,
            infoText: release?.infoText,
            artUrl: release?.artUrl,
            artistBioPicUrl: release?.artistBioPicUrl,
            extraImages: release?.extraImages,
            audioStreams: release?.audioStreams,
          });
        } else {
          const isPaid = Boolean(release?.badgeType === 'paid' || release?.isPaid);
          sendResponse({
            success: false,
            isPaid,
            skipAudio: isPaid,
            message: isPaid ? 'Paid release: audio skipped per policy. Packaging companion info ZIP.' : 'Direct download link not yet resolved from mailbox.',
            title: release?.title,
            artist: release?.artist,
            artUrl: release?.artUrl,
            artistBioPicUrl: release?.artistBioPicUrl,
            extraImages: release?.extraImages,
            infoText: release?.infoText,
            audioStreams: release?.audioStreams,
          });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 4. Trigger Bandcamp email dispatch
  if (request.action === 'TRIGGER_EMAIL') {
    (async () => {
      try {
        const { origin, formatId, itemId, itemType, email, itemUrl } = request;
        const targetOrigin = origin || (itemUrl ? new URL(itemUrl).origin : 'https://bandcamp.com');
        const body = new URLSearchParams({
          encoding_name: 'none',
          item_id: String(itemId),
          item_type: itemType || 'album',
          address: email || 'listener@example.com',
          country: 'US',
          postcode: '0'
        });
        const res = await fetch(targetOrigin + '/email_download', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': targetOrigin,
            'Referer': itemUrl || targetOrigin
          },
          body
        });
        const text = await res.text();
        let data = {};
        try { data = JSON.parse(text); } catch(e) {}
        if (text.includes('Client Challenge')) {
          sendResponse({ success: false, ok: false, error: 'Bandcamp bot challenge triggered on email request' });
          return;
        }
        if (data && data.ok === false) {
          sendResponse({ success: false, ok: false, error: data.error || data.error_message || 'Bandcamp rejected email dispatch', data });
          return;
        }
        sendResponse({ success: true, ok: true, data });
      } catch (err) {
        sendResponse({ success: false, ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 5. Query Google Apps Script Webhook
  if (request.action === 'CHECK_GAS_WEBHOOK') {
    (async () => {
      try {
        const { webhookUrl, secret, releaseId, title, since, hours, days, startDate, timeoutSeconds, timeoutMs } = request;
        const effectiveTimeoutMs = timeoutMs || ((timeoutSeconds || 90) * 1000);
        const url = new URL(webhookUrl);
        url.searchParams.set('secret', secret);
        if (releaseId) url.searchParams.set('id', String(releaseId));
        if (title) url.searchParams.set('title', title);
        if (since) url.searchParams.set('since', String(since));
        if (hours) url.searchParams.set('hours', String(hours));
        if (days) url.searchParams.set('days', String(days));
        if (startDate) url.searchParams.set('startDate', String(startDate));

        const res = await fetch(url.toString(), {
          redirect: 'follow',
          headers: { 'Accept': 'application/json, text/plain, */*' },
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(effectiveTimeoutMs) : undefined
        });
        const text = await res.text();
        if (text.includes('accounts.google.com') || text.includes('ServiceLogin') || text.includes('Google Accounts')) {
          sendResponse({
            found: false,
            error: 'Google Login required: In Google Apps Script, click Deploy -> Manage deployments -> Edit (pencil icon), and set "Who has access" to "Anyone" (currently set to "Only myself").',
            raw: text.slice(0, 300)
          });
          return;
        }
        try {
          const data = JSON.parse(text);
          if (data && data.downloadPageUrl) {
            data.downloadPageUrl = data.downloadPageUrl.replace(/&amp;/g, '&').trim();
          }
          sendResponse({ success: true, ...data });
        } catch(e) {
          sendResponse({ success: false, error: 'Non-JSON response from GAS webhook', raw: text.slice(0, 300) });
        }
      } catch (err) {
        sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  // 5b. Test Google Apps Script Webhook connection
  if (request.action === 'TEST_GAS_WEBHOOK') {
    (async () => {
      try {
        const { webhookUrl, secret } = request;
        if (!webhookUrl || !secret) {
          sendResponse({ success: false, ok: false, error: 'Missing webhookUrl or secret' });
          return;
        }
        const url = new URL(webhookUrl);
        url.searchParams.set('secret', secret);
        url.searchParams.set('test', 'true');

        const res = await fetch(url.toString(), {
          redirect: 'follow',
          headers: { 'Accept': 'application/json, text/plain, */*' },
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
        });
        const text = await res.text();
        if (text.includes('accounts.google.com') || text.includes('ServiceLogin') || text.includes('Google Accounts')) {
          sendResponse({
            success: false,
            ok: false,
            error: 'Google Login required: In Google Apps Script, click Deploy -> Manage deployments -> Edit (pencil icon), and set "Who has access" to "Anyone" (currently set to "Only myself").'
          });
          return;
        }
        try {
          const data = JSON.parse(text);
          if (data.test || data.ok || data.success) {
            sendResponse({ success: true, ok: true, message: data.message || 'Connected successfully! Webhook verified.' });
          } else if (data.error) {
            sendResponse({ success: false, ok: false, error: data.error });
          } else {
            sendResponse({ success: true, ok: true, message: 'Connected to Webhook!' });
          }
        } catch(e) {
          sendResponse({
            success: false,
            ok: false,
            error: 'Non-JSON response from Google Apps Script. Ensure "Who has access" is set to "Anyone" in Web App deployment settings.',
            raw: text.slice(0, 300)
          });
        }
      } catch (err) {
        sendResponse({ success: false, ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  // 5c. Register custom filename before download
  if (request.action === 'REGISTER_DOWNLOAD_FILENAME') {
    if (request.url && request.filename) {
      const clean = sanitizeChromeDownloadFilename(request.filename);
      pendingUrlFilenameMap.set(request.url, clean);
    }
    sendResponse({ success: true });
    return true;
  }

  // 6. Download file via Chrome Downloads API
  if (request.action === 'DOWNLOAD_FILE') {
    const rawFilename = request.filename || 'download.zip';
    const cleanFilename = sanitizeChromeDownloadFilename(rawFilename);
    pendingUrlFilenameMap.set(request.url, cleanFilename);
    pendingDownloadsQueue.push({ url: request.url, filename: cleanFilename, time: Date.now(), used: false });
    if (pendingDownloadsQueue.length > 25) pendingDownloadsQueue.shift();

    chrome.downloads.download({
      url: request.url,
      filename: cleanFilename,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err) {
        pendingUrlFilenameMap.delete(request.url);
        sendResponse({ success: false, error: err.message });
      } else {
        if (downloadId) {
          downloadFilenameMap.set(downloadId, cleanFilename);
        }
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }

  // 7. Fetch binary image as Data URL (for companion info zip packing without CORS)
  if (request.action === 'FETCH_BINARY_DATA_URL') {
    (async () => {
      try {
        const res = await fetch(request.url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ success: true, dataUrl: reader.result });
        };
        reader.onerror = () => {
          sendResponse({ success: false, error: 'FileReader error' });
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 8. Open dashboard tab
  if (request.action === 'OPEN_DASHBOARD_TAB') {
    let targetUrl = 'dashboard.html';
    const params = [];
    if (request.url) params.push('url=' + encodeURIComponent(request.url));
    if (request.autostart) params.push('autostart=1');
    if (params.length > 0) targetUrl += '?' + params.join('&');
    chrome.tabs.create({ url: chrome.runtime.getURL(targetUrl) }, (tab) => {
      sendResponse({ success: true, tabId: tab ? tab.id : null });
    });
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

  // Non-intrusive floating button on Bandcamp pages to open Dedicated Scanner Tab directly
  function injectPageButton() {
    if (document.getElementById('bc-bulk-open-tab-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'bc-bulk-open-tab-btn';
    btn.textContent = '⚡ Downloader';
    btn.title = 'Open Bandcamp Bulk Downloader Dashboard for this catalog';
    btn.style.cssText = 'position:fixed;bottom:22px;right:22px;z-index:999999;background:#00b4d8;color:#0b0f17;font-weight:700;font-size:12px;padding:7px 13px;border:none;border-radius:20px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.45);font-family:sans-serif;transition:transform 0.15s,bottom 0.2s,box-shadow 0.15s;';
    btn.onmouseenter = function() { btn.style.transform = 'scale(1.05)'; };
    btn.onmouseleave = function() { btn.style.transform = 'scale(1)'; };
    btn.onclick = function(e) {
      e.preventDefault();
      chrome.runtime.sendMessage({
        action: 'OPEN_DASHBOARD_TAB',
        url: window.location.href,
        autostart: false
      });
    };

    function updateButtonPosition() {
      let clearanceBottom = 22;
      const winW = window.innerWidth;
      const winH = window.innerHeight;

      // Check common cast or floating controls by selectors
      const candidateSelectors = [
        'cast-button',
        '.cast-button',
        '#cast-button',
        '.google-cast-launcher',
        '[is="google-cast-button"]',
        '.cast-icon',
        '.cast-banner',
        '.inline_player',
        '#inline_player',
        '.bandcamp-player',
        '.music-player-fixed',
        '#carousel-player',
        '.feedback-floater',
        '.back-to-top'
      ];

      for (const sel of candidateSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            if (el === btn) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.right > winW - 160 && rect.bottom > winH - 180) {
              const needed = (winH - rect.top) + 12;
              if (needed > clearanceBottom) clearanceBottom = needed;
            }
          }
        } catch (e) {}
      }

      // Also scan any fixed/sticky elements in the bottom-right corner
      try {
        const fixedElements = Array.from(document.querySelectorAll('body *')).filter(function(el) {
          if (el === btn || el.id === 'bc-bulk-open-tab-btn' || el.contains(btn)) return false;
          const s = window.getComputedStyle(el);
          return (s.position === 'fixed' || s.position === 'sticky') &&
                 s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
        });

        for (const el of fixedElements) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.right > winW - 140 && rect.bottom > winH - 140) {
            const needed = (winH - rect.top) + 12;
            if (needed > clearanceBottom && needed < winH * 0.75) {
              clearanceBottom = needed;
            }
          }
        }
      } catch (e) {}

      btn.style.bottom = Math.min(Math.max(22, Math.round(clearanceBottom)), 300) + 'px';
    }

    document.body.appendChild(btn);

    updateButtonPosition();
    setTimeout(updateButtonPosition, 600);
    setTimeout(updateButtonPosition, 2000);
    window.addEventListener('resize', updateButtonPosition);
    try {
      const observer = new MutationObserver(function() {
        updateButtonPosition();
      });
      observer.observe(document.body, { childList: true, subtree: false });
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPageButton);
  } else {
    injectPageButton();
  }
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
        ↗ Open Download Dashboard
      </button>
      <button id="btnQuickResume" class="btn resume" style="display:none;">
        ▶ Resume Download in Download Dashboard
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

  function normalizeUrl(raw) {
    if (!raw) return 'https://esoctrilihum.bandcamp.com/music';
    var c = raw.trim();
    if (c.indexOf('url=') !== -1) {
      var m = c.match(/url=([^&]+)/);
      if (m) {
        try { c = decodeURIComponent(m[1]); } catch(e) { c = m[1]; }
      }
    }
    try {
      if (c.indexOf('%3A') !== -1 || c.indexOf('%2F') !== -1) c = decodeURIComponent(c);
    } catch(e) {}
    c = c.replace(new RegExp('(/music)+$', 'i'), '/music');
    while (c.endsWith('/')) c = c.slice(0, -1);
    if (c.indexOf('http://') !== 0 && c.indexOf('https://') !== 0) c = 'https://' + c;
    try {
      var u = new URL(c);
      if (u.hostname.endsWith('.bandcamp.com') && (u.pathname === '' || u.pathname === '/')) {
        c = u.origin + '/music';
      }
    } catch(e) {}
    return c;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (
      tab &&
      tab.url &&
      !tab.url.startsWith('chrome-extension://') &&
      !tab.url.startsWith('moz-extension://') &&
      !tab.url.includes('dashboard.html') &&
      (tab.url.includes('.bandcamp.com') || tab.url.includes('bandcamp.com/'))
    ) {
      activeUrl = normalizeUrl(tab.url);
      try {
        activeHostname = new URL(activeUrl).hostname;
      } catch(e) {}
    }

    siteTitle.textContent = activeHostname;

    const sessionKey = 'bc_session_v2_' + activeHostname.toLowerCase();
    chrome.storage.local.get([sessionKey], (res) => {
      const sess = res && res[sessionKey];
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

  function openDedicatedTab(autostart) {
    let targetUrl = 'dashboard.html';
    const params = [];
    const clean = normalizeUrl(activeUrl);
    if (clean) params.push('url=' + encodeURIComponent(clean));
    if (autostart) params.push('autostart=1');
    if (params.length > 0) targetUrl += '?' + params.join('&');

    const fullUrl = chrome.runtime.getURL(targetUrl);
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: fullUrl }, () => {
        window.close();
      });
    } else {
      chrome.runtime.sendMessage({
        action: 'OPEN_DASHBOARD_TAB',
        url: activeUrl,
        autostart: Boolean(autostart)
      }, () => {
        window.close();
      });
    }
  }

  btnOpenDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    openDedicatedTab(false);
  });

  btnQuickResume.addEventListener('click', (e) => {
    e.preventDefault();
    openDedicatedTab(true);
  });
});
`
  },
  {
    name: 'dashboard.html',
    path: 'dashboard.html',
    language: 'html',
    description: 'Full-page Live Scanner React dashboard mounting the unified discography crawler, multi-site queue, GAS watchdog, and anti-captcha pacing.',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bandcamp Bulk Downloader - Download Dashboard</title>
  <link rel="stylesheet" href="dashboard.css">
</head>
<body class="bg-[#0b0f17] text-slate-100 min-h-screen">
  <div id="root"></div>
  <script src="dashboard.bundle.js"></script>
</body>
</html>`
  },
  {
    name: 'dashboard.css',
    path: 'dashboard.css',
    language: 'css',
    description: 'Tailwind CSS stylesheet for the Live Scanner React Dashboard.',
    content: `/* Bandcamp Bulk Downloader - Live Scanner Dashboard Stylesheet */
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; background-color: #0b0f17; color: #f1f5f9; min-height: 100vh; }
code, pre, .font-mono { font-family: 'JetBrains Mono', monospace; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #0b0f17; }
::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #334155; }`
  },
  {
    name: 'dashboard.bundle.js',
    path: 'dashboard.bundle.js',
    language: 'javascript',
    description: 'Compiled React 19 Live Scanner Dashboard bundle (built with esbuild and 100% Manifest V3 CSP compliance).',
    content: `// Bandcamp Bulk Downloader - Live Scanner React Dashboard Bundle
// Compiled with esbuild, React 19, Lucide Icons, and Full MV3 CSP Compliance
// (The full standalone production bundle is packaged into the downloaded extension zip)
console.log('Bandcamp Bulk Downloader: Live Scanner React Dashboard initialized.');`
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
    content: `(function() {
  'use strict';
  // Bandcamp Bulk Downloader - Options Script
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

  chrome.storage.local.get([
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
    chrome.storage.local.set({
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
})();
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
    if (file.path === 'core.js') {
      try {
        let res = await fetch('/extension-dist/core.js');
        if (!res.ok) {
          res = await fetch('/public/extension-dist/core.js');
        }
        if (res.ok) {
          const txt = await res.text();
          zip.file(file.path, txt);
          continue;
        }
      } catch (e) {}
    }
    if (file.path === 'dashboard.bundle.js') {
      try {
        let res = await fetch('/extension-dist/dashboard.bundle.js');
        if (!res.ok) {
          res = await fetch('/public/extension-dist/dashboard.bundle.js');
        }
        if (res.ok) {
          const txt = await res.text();
          zip.file(file.path, txt);
          continue;
        }
      } catch (e) {}
    }
    if (file.path === 'dashboard.css') {
      try {
        let res = await fetch('/extension-dist/dashboard.css');
        if (!res.ok) {
          res = await fetch('/public/extension-dist/dashboard.css');
        }
        if (res.ok) {
          const txt = await res.text();
          zip.file(file.path, txt);
          continue;
        }
      } catch (e) {}
    }
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

  // Load compiled dashboard bundle, core engine, and css if running on Node.js
  let bundleContent = '';
  let cssContent = '';
  let coreContent = '';
  try {
    const fs = await import('fs');
    const path = await import('path');
    const corePath = path.join(process.cwd(), 'public', 'extension-dist', 'core.js');
    const bundlePath = path.join(process.cwd(), 'public', 'extension-dist', 'dashboard.bundle.js');
    const cssPath = path.join(process.cwd(), 'public', 'extension-dist', 'dashboard.css');
    if (fs.existsSync(corePath)) {
      coreContent = fs.readFileSync(corePath, 'utf8');
    }
    if (fs.existsSync(bundlePath)) {
      bundleContent = fs.readFileSync(bundlePath, 'utf8');
    }
    if (fs.existsSync(cssPath)) {
      cssContent = fs.readFileSync(cssPath, 'utf8');
    }
  } catch (e) {}

  for (const file of EXTENSION_FILES) {
    if (file.path === 'core.js' && coreContent) {
      zip.file(file.path, coreContent);
      continue;
    }
    if (file.path === 'dashboard.bundle.js' && bundleContent) {
      zip.file(file.path, bundleContent);
      continue;
    }
    if (file.path === 'dashboard.css' && cssContent) {
      zip.file(file.path, cssContent);
      continue;
    }
    if (file.binaryBuffer) {
      zip.file(file.path, file.binaryBuffer);
    } else {
      zip.file(file.path, file.content);
    }
  }
  return await zip.generateAsync({ type: 'uint8array' });
}
