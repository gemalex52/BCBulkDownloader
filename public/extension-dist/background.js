// Bandcamp Bulk Downloader - Unified Background Service Worker (Manifest V3)
importScripts('core.js');

// Map of URLs and download IDs to custom sanitized filenames for chrome.downloads.onDeterminingFilename
const pendingUrlFilenameMap = new Map();
const downloadFilenameMap = new Map();
const pendingDownloadsQueue = [];

function sanitizeChromeDownloadFilename(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return 'download.zip';
  const normalized = pathStr.split('\\').join('/');
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
      const idMatch = pUrl.match(/[?&]id=(d+)/);
      const payMatch = pUrl.match(/[?&]payment_id=(d+)/);
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

        const catalog = typeof discoverCatalogItemsFromHtml === 'function'
          ? discoverCatalogItemsFromHtml(html, targetUrl)
          : { artistName: parsedUrl.hostname.split('.')[0], origin, items: [] };

        sendResponse({
          success: true,
          ...catalog
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
            extraPhotos: parsed.extraPhotos,
            isPreorder: parsed.isPreorder,
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
            selected: parsed.badgeType !== 'paid' && parsed.badgeType !== 'preorder',
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
            extraPhotos: release?.extraPhotos,
            audioStreams: release?.audioStreams,
          });
        } else {
          const isPreorder = Boolean(release?.badgeType === 'preorder' || release?.isPreorder);
          const isPaid = isPreorder || Boolean(release?.badgeType === 'paid' || release?.isPaid);
          sendResponse({
            success: false,
            isPaid,
            isPreorder,
            skipAudio: isPaid,
            message: isPreorder
              ? 'Pre-order release: audio master is not yet available prior to official release date. Packaging companion info ZIP.'
              : (isPaid ? 'Paid release: audio skipped per policy. Packaging companion info ZIP.' : 'Direct download link not yet resolved from mailbox.'),
            title: release?.title,
            artist: release?.artist,
            artUrl: release?.artUrl,
            artistBioPicUrl: release?.artistBioPicUrl,
            extraImages: release?.extraImages,
            extraPhotos: release?.extraPhotos,
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
