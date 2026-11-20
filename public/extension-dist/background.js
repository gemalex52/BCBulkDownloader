// Bandcamp Bulk Downloader - Unified Background Service Worker (Manifest V3)
importScripts('core.js');

// NOTE: Intentionally does NOT register chrome.downloads.onDeterminingFilename.
// Registering onDeterminingFilename in an MV3 Service Worker causes Chromium IPC races
// ("Download must be in progress" / "Invalid downloadId") and collides with 3P download managers (e.g. Chrono).
// Instead, we inject real HTTP Content-Disposition headers on both:
//   1. Bandcamp HTTP audio downloads via declarativeNetRequest session rules (SET_DNR_DOWNLOAD_FILENAME)
//   2. Client-generated Blobs (companion info.zip) via Service Worker /__bc_dl__/ virtual HTTP responses
// so Chrome's default Download Manager and third-party managers receive the exact filename natively.

const DNR_DOWNLOAD_RULE_ID = 94001;
const VIRTUAL_DL_DB_NAME = 'bc-virtual-dl-db';
const VIRTUAL_DL_STORE_NAME = 'entries';

function buildContentDispositionHeader(filename) {
  const safeName = String(filename || 'download.zip').replace(/[\r\n]+/g, ' ').trim() || 'download.zip';
  const asciiFallback = safeName
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\;]/g, '_')
    .trim() || 'download.zip';
  const utf8Encoded = encodeURIComponent(safeName).replace(/['()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return 'attachment; filename="' + asciiFallback + '"; filename*=UTF-8\'\'' + utf8Encoded;
}

function readVirtualDownloadEntry(pathKey) {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(VIRTUAL_DL_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(VIRTUAL_DL_STORE_NAME)) {
          db.createObjectStore(VIRTUAL_DL_STORE_NAME, { keyPath: 'path' });
        }
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onsuccess = () => {
        const db = req.result;
        try {
          if (!db.objectStoreNames.contains(VIRTUAL_DL_STORE_NAME)) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction(VIRTUAL_DL_STORE_NAME, 'readonly');
          const store = tx.objectStore(VIRTUAL_DL_STORE_NAME);
          const getReq = store.get(pathKey);
          getReq.onerror = () => {
            try { db.close(); } catch (e) {}
            reject(getReq.error || new Error('IndexedDB get failed'));
          };
          getReq.onsuccess = () => {
            const val = getReq.result || null;
            try { db.close(); } catch (e) {}
            resolve(val);
          };
        } catch (err) {
          try { db.close(); } catch (e) {}
          reject(err);
        }
      };
    } catch (err) {
      reject(err);
    }
  });
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      await self.clients.claim();
    } catch (e) {}
    try {
      indexedDB.deleteDatabase(VIRTUAL_DL_DB_NAME);
    } catch (e) {}
  })());
});

// Serve client-generated Blobs (e.g. companion info.zip) from IndexedDB via genuine HTTP 200
// responses with Content-Disposition: attachment headers so Chrome's default Download Manager
// and third-party managers (e.g. Chrono) receive the exact suggested filename natively.
self.addEventListener('fetch', (event) => {
  try {
    const reqUrl = new URL(event.request.url);
    if (!reqUrl.pathname.startsWith('/__bc_dl__/')) return;

    event.respondWith((async () => {
      try {
        const entry = await readVirtualDownloadEntry(reqUrl.pathname);
        if (!entry || !entry.data) {
          return new Response('Virtual download entry expired or not found.', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
        const fallbackName = decodeURIComponent(reqUrl.pathname.split('/').pop() || 'download.zip');
        const headers = new Headers({
          'Content-Type': entry.contentType || 'application/zip',
          'Content-Disposition': entry.contentDisposition || buildContentDispositionHeader(fallbackName),
          'Content-Length': String(entry.size != null ? entry.size : entry.data.byteLength || 0),
          'Cache-Control': 'no-store',
        });
        if (event.request.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            statusText: 'OK',
            headers,
          });
        }
        return new Response(entry.data, {
          status: 200,
          statusText: 'OK',
          headers,
        });
      } catch (err) {
        return new Response('Virtual download error: ' + (err && err.message ? err.message : String(err)), {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })());
  } catch (e) {}
});


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
          credentials: 'include',
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

  async function fetchWithRetry(targetUrl, options, maxRetries = 3) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(targetUrl, options);
        if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
          const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
          const delayMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : (1500 * (attempt + 1));
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
      }
    }
    throw lastErr || new Error('Network request failed');
  }

  // 2. Inspect single release subpage (with automatic HTTP 429/5xx backoff retry)
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
        const res = await fetchWithRetry(item.url, {
          credentials: 'include',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*'
          }
        }, 3);
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
              isNoDigital: false,
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
            isNoDigital: parsed.isNoDigital,
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
            collectionUrl: parsed.collectionUrl || undefined,
            trackCount: parsed.trackListFormatted.length,
            trackList: parsed.trackListFormatted,
            audioStreams: parsed.audioStreams,
            aboutText: parsed.aboutText,
            creditsText: parsed.creditsText,
            infoText: parsed.infoText,
            tags: parsed.tagsMatches,
            audioQuality: parsed.audioQuality,
            isHiRes: parsed.isHiRes,
            selected: parsed.badgeType !== 'paid' && parsed.badgeType !== 'preorder' && parsed.badgeType !== 'no_digital',
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Collection lookup helper & cache for "Own" (purchased) releases
  let cachedBandcampFan = { collectionUrl: '', fanId: 0 };

  async function resolveOwnedCollectionDownload(params) {
    const { albumUrl, itemId, title, artist, collectionUrl } = params || {};
    let effectiveCollectionUrl = collectionUrl || cachedBandcampFan.collectionUrl || '';
    let resolvedItemId = itemId ? Number(itemId) : 0;
    let resolvedTitle = title || '';
    let resolvedArtist = artist || '';

    // 1. If we don't know the user's collection URL (bandcamp.com/<user_id>), extract it from albumUrl ("you-own-this-link") or bandcamp.com
    if (!effectiveCollectionUrl && albumUrl) {
      try {
        const albumRes = await fetch(albumUrl, {
          credentials: 'include',
          headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*' }
        });
        if (albumRes.ok) {
          const albumHtml = await albumRes.text();
          if (typeof extractCollectionUrlFromHtml === 'function') {
            effectiveCollectionUrl = extractCollectionUrlFromHtml(albumHtml) || '';
          }
          if (!resolvedItemId && typeof extractBandcampTralbum === 'function') {
            const tr = extractBandcampTralbum(albumHtml);
            if (tr?.current?.id) resolvedItemId = Number(tr.current.id);
            if (!resolvedTitle && tr?.current?.title) resolvedTitle = String(tr.current.title);
            if (!resolvedArtist && tr?.artist) resolvedArtist = String(tr.artist);
          }
        }
      } catch (e) {}
    }

    if (!effectiveCollectionUrl) {
      try {
        const homeRes = await fetch('https://bandcamp.com', {
          credentials: 'include',
          headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*' }
        });
        if (homeRes.ok) {
          const homeHtml = await homeRes.text();
          if (typeof extractCollectionUrlFromHtml === 'function') {
            effectiveCollectionUrl = extractCollectionUrlFromHtml(homeHtml) || '';
          }
        }
      } catch (e) {}
    }

    if (!effectiveCollectionUrl) {
      return {
        found: false,
        error: 'Could not determine logged-in Bandcamp user collection URL. Make sure you are signed in on bandcamp.com.'
      };
    }

    cachedBandcampFan.collectionUrl = effectiveCollectionUrl;
    const target = { itemId: resolvedItemId, title: resolvedTitle, url: albumUrl, artist: resolvedArtist };

    // 2. Fetch collection page to obtain fan_id and check initial cached items / DOM redownload links
    let fanId = cachedBandcampFan.collectionUrl === effectiveCollectionUrl ? cachedBandcampFan.fanId : 0;
    try {
      const colRes = await fetch(effectiveCollectionUrl, {
        credentials: 'include',
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*' }
      });
      if (colRes.ok) {
        const colHtml = await colRes.text();
        if (typeof extractPagedataBlob === 'function') {
          const blob = extractPagedataBlob(colHtml);
          if (blob) {
            const detectedFanId = Number(blob?.fan_data?.fan_id || blob?.current_fan?.fan_id || blob?.identities?.fan?.id || 0);
            if (detectedFanId) {
              fanId = detectedFanId;
              cachedBandcampFan.fanId = fanId;
            }
            const colItems = Object.values(blob?.item_cache?.collection || {});
            const hiddenItems = Object.values(blob?.item_cache?.hidden || {});
            if (typeof matchCollectionDownloadUrl === 'function') {
              const directHit =
                matchCollectionDownloadUrl(colItems, blob?.collection_data?.redownload_urls, target) ||
                matchCollectionDownloadUrl(hiddenItems, blob?.hidden_data?.redownload_urls || blob?.collection_data?.redownload_urls, target);
              if (directHit) {
                return { found: true, downloadPageUrl: directHit, source: 'collection_cache', collectionUrl: effectiveCollectionUrl };
              }
            }
          }
        }
        if (typeof matchCollectionDownloadUrlFromHtml === 'function') {
          const htmlHit = matchCollectionDownloadUrlFromHtml(colHtml, target);
          if (htmlHit) {
            return { found: true, downloadPageUrl: htmlHit, source: 'collection_html', collectionUrl: effectiveCollectionUrl };
          }
        }
      }
    } catch (e) {}

    if (!fanId) {
      return {
        found: false,
        collectionUrl: effectiveCollectionUrl,
        error: 'Could not read fan_id from collection page. Ensure you are logged into bandcamp.com in this browser.'
      };
    }

    // 3. Query Bandcamp collection search API (same endpoint behind <input class="search-box" placeholder="search your collection...">)
    const searchCandidates = [];
    if (resolvedTitle) {
      const trimmed = resolvedTitle.trim();
      if (trimmed) searchCandidates.push(trimmed);
      const noParens = trimmed.replace(/s*[([][^)]]*[)]]s*/g, ' ').replace(/s+/g, ' ').trim();
      if (noParens && noParens !== trimmed) searchCandidates.push(noParens);
    }
    if (resolvedArtist && resolvedArtist.trim() && !searchCandidates.includes(resolvedArtist.trim())) {
      searchCandidates.push(resolvedArtist.trim());
    }

    for (const searchKey of searchCandidates) {
      try {
        const searchRes = await fetch('https://bandcamp.com/api/fancollection/1/search_items', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({
            fan_id: fanId,
            search_key: searchKey,
            search_type: 'collection'
          })
        });
        if (!searchRes.ok) continue;
        const searchJson = await searchRes.json();
        const items = Array.isArray(searchJson?.tralbums) ? searchJson.tralbums : [];
        if (typeof matchCollectionDownloadUrl === 'function') {
          const hit = matchCollectionDownloadUrl(items, searchJson?.redownload_urls, target);
          if (hit) {
            return { found: true, downloadPageUrl: hit, source: 'collection_search', collectionUrl: effectiveCollectionUrl };
          }
        }
      } catch (e) {}
    }

    return {
      found: false,
      collectionUrl: effectiveCollectionUrl,
      error: 'Item not matched in collection redownload links.'
    };
  }

  // 3a. Search Bandcamp user collection for purchased "Own" release download link
  if (request.action === 'FIND_COLLECTION_DOWNLOAD') {
    (async () => {
      try {
        const result = await resolveOwnedCollectionDownload(request);
        sendResponse({ success: Boolean(result.found), ...result });
      } catch (err) {
        sendResponse({ success: false, found: false, error: err.message });
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
        const isOwned = Boolean(release?.isPurchased || release?.badgeType === 'own');
        const isEmailWalled = !isOwned && Boolean(
          release?.requiresEmail ||
          release?.badgeType === 'email' ||
          release?.isNameYourPrice
        );

        // Never use a raw fsig= temporary download page for email-walled releases (requires real email delivery)
        if (effectivePageUrl && isEmailWalled && !effectivePageUrl.includes('from=email') && !effectivePageUrl.includes('payment_id=')) {
          effectivePageUrl = undefined;
        }

        // If no downloadPageUrl and this is an Own (purchased) release, search user collection first
        if (!effectivePageUrl && isOwned) {
          try {
            const colResult = await resolveOwnedCollectionDownload({
              albumUrl: albumUrl || release?.url,
              itemId: request.itemId || release?.itemId,
              title: release?.title,
              artist: release?.artist,
              collectionUrl: release?.collectionUrl,
            });
            if (colResult?.found && colResult.downloadPageUrl) {
              effectivePageUrl = colResult.downloadPageUrl;
            }
          } catch (colErr) {}
        }

        // If no downloadPageUrl but albumUrl is present, fetch album page to see if freeDownloadPage is available (only for direct free releases)
        if (!effectivePageUrl && albumUrl && !isEmailWalled && !isOwned) {
          try {
            const pageRes = await fetch(albumUrl, {
              credentials: 'include',
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

        const expectedItemId = request.expectedItemId || request.itemId || release?.itemId || '';

        if (effectivePageUrl) {
          let resolved = await resolveBandcampDownload(effectivePageUrl, format || 'flac', expectedItemId);
          // If cached freeDownloadPageUrl failed/expired and this is a direct free release, re-fetch albumUrl for a fresh token
          if ((!resolved || !resolved.success) && !isEmailWalled && !isOwned && albumUrl) {
            try {
              const freshRes = await fetch(albumUrl, {
                credentials: 'include',
                headers: {
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*'
                }
              });
              if (freshRes.ok) {
                const freshHtml = await freshRes.text();
                const freshTralbum = typeof extractBandcampTralbum === 'function' ? extractBandcampTralbum(freshHtml) : null;
                if (freshTralbum && freshTralbum.freeDownloadPage && freshTralbum.freeDownloadPage !== effectivePageUrl) {
                  resolved = await resolveBandcampDownload(freshTralbum.freeDownloadPage, format || 'flac', expectedItemId);
                }
              }
            } catch (freshErr) {}
          }
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
          const isNoDigital = Boolean(release?.badgeType === 'no_digital' || release?.isNoDigital);
          const isPaid = !isOwned && (isPreorder || isNoDigital || Boolean(release?.badgeType === 'paid' || release?.isPaid));
          sendResponse({
            success: false,
            isPaid,
            isPreorder,
            isNoDigital,
            skipAudio: isPaid,
            message: isNoDigital
              ? 'No digital download available for this release. Packaging companion info ZIP.'
              : (isPreorder
                ? 'Pre-order release: audio master is not yet available prior to official release date. Packaging companion info ZIP.'
                : (isOwned
                  ? 'Owned release: download link not found in Gmail or your Bandcamp collection (verify you are signed in to bandcamp.com).'
                  : (isPaid ? 'Paid release: audio skipped per policy. Packaging companion info ZIP.' : 'Direct download link not yet resolved from mailbox.'))),
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

  // 5a. Batch Query Google Apps Script Webhook (POST { secret, since?, items } -> JSON array)
  if (request.action === 'CHECK_GAS_WEBHOOK_BATCH') {
    (async () => {
      try {
        const { webhookUrl, secret, since, items, timeoutSeconds, timeoutMs } = request;
        if (!webhookUrl || !secret) {
          sendResponse({ success: false, results: [], error: 'Missing webhookUrl or secret' });
          return;
        }
        const effectiveTimeoutMs = timeoutMs || ((timeoutSeconds || 90) * 1000);
        const url = new URL(webhookUrl);

        const cleanItems = Array.isArray(items) ? items.map((it) => {
          const obj = {
            title: it.title || '',
            id: it.id !== undefined ? it.id : ''
          };
          if (it.since !== undefined && it.since !== null && Number(it.since) > 0) {
            obj.since = Number(it.since);
          }
          return obj;
        }) : [];

        const payload = {
          secret: String(secret),
          items: cleanItems
        };
        if (since !== undefined && since !== null && Number(since) > 0) {
          payload.since = Number(since);
        }

        const res = await fetch(url.toString(), {
          method: 'POST',
          redirect: 'follow',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Accept': 'application/json, text/plain, */*'
          },
          body: JSON.stringify(payload),
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(effectiveTimeoutMs) : undefined
        });
        const text = await res.text();
        if (text.includes('accounts.google.com') || text.includes('ServiceLogin') || text.includes('Google Accounts')) {
          sendResponse({
            success: false,
            results: [],
            error: 'Google Login required: In Google Apps Script, click Deploy -> Manage deployments -> Edit (pencil icon), and set "Who has access" to "Anyone" (currently set to "Only myself").',
            raw: text.slice(0, 300)
          });
          return;
        }
        if (text.includes('Script function not found: doPost')) {
          sendResponse({
            success: false,
            results: [],
            error: 'Google Apps Script deployment is missing doPost(). Please copy the updated Code.gs from Settings and deploy a New version.'
          });
          return;
        }
        try {
          const parsed = JSON.parse(text);
          const rawResults = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.results) ? parsed.results : [parsed]);
          const firstError = rawResults.find((e) => e && e.error)?.error;
          const normalized = rawResults.map((entry) => {
            if (entry && entry.downloadPageUrl) {
              return { ...entry, downloadPageUrl: String(entry.downloadPageUrl).replace(/&amp;/g, '&').trim() };
            }
            return entry;
          });
          sendResponse({
            success: !firstError || normalized.some((e) => e && e.found),
            results: normalized,
            ...(firstError ? { error: firstError } : {})
          });
        } catch (e) {
          sendResponse({ success: false, results: [], error: 'Non-JSON response from GAS batch webhook', raw: text.slice(0, 300) });
        }
      } catch (err) {
        sendResponse({ success: false, results: [], error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  // 5b. Test Google Apps Script Webhook connection (POST { secret, test: 'true' })
  if (request.action === 'TEST_GAS_WEBHOOK') {
    (async () => {
      try {
        const { webhookUrl, secret } = request;
        if (!webhookUrl || !secret) {
          sendResponse({ success: false, ok: false, error: 'Missing webhookUrl or secret' });
          return;
        }
        const url = new URL(webhookUrl);

        const res = await fetch(url.toString(), {
          method: 'POST',
          redirect: 'follow',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Accept': 'application/json, text/plain, */*'
          },
          body: JSON.stringify({ secret: String(secret), test: 'true' }),
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
          const parsed = JSON.parse(text);
          const data = Array.isArray(parsed) ? (parsed[0] || {}) : parsed;
          if (data.test || data.ok || data.success) {
            sendResponse({
              success: true,
              ok: true,
              serverTime: typeof data.serverTime === 'number' ? data.serverTime : undefined,
              message: data.message || 'Connected successfully! Webhook verified.'
            });
          } else if (data.error) {
            sendResponse({ success: false, ok: false, error: data.error });
          } else {
            sendResponse({
              success: true,
              ok: true,
              serverTime: typeof data.serverTime === 'number' ? data.serverTime : undefined,
              message: 'Connected to Webhook!'
            });
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

  // 6. Optional declarativeNetRequest Content-Disposition rewrite for giant (>1.4GB) or unfetchable fallback downloads
  if (request.action === 'SET_DNR_DOWNLOAD_FILENAME') {
    (async () => {
      try {
        if (!chrome.declarativeNetRequest || typeof chrome.declarativeNetRequest.updateSessionRules !== 'function') {
          sendResponse({ success: false, error: 'declarativeNetRequest API unavailable' });
          return;
        }
        const rawUrl = String(request.url || '');
        const cleanFilename = String(request.filename || 'download.zip');
        let urlFilter = '*://*.bcbits.com/*';
        try {
          const parsed = new URL(rawUrl);
          urlFilter = '|' + parsed.origin + parsed.pathname;
        } catch (e) {}

        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [DNR_DOWNLOAD_RULE_ID],
          addRules: [
            {
              id: DNR_DOWNLOAD_RULE_ID,
              priority: 10,
              action: {
                type: 'modifyHeaders',
                responseHeaders: [
                  {
                    header: 'content-disposition',
                    operation: 'set',
                    value: buildContentDispositionHeader(cleanFilename),
                  },
                ],
              },
              condition: {
                urlFilter,
                resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'other'],
              },
            },
          ],
        });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (request.action === 'CLEAR_DNR_DOWNLOAD_FILENAME') {
    (async () => {
      try {
        if (chrome.declarativeNetRequest && typeof chrome.declarativeNetRequest.updateSessionRules === 'function') {
          await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [DNR_DOWNLOAD_RULE_ID],
          });
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
      }
    })();
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
