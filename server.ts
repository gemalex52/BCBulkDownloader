import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { exec, execSync } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);
import JSZip from 'jszip';
import NodeID3 from 'node-id3';
import { formatFilenameBySchema, formatDateToDotString, ScannedRelease } from './src/types/bandcamp';
import {
  BANDCAMP_FETCH_HEADERS,
  cleanHtmlText,
  extractBandcampTralbum,
  extractArtistBioPicUrl,
  parseReleasePageData,
  resolveBandcampDownload,
} from './src/services/bandcampCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-memory catalog cache keyed by normalized targetUrl
interface CachedCatalog {
  targetUrl: string;
  artist: string;
  scannedAt: string;
  releases: ScannedRelease[];
}
const serverCatalogCache = new Map<string, CachedCatalog>();

// Audio formats supported by Bandcamp
export const SUPPORTED_FORMATS = [
  { id: 'flac', name: 'FLAC (Lossless)', ext: 'flac', desc: 'Lossless audio compression, audiophile studio quality (Default)' },
  { id: 'mp3-320', name: 'MP3 320kbps', ext: 'mp3', desc: 'Highest MP3 quality (320kbps CBR)' },
  { id: 'mp3-v0', name: 'MP3 V0', ext: 'mp3', desc: 'Variable bitrate, great quality & small size' },
  { id: 'wav', name: 'WAV 16-bit', ext: 'wav', desc: 'Uncompressed CD quality PCM audio' },
  { id: 'aac-hi', name: 'AAC (VBR)', ext: 'm4a', desc: 'High-quality AAC, ideal for Apple devices' },
  { id: 'alac', name: 'ALAC', ext: 'm4a', desc: 'Apple Lossless Audio Codec' },
  { id: 'aiff-lossless', name: 'AIFF', ext: 'aiff', desc: 'Uncompressed lossless audio format' },
];

// Discover all releases on a Bandcamp catalog page (rendered <li> + data-client-items)
// Discover all releases on a Bandcamp catalog page (rendered <li> + data-client-items + single release fallback)
async function discoverAllCatalogItems(targetUrl: string): Promise<{
  artistName: string;
  origin: string;
  artistBioPicUrl?: string;
  items: {
    id: string;
    itemId: number;
    url: string;
    title: string;
    artUrl: string;
    type: 'album' | 'track';
  }[];
}> {
  const parsedUrl = new URL(targetUrl);
  const origin = parsedUrl.origin;

  let catalogRes = await fetch(targetUrl, {
    headers: BANDCAMP_FETCH_HEADERS,
  });

  // Fallback to origin root if /music returns 404 (e.g. single-release artists or custom layouts)
  if (!catalogRes.ok && targetUrl.endsWith('/music')) {
    try {
      const rootRes = await fetch(origin, { headers: BANDCAMP_FETCH_HEADERS });
      if (rootRes.ok) {
        catalogRes = rootRes;
      }
    } catch (e) {}
  }

  if (!catalogRes.ok) {
    throw new Error(`Failed to fetch catalog: HTTP ${catalogRes.status}`);
  }

  const html = await catalogRes.text();

  const artistName =
    cleanHtmlText(html.match(/#band-name-location[^>]*class="title"[^>]*>([^<]+)/i)?.[1]) ||
    cleanHtmlText(html.match(/<span[^>]*class="title"[^>]*>([^<]+)<\/span>/i)?.[1]) ||
    cleanHtmlText(html.match(/property="og:site_name"[^>]*content="([^"]+)"/i)?.[1]) ||
    cleanHtmlText(html.match(/<title>([^|<]+)/i)?.[1]) ||
    parsedUrl.hostname.split('.')[0];

  const itemsMap = new Map<string, {
    id: string;
    itemId: number;
    url: string;
    title: string;
    artUrl: string;
    type: 'album' | 'track';
  }>();

  // 1. Initial rendered <li> items
  const liMatches = Array.from(html.matchAll(/<li[^>]*data-item-id="([^"]*)"[^>]*>([\s\S]*?)<\/li>/gi));
  for (const m of liMatches) {
    const rawId = m[1];
    const content = m[2];
    const hrefMatch = content.match(/href="([^"]+)"/);
    if (!hrefMatch) continue;

    const href = hrefMatch[1];
    const isAlbum = href.startsWith('/album/');
    const isTrack = href.startsWith('/track/');
    if (!isAlbum && !isTrack) continue;

    const fullUrl = href.startsWith('http') ? href : `${origin}${href}`;
    const titleMatch = content.match(/<p class="title">\s*([^<]+)/);
    const artMatch = content.match(/<img[^>]*src="([^"]+)"/);

    const artUrl = artMatch ? artMatch[1].replace(/_(\d+)\.jpg/, '_10.jpg') : '';
    const numId = parseInt(rawId.replace(/\D/g, '') || '0', 10);

    itemsMap.set(href, {
      id: rawId,
      itemId: numId,
      url: fullUrl,
      title: titleMatch ? cleanHtmlText(titleMatch[1]) : 'Release',
      artUrl,
      type: isAlbum ? 'album' : 'track',
    });
  }

  // 2. Extract remaining items from data-client-items attribute on ol#music-grid
  const clientMatch = html.match(/data-client-items="([^"]+)"/i);
  if (clientMatch) {
    try {
      const raw = clientMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const clientItems: any[] = JSON.parse(raw);
      for (const item of clientItems) {
        if (!itemsMap.has(item.page_url)) {
          const isAlbum = item.type === 'album' || item.page_url.startsWith('/album/');
          const fullUrl = item.page_url.startsWith('http') ? item.page_url : `${origin}${item.page_url}`;
          const artUrl = item.art_id ? `https://f4.bcbits.com/img/a${item.art_id}_10.jpg` : '';
          const rawId = `${item.type || 'item'}-${item.id}`;

          itemsMap.set(item.page_url, {
            id: rawId,
            itemId: item.id || 0,
            url: fullUrl,
            title: cleanHtmlText(item.title) || 'Release',
            artUrl,
            type: isAlbum ? 'album' : 'track',
          });
        }
      }
    } catch (e) {
      console.warn('Failed parsing data-client-items:', e);
    }
  }

  // 3. Single-release detection: if requested page is a track or album, or if discography grid has no items
  const isTrackOrAlbumPage = parsedUrl.pathname.startsWith('/track/') || parsedUrl.pathname.startsWith('/album/');
  if (isTrackOrAlbumPage || itemsMap.size === 0) {
    const tralbum = extractBandcampTralbum(html);
    if (tralbum && tralbum.current) {
      const isAlbum = tralbum.current.type === 'album' || parsedUrl.pathname.startsWith('/album/');
      const releaseTitle = cleanHtmlText(tralbum.current.title) || 'Release';
      const artUrl = tralbum.art_id ? `https://f4.bcbits.com/img/a${tralbum.art_id}_10.jpg` : '';
      const rawId = `${tralbum.current.type || (isAlbum ? 'album' : 'track')}-${tralbum.current.id}`;
      itemsMap.set(parsedUrl.pathname || '/', {
        id: rawId,
        itemId: tralbum.current.id || 0,
        url: targetUrl,
        title: releaseTitle,
        artUrl,
        type: isAlbum ? 'album' : 'track',
      });
    }
  }

  const artistBioPicUrl = extractArtistBioPicUrl(html);

  return {
    artistName,
    origin,
    artistBioPicUrl,
    items: Array.from(itemsMap.values()),
  };
}

// Inspect a single release subpage using shared core parser for artwork, full metadata, info text, and pricing
async function inspectReleaseSubpage(
  origin: string,
  artistName: string,
  item: {
    id: string;
    itemId: number;
    url: string;
    title: string;
    artUrl: string;
    type: 'album' | 'track';
  },
  globalArtistBioPicUrl?: string
): Promise<ScannedRelease> {
  try {
    const subRes = await fetch(item.url, {
      headers: BANDCAMP_FETCH_HEADERS,
    });
    if (!subRes.ok) throw new Error(`HTTP ${subRes.status}`);

    const subHtml = await subRes.text();
    const tralbum = extractBandcampTralbum(subHtml);
    const parsed = parseReleasePageData(subHtml, tralbum, item, origin, artistName, globalArtistBioPicUrl);

    return {
      id: item.id,
      itemId: tralbum?.current?.id || item.itemId,
      itemType: item.type,
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
    };
  } catch (e: any) {
    console.warn(`Error inspecting subpage ${item.url}:`, e.message);
    return {
      id: item.id,
      itemId: item.itemId,
      itemType: item.type,
      title: item.title,
      artist: artistName,
      artistUrl: origin,
      url: item.url,
      artUrl: item.artUrl,
      artistBioPicUrl: globalArtistBioPicUrl,
      isFree: true,
      isNameYourPrice: false,
      isPurchased: false,
      minPrice: 0,
      currency: 'EUR',
      priceFormatted: 'Free Download',
      requiresEmail: false,
      trackCount: 1,
      trackList: ['1. ' + item.title],
      infoText: `Title: ${item.title}\nArtist: ${artistName}\nURL: ${item.url}\n`,
      selected: true,
    };
  }
}

// Catalog scan endpoint
app.get(['/api/bandcamp/scan', '/api/bandcamp/scan-batch'], async (req: Request, res: Response) => {
  const targetUrl = (req.query.url as string) || 'https://esoctrilihum.bandcamp.com/music';
  const forceRefresh = req.query.forceRefresh === 'true';

  if (!forceRefresh && serverCatalogCache.has(targetUrl)) {
    const cached = serverCatalogCache.get(targetUrl)!;
    return res.json({
      success: true,
      source: 'server_cache',
      targetUrl,
      artist: cached.artist,
      scannedAt: cached.scannedAt,
      totalCount: cached.releases.length,
      releases: cached.releases,
    });
  }

  try {
    const { artistName, origin, artistBioPicUrl, items } = await discoverAllCatalogItems(targetUrl);

    const releases: ScannedRelease[] = [];
    const batchSize = 6;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(item => inspectReleaseSubpage(origin, artistName, item, artistBioPicUrl))
      );
      releases.push(...batchResults);
    }

    const scannedAt = new Date().toISOString();

    serverCatalogCache.set(targetUrl, {
      targetUrl,
      artist: artistName,
      scannedAt,
      releases,
    });

    return res.json({
      success: true,
      source: 'live_crawl',
      targetUrl,
      artist: artistName,
      scannedAt,
      totalCount: releases.length,
      releases,
    });
  } catch (error: any) {
    console.error('Scan error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// SSE progressive stream endpoint for instant dynamic UI population
app.get('/api/bandcamp/scan-stream', async (req: Request, res: Response) => {
  const targetUrl = (req.query.url as string) || 'https://esoctrilihum.bandcamp.com/music';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { artistName, origin, artistBioPicUrl, items } = await discoverAllCatalogItems(targetUrl);

    // Send initial catalog manifest
    res.write(`data: ${JSON.stringify({ type: 'manifest', total: items.length, artist: artistName, items })}\n\n`);

    const accumulatedReleases: ScannedRelease[] = [];

    // Stream enriched release details progressively
    for (let i = 0; i < items.length; i++) {
      const release = await inspectReleaseSubpage(origin, artistName, items[i], artistBioPicUrl);
      accumulatedReleases.push(release);
      res.write(`data: ${JSON.stringify({ type: 'release_discovered', index: i, total: items.length, release })}\n\n`);
    }

    // Cache the completed crawl
    serverCatalogCache.set(targetUrl, {
      targetUrl,
      artist: artistName,
      scannedAt: new Date().toISOString(),
      releases: accumulatedReleases,
    });

    res.write(`data: ${JSON.stringify({ type: 'complete', total: items.length, artist: artistName, releases: accumulatedReleases })}\n\n`);
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message, message: err.message })}\n\n`);
    res.end();
  }
});

// Resolve download endpoint: strictly resolves genuine FLAC or requested format
app.post('/api/bandcamp/resolve-download', async (req: Request, res: Response) => {
  const { albumUrl, releaseId, format = 'flac', email = '', downloadPageUrl, triggerEmailOnly, release: passedRelease } = req.body;

  try {
    const formatInfo = SUPPORTED_FORMATS.find(f => f.id === format) || SUPPORTED_FORMATS[0]; // defaults to FLAC!

    // Check serverCatalogCache or passed release
    let cachedRelease: ScannedRelease | undefined = passedRelease;
    if (!cachedRelease) {
      for (const cached of serverCatalogCache.values()) {
        const match = cached.releases.find(r => (releaseId && r.id === releaseId) || (albumUrl && r.url === albumUrl));
        if (match) {
          cachedRelease = match;
          break;
        }
      }
    }

    let parsed: any = null;
    let tralbum: any = null;
    let origin = '';

    if (albumUrl) {
      try {
        origin = new URL(albumUrl).origin;
      } catch (e) {}
    }
    if (!origin && cachedRelease?.artistUrl) {
      origin = cachedRelease.artistUrl;
    }

    // 0. If downloadPageUrl is provided directly (from Gmail watchdog or freeDownloadPage), resolve immediately!
    const effectiveDownloadPageUrl = downloadPageUrl || cachedRelease?.freeDownloadPageUrl;

    if (effectiveDownloadPageUrl) {
      const resolved = await resolveBandcampDownload(effectiveDownloadPageUrl, formatInfo.id);
      if (resolved.success && resolved.downloadUrl) {
        return res.json({
          success: true,
          type: resolved.isArchive ? 'direct_archive' : 'direct_audio',
          downloadUrl: resolved.downloadUrl,
          format: resolved.format || formatInfo.id,
          description: resolved.description || formatInfo.name,
          sizeMb: resolved.sizeMb,
          fileExtension: formatInfo.ext,
          isArchive: resolved.isArchive,
          title: resolved.title || cachedRelease?.title || 'Release',
          artist: resolved.artist || cachedRelease?.artist || 'Artist',
          infoText: cachedRelease?.infoText,
          artUrl: cachedRelease?.artUrl,
          artistBioPicUrl: cachedRelease?.artistBioPicUrl,
          extraImages: cachedRelease?.extraImages || [],
          audioStreams: cachedRelease?.audioStreams || [],
        });
      } else {
        console.warn('Failed to resolve effectiveDownloadPageUrl:', effectiveDownloadPageUrl, resolved.error);
        return res.json({
          success: false,
          error: resolved.error || 'Failed to resolve audio download from mail link. Bandcamp link may have expired or timed out.',
          downloadPageUrl: effectiveDownloadPageUrl,
        });
      }
    }

    // 1. Paid release not purchased: skip audio and return full companion metadata immediately
    if (cachedRelease && cachedRelease.isPaid && !cachedRelease.isPurchased && !cachedRelease.freeDownloadPageUrl) {
      return res.json({
        success: false,
        isPaid: true,
        skipAudio: true,
        releaseId: cachedRelease.id,
        format: formatInfo.id,
        infoText: cachedRelease.infoText,
        artUrl: cachedRelease.artUrl,
        artistBioPicUrl: cachedRelease.artistBioPicUrl,
        extraImages: cachedRelease.extraImages,
        audioStreams: cachedRelease.audioStreams,
        title: cachedRelease.title,
        artist: cachedRelease.artist,
        minPrice: cachedRelease.minPrice,
        message: `Paid release (€${cachedRelease.minPrice} EUR): audio skipped per policy. Packaging artwork, photos, info.txt, and lyrics into companion info ZIP.`,
      });
    }

    // 2. If triggerEmailOnly is requested
    const effectiveItemId = cachedRelease?.itemId || req.body.itemId;
    const effectiveItemType = cachedRelease?.itemType || req.body.itemType || 'album';

    if (triggerEmailOnly && email && effectiveItemId && origin) {
      try {
        const targetOrigin = origin || (req.body.itemUrl ? new URL(req.body.itemUrl).origin : 'https://bandcamp.com');
        const body = new URLSearchParams({
          encoding_name: 'none',
          item_id: String(effectiveItemId),
          item_type: effectiveItemType,
          address: email,
          country: 'US',
          postcode: '0',
        });
        const emailRes = await fetch(`${targetOrigin}/email_download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            Origin: targetOrigin,
            Referer: req.body.itemUrl || targetOrigin,
            ...BANDCAMP_FETCH_HEADERS,
          },
          body,
        });
        const text = await emailRes.text();
        let emailData: any = {};
        try { emailData = JSON.parse(text); } catch (e) {}
        if (text.includes('Client Challenge')) {
          return res.json({ success: false, error: 'Bandcamp Cloudflare Bot Challenge active on datacenter IP. Use Chrome Extension to trigger email directly from your browser session.' });
        }
        return res.json({ success: true, ok: emailData?.ok !== false, triggered: true, emailData });
      } catch (trigErr: any) {
        return res.json({ success: false, error: trigErr.message });
      }
    }

    // 3. Fallback to live album fetch only if not already cached
    if (albumUrl && !cachedRelease) {
      try {
        const pageRes = await fetch(albumUrl, {
          headers: BANDCAMP_FETCH_HEADERS,
        });

        if (pageRes.ok) {
          const pageHtml = await pageRes.text();
          tralbum = extractBandcampTralbum(pageHtml);
          parsed = parseReleasePageData(
            pageHtml,
            tralbum,
            {
              id: releaseId || '',
              itemId: tralbum?.current?.id || 0,
              url: albumUrl,
              title: tralbum?.current?.title || '',
              artUrl: '',
              type: tralbum?.current?.type || 'album',
            },
            origin,
            tralbum?.artist || 'Esoctrilihum'
          );
        }
      } catch (pageErr: any) {
        console.warn('Error fetching album page in resolve-download:', pageErr.message);
      }
    }

    const effective = cachedRelease || (parsed ? {
      id: releaseId,
      itemId: parsed.itemId || 0,
      itemType: parsed.itemType || 'album',
      title: parsed.releaseTitle,
      artist: parsed.artist,
      artUrl: parsed.artUrl,
      artistBioPicUrl: parsed.artistBioPicUrl,
      extraImages: parsed.allImages || parsed.extraImages || [],
      infoText: parsed.infoText,
      audioStreams: parsed.audioStreams || [],
      isPaid: parsed.isPaid,
      isPurchased: parsed.isPurchased,
      isFree: parsed.isFree,
      minPrice: parsed.minPrice,
    } : null);

    if (effective) {
      // Stream fallback if user explicitly chose mp3-128
      if (formatInfo.id === 'mp3-128' && effective.audioStreams && effective.audioStreams.length > 0) {
        return res.json({
          success: true,
          type: 'tracks_collection',
          format: formatInfo.id,
          fileExtension: formatInfo.ext,
          infoText: effective.infoText,
          artUrl: effective.artUrl,
          artistBioPicUrl: effective.artistBioPicUrl,
          extraImages: effective.extraImages,
          audioStreams: effective.audioStreams,
          title: effective.title,
          artist: effective.artist,
          description: `${effective.audioStreams.length} tracks collection (${formatInfo.name})`,
        });
      }

      return res.json({
        success: false,
        releaseId,
        format: formatInfo.id,
        infoText: effective.infoText,
        artUrl: effective.artUrl,
        artistBioPicUrl: effective.artistBioPicUrl,
        extraImages: effective.extraImages,
        audioStreams: effective.audioStreams,
        title: effective.title,
        artist: effective.artist,
        error: `Studio audio download URL could not be resolved from mail watchdog for ${formatInfo.id.toUpperCase()}.`,
      });
    }

    return res.json({
      success: false,
      releaseId,
      format: formatInfo.id,
      error: 'Download could not be resolved for this release',
    });
    } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Proxy endpoint to query Google Apps Script Webhook
app.post('/api/bandcamp/check-gas-webhook', async (req: Request, res: Response) => {
  const webhookUrl = req.body.webhookUrl || req.body.gasUrl;
  const secret = req.body.secret;
  const releaseId = req.body.releaseId;
  const title = req.body.title;
  const since = req.body.since;

  if (!webhookUrl || !secret) {
    return res.status(400).json({ found: false, error: 'Missing webhookUrl or secret' });
  }

  try {
    const url = new URL(webhookUrl);
    url.searchParams.set('secret', secret);
    if (releaseId) url.searchParams.set('id', String(releaseId));
    if (title) url.searchParams.set('title', title);
    if (since) url.searchParams.set('since', String(since));
    if (req.body.hours) url.searchParams.set('hours', String(req.body.hours));
    if (req.body.days) url.searchParams.set('days', String(req.body.days));
    if (req.body.startDate) url.searchParams.set('startDate', String(req.body.startDate));

    const timeoutMs = (Number(req.body.timeoutSeconds) || 90) * 1000;
    const response = await fetch(url.toString(), {
      redirect: 'follow',
      headers: {
        'Accept': 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();

    if (text.includes('accounts.google.com') || text.includes('ServiceLogin') || text.includes('Google Accounts')) {
      return res.json({
        found: false,
        error: 'Google Login required: In Google Apps Script, click Deploy -> Manage deployments -> Edit (pencil icon), and set "Who has access" to "Anyone" (currently set to "Only myself").',
        raw: text.slice(0, 300)
      });
    }

    try {
      const data = JSON.parse(text);
      if (data && data.downloadPageUrl) {
        data.downloadPageUrl = data.downloadPageUrl.replace(/&amp;/g, '&').trim();
      }
      return res.json(data);
    } catch (e) {
      return res.json({
        found: false,
        error: 'Non-JSON response from Google Apps Script. Ensure "Who has access" is set to "Anyone" in Web App deployment settings.',
        raw: text.slice(0, 300)
      });
    }
  } catch (err: any) {
    return res.status(500).json({ found: false, error: err.message });
  }
});

// Test Google Apps Script Webhook connection
app.post('/api/bandcamp/test-gas-webhook', async (req: Request, res: Response) => {
  const webhookUrl = req.body.webhookUrl || req.body.gasUrl;
  const secret = req.body.secret;

  if (!webhookUrl || !secret) {
    return res.status(400).json({ ok: false, success: false, error: 'Missing webhookUrl or secret' });
  }

  try {
    const url = new URL(webhookUrl);
    url.searchParams.set('secret', secret);
    url.searchParams.set('test', 'true');

    const response = await fetch(url.toString(), {
      redirect: 'follow',
      headers: {
        'Accept': 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(12000),
    });

    const text = await response.text();

    if (text.includes('accounts.google.com') || text.includes('ServiceLogin') || text.includes('Google Accounts')) {
      return res.json({
        ok: false,
        success: false,
        error: 'Google Login required: In Google Apps Script, click Deploy -> Manage deployments -> Edit (pencil icon), and set "Who has access" to "Anyone" (currently set to "Only myself").',
        raw: text.slice(0, 300)
      });
    }

    try {
      const data = JSON.parse(text);
      if (data.test) {
        return res.json({ ok: true, success: true, message: data.message || 'Connected successfully!' });
      }
      if (data.error) {
        return res.json({ ok: false, success: false, error: data.error });
      }
      return res.json({ ok: true, success: true, message: 'Connected to Webhook!' });
    } catch (e) {
      return res.json({
        ok: false,
        success: false,
        error: 'Non-JSON response from Google Apps Script. Ensure "Who has access" is set to "Anyone" in Web App deployment settings.',
        raw: text.slice(0, 300)
      });
    }
  } catch (err: any) {
    return res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

// Image proxy endpoint: bypasses browser CORS restrictions so cover.jpg and photos never fail
app.get('/api/bandcamp/proxy-image', async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    return res.status(400).send('Missing image URL');
  }

  try {
    const imgRes = await fetch(imageUrl, {
      headers: BANDCAMP_FETCH_HEADERS,
    });

    if (!imgRes.ok) {
      return res.status(imgRes.status).send('Failed to fetch image');
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return res.send(buffer);
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// Audio proxy endpoint: streams genuine audio with metadata tags, transcoding with ffmpeg if needed
app.get('/api/bandcamp/proxy-audio', async (req: Request, res: Response) => {
  const audioUrl = req.query.url as string;
  const albumUrl = req.query.albumUrl as string;
  const filename = (req.query.filename as string) || 'track.flac';
  const targetFormat = ((req.query.format as string) || (filename.endsWith('.flac') ? 'flac' : 'mp3')).toLowerCase();
  const title = (req.query.title as string) || '';
  const artist = (req.query.artist as string) || '';
  const album = (req.query.album as string) || '';
  const year = (req.query.year as string) || '';
  const trackNum = (req.query.trackNum as string) || '';

  if (!audioUrl && !albumUrl) {
    return res.status(400).send('Missing audio URL');
  }

  console.log(`[BandcampDL:proxy-audio] Request: filename=${filename}, format=${targetFormat}, audioUrl=${audioUrl?.slice(0, 80)}...`);

  try {
    let audioRes: any = null;
    if (audioUrl) {
      let referer = 'https://bandcamp.com/';
      try {
        const u = new URL(audioUrl);
        referer = u.origin + '/';
      } catch (e) {}

      audioRes = await fetch(audioUrl, {
        headers: {
          ...BANDCAMP_FETCH_HEADERS,
          Referer: referer,
        },
        redirect: 'follow',
      });
      console.log(`[BandcampDL:proxy-audio] Fetch status: ${audioRes.status}, Content-Type: ${audioRes.headers.get('content-type')}`);
    }

    // Auto-refresh expired stream URL from Bandcamp album page if 403 or missing
    if ((!audioRes || !audioRes.ok) && albumUrl) {
      try {
        console.log(`[BandcampDL:proxy-audio] Stream link expired (${audioRes?.status}), attempting refresh from ${albumUrl}...`);
        const pageRes = await fetch(albumUrl, {
          headers: BANDCAMP_FETCH_HEADERS,
        });
        if (pageRes.ok) {
          const pageHtml = await pageRes.text();
          const tralbum = extractBandcampTralbum(pageHtml);
          const tNum = parseInt(String(trackNum || '1'), 10);
          const tInfo = tralbum?.trackinfo?.find((t: any) => t.track_num === tNum) || tralbum?.trackinfo?.[tNum - 1] || tralbum?.trackinfo?.[0];
          const freshStreamUrl = tInfo?.file?.['mp3-128'];
          if (freshStreamUrl) {
            audioRes = await fetch(freshStreamUrl, {
              headers: {
                ...BANDCAMP_FETCH_HEADERS,
                Referer: albumUrl,
              },
              redirect: 'follow',
            });
            console.log(`[BandcampDL:proxy-audio] Refreshed stream fetch status: ${audioRes.status}`);
          }
        }
      } catch (refreshErr) {
        console.warn('Error refreshing fresh stream URL:', refreshErr);
      }
    }

    if (!audioRes || !audioRes.ok) {
      const errStatus = audioRes ? audioRes.status : 500;
      console.error(`[BandcampDL:proxy-audio] Failed to fetch audio stream. Status: ${errStatus}`);
      return res.status(errStatus).send(`Failed to fetch audio stream: HTTP ${errStatus}`);
    }

    const contentType = audioRes.headers.get('content-type') || '';
    const isZip =
      filename.toLowerCase().endsWith('.zip') ||
      contentType.includes('zip') ||
      (audioUrl && (audioUrl.includes('.zip') || audioUrl.includes('download/album') || audioUrl.includes('type=album') || audioUrl.includes('enc=zip')));

    // 1. If it's an album ZIP archive, stream raw bytes directly as application/zip (never pipe to ffmpeg!)
    if (isZip) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      const cl = audioRes.headers.get('content-length');
      if (cl) res.setHeader('Content-Length', cl);

      if (audioRes.body) {
        const { Readable } = await import('stream');
        const nodeStream = Readable.fromWeb(audioRes.body as any);
        return nodeStream.pipe(res);
      }
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      return res.send(buffer);
    }

    // 2. Direct studio master download from Bandcamp (popplers CDN / statdownload / native FLAC)
    const isDirectBandcamp = audioUrl && (audioUrl.includes('popplers') || audioUrl.includes('/download/track') || audioUrl.includes('bcbits.com'));
    const isSourceNativeFlac = contentType.includes('flac') || (audioUrl && audioUrl.includes('.flac'));

    if (isDirectBandcamp || isSourceNativeFlac) {
      const mime = (targetFormat === 'flac' || isSourceNativeFlac) ? 'audio/flac' : (targetFormat.includes('mp3') ? 'audio/mpeg' : 'application/octet-stream');
      res.setHeader('Content-Type', mime);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      const cl = audioRes.headers.get('content-length');
      if (cl) res.setHeader('Content-Length', cl);

      if (audioRes.body) {
        const { Readable } = await import('stream');
        const nodeStream = Readable.fromWeb(audioRes.body as any);
        return nodeStream.pipe(res);
      }
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      return res.send(buffer);
    }

    const inputBuffer = Buffer.from(await audioRes.arrayBuffer());

    // Transcode using ffmpeg to guarantee valid standard CD-quality FLAC/MP3 format and embedded metadata tags
    const tempId = crypto.randomBytes(8).toString('hex');
    const tempDir = os.tmpdir();
    const tempIn = path.join(tempDir, `bc_in_${tempId}.bin`);
    const tempOut = path.join(tempDir, `bc_out_${tempId}.${targetFormat === 'flac' ? 'flac' : 'mp3'}`);

    try {
      fs.writeFileSync(tempIn, inputBuffer);
      const metaArgs: string[] = [];
      if (title) metaArgs.push(`-metadata`, `title=${title}`);
      if (artist) metaArgs.push(`-metadata`, `artist=${artist}`);
      if (album) metaArgs.push(`-metadata`, `album=${album}`);
      if (year) metaArgs.push(`-metadata`, `date=${year}`);
      if (trackNum) metaArgs.push(`-metadata`, `track=${trackNum}`);

      const codecArgs = targetFormat === 'flac'
        ? ['-c:a', 'flac', '-sample_fmt', 's16', '-compression_level', '5']
        : ['-c:a', 'libmp3lame', '-b:a', '320k'];

      await execPromise(`ffmpeg -y -i "${tempIn}" ${metaArgs.map(a => `"${a}"`).join(' ')} ${codecArgs.join(' ')} "${tempOut}"`, {
        timeout: 45000,
      });

      const outBuffer = fs.readFileSync(tempOut);
      res.setHeader('Content-Type', targetFormat === 'flac' ? 'audio/flac' : 'audio/mpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      return res.send(outBuffer);
    } catch (ffmpegErr) {
      console.warn('ffmpeg transcode fallback, sending input buffer with ID3:', ffmpegErr);
      const taggedBuffer = NodeID3.write(
        {
          title: title || undefined,
          artist: artist || undefined,
          album: album || undefined,
          year: year || undefined,
          trackNumber: trackNum || undefined,
        },
        inputBuffer
      );
      res.setHeader('Content-Type', contentType.includes('flac') ? 'audio/flac' : 'audio/mpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      return res.send(taggedBuffer);
    } finally {
      try { if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn); } catch (e) {}
      try { if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut); } catch (e) {}
    }
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// Extension ZIP generator endpoint
app.get('/api/extension/download-zip', async (_req: Request, res: Response) => {
  try {
    const { createExtensionZipBuffer } = await import('./src/services/extensionPackage');
    const content = await createExtensionZipBuffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="bandcamp-bulk-downloader-extension.zip"');
    res.send(Buffer.from(content));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
