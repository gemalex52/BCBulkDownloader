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

// Helper to extract TralbumData JSON from Bandcamp HTML
function extractBandcampTralbum(html: string): any | null {
  try {
    const tralbumAttrMatch = html.match(/data-tralbum="([^"]+)"/);
    if (tralbumAttrMatch) {
      const decoded = tralbumAttrMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      return JSON.parse(decoded);
    }

    const tralbumVarMatch = html.match(/var\s+TralbumData\s*=\s*(\{[\s\S]*?\});/);
    if (tralbumVarMatch) {
      return JSON.parse(tralbumVarMatch[1]);
    }
  } catch (err) {
    console.error('Error parsing TralbumData JSON:', err);
  }
  return null;
}

// Discover all releases on a Bandcamp catalog page (rendered <li> + data-client-items)
async function discoverAllCatalogItems(targetUrl: string): Promise<{
  artistName: string;
  origin: string;
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

  const catalogRes = await fetch(targetUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  });

  if (!catalogRes.ok) {
    throw new Error(`Failed to fetch catalog: HTTP ${catalogRes.status}`);
  }

  const html = await catalogRes.text();

  const artistName =
    html.match(/<span[^>]*class="title"[^>]*>([^<]+)<\/span>/i)?.[1]?.trim() ||
    html.match(/<title>([^|<]+)/i)?.[1]?.trim() ||
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
      title: titleMatch ? titleMatch[1].trim() : 'Release',
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
            title: item.title || 'Release',
            artUrl,
            type: isAlbum ? 'album' : 'track',
          });
        }
      }
    } catch (e) {
      console.warn('Failed parsing data-client-items:', e);
    }
  }

  return {
    artistName,
    origin,
    items: Array.from(itemsMap.values()),
  };
}

// Clean HTML text stripping scripts, styles, brs, and tags
function cleanHtmlText(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Parse release subpage into complete metadata, artwork, pricing, and comprehensive info.txt
function parseReleasePageData(
  subHtml: string,
  tralbum: any,
  item: {
    id: string;
    itemId: number;
    url: string;
    title: string;
    artUrl: string;
    type: 'album' | 'track';
  },
  origin: string,
  fallbackArtist: string
) {
  const current = tralbum?.current;
  const isPurchased = Boolean(
    tralbum?.is_purchased ||
    tralbum?.has_purchased ||
    tralbum?.you_own_it ||
    /you\s+own\s+this|you\s+own\s+it|class="[^"]*you-own-this/i.test(subHtml)
  );

  const minPrice = current?.minimum_price != null ? current.minimum_price : 0;
  const freeDlPage = tralbum?.freeDownloadPage || null;
  const hasFreeButton = /free\s+download/i.test(subHtml) || current?.download_pref === 1;
  const hasNypText = /name\s+your\s+price/i.test(subHtml) || current?.download_pref === 2;
  const requireEmail = Boolean(current?.require_email || current?.require_email_0);

  // Pricing logic:
  // - If purchased: user owns it
  // - If explicit freeDownloadPage, 'Free Download' button, or download_pref === 1: free
  // - If minPrice === 0 and hasNypText: Name Your Price ($0+)
  // - Otherwise: strictly PAID
  let isFree = false;
  let isNyp = false;
  let isPaid = false;

  if (isPurchased) {
    isFree = true;
  } else if (Boolean(freeDlPage) || hasFreeButton || (minPrice === 0 && !hasNypText)) {
    isFree = true;
  } else if (minPrice === 0 && hasNypText) {
    isNyp = true;
  } else {
    isPaid = true;
  }

  let priceFormatted = 'Paid';
  if (isPurchased) {
    priceFormatted = 'You Own It';
  } else if (isFree) {
    priceFormatted = 'Free Download';
  } else if (isNyp) {
    priceFormatted = 'Name Your Price ($0+)';
  } else if (minPrice > 0) {
    priceFormatted = `€${minPrice} EUR`;
  }

  // Audio streams and track lyrics
  const audioStreams: { trackNum: number; title: string; streamUrl?: string; url?: string; duration?: number; lyrics?: string }[] = [];
  if (tralbum?.trackinfo && Array.isArray(tralbum.trackinfo)) {
    tralbum.trackinfo.forEach((t: any, idx: number) => {
      const stream = t.file?.['mp3-128'];
      audioStreams.push({
        trackNum: t.track_num || idx + 1,
        title: t.title || `Track ${idx + 1}`,
        streamUrl: stream || undefined,
        url: stream || undefined,
        duration: t.duration || undefined,
        lyrics: t.lyrics ? String(t.lyrics).trim() : undefined,
      });
    });
  }

  // Artwork & additional photos
  const artId = tralbum?.art_id;
  const artUrl = artId ? `https://f4.bcbits.com/img/a${artId}_10.jpg` : item.artUrl;
  const popupImages = Array.from(subHtml.matchAll(/href="([^"]+_10\.jpg)"/g)).map(m => m[1]);
  const imgMatches = Array.from(subHtml.matchAll(/src="([^"]+_10\.jpg)"/g)).map(m => m[1]);
  const allImages = Array.from(new Set([...popupImages, ...imgMatches])).filter(u => u !== artUrl);

  // Extract liner notes / about, credits, license, tags, and lyrics
  const aboutMatch = subHtml.match(/class="[^"]*tralbum-about[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const creditsMatch = subHtml.match(/class="[^"]*tralbum-credits[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const licenseMatch = subHtml.match(/<div[^>]*id="license"[^>]*>([\s\S]*?)<\/div>/i) ||
                       subHtml.match(/<div[^>]*class="[^"]*license[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const lyricsDivMatch = subHtml.match(/class="[^"]*lyricsText[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  const aboutText = cleanHtmlText(aboutMatch?.[1]) || cleanHtmlText(current?.about);
  const creditsText = cleanHtmlText(creditsMatch?.[1]) || cleanHtmlText(current?.credits);
  const licenseText = cleanHtmlText(licenseMatch?.[1]);
  const pageLyrics = cleanHtmlText(lyricsDivMatch?.[1]);

  let tagsMatches = (tralbum?.tags && Array.isArray(tralbum.tags) && tralbum.tags.length > 0)
    ? tralbum.tags
    : Array.from(subHtml.matchAll(/<a[^>]*class="tag"[^>]*>([^<]+)<\/a>/gi)).map(tm => tm[1].trim());
  tagsMatches = Array.from(new Set(tagsMatches));

  // Format release date
  const rawDate = current?.release_date || current?.publish_date;
  const dotDate = formatDateToDotString(rawDate);
  const humanDate = rawDate
    ? new Date(rawDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : undefined;

  const releaseTitle = current?.title || item.title;
  const artist = tralbum?.artist || fallbackArtist;

  // Tracklist formatting
  const formatDuration = (sec?: number) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return ` (${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')})`;
  };

  const trackListFormatted = audioStreams.length > 0
    ? audioStreams.map(s => `${s.trackNum}. ${s.title}${formatDuration(s.duration)}`)
    : ['1. ' + releaseTitle];

  // Track lyrics block for info.txt
  const tracksWithLyrics = audioStreams.filter(s => s.lyrics && s.lyrics.trim().length > 0);
  let lyricsBlock = '';
  if (tracksWithLyrics.length > 0) {
    lyricsBlock = `================================================================================\nLYRICS\n================================================================================\n(Track lyrics are also saved as separate .lrc files alongside track audio files)\n\n` +
      tracksWithLyrics.map(t => `--- Track ${t.trackNum}: ${t.title} ---\n${t.lyrics}\n`).join('\n') + '\n';
  } else if (pageLyrics) {
    lyricsBlock = `================================================================================\nLYRICS\n================================================================================\n${pageLyrics}\n\n`;
  }

  const divider = '='.repeat(80);
  let infoText = `${divider}\n${releaseTitle.toUpperCase()} by ${artist}\n${divider}\n`;
  infoText += `Release Date : ${humanDate || 'Unknown'}${dotDate ? ` (${dotDate})` : ''}\n`;
  infoText += `Type         : ${item.type.toUpperCase()}\n`;
  infoText += `Status       : ${priceFormatted}${isPaid ? ' (Paid release - Audio skipped unless purchased. Artwork, photos & info bundled)' : ''}\n`;
  infoText += `Bandcamp URL : ${item.url}\n`;
  infoText += `Artist Page  : ${origin}\n\n`;

  if (trackListFormatted.length > 0) {
    infoText += `${divider}\nTRACKLIST (${trackListFormatted.length} Tracks)\n${divider}\n${trackListFormatted.join('\n')}\n\n`;
  }

  if (aboutText) {
    infoText += `${divider}\nLINER NOTES / ABOUT\n${divider}\n${aboutText}\n\n`;
  }

  if (creditsText) {
    infoText += `${divider}\nCREDITS\n${divider}\n${creditsText}\n\n`;
  }

  if (licenseText) {
    infoText += `${divider}\nLICENSE\n${divider}\n${licenseText}\n\n`;
  }

  if (tagsMatches.length > 0) {
    infoText += `${divider}\nTAGS & GENRES\n${divider}\n${tagsMatches.join(', ')}\n\n`;
  }

  if (lyricsBlock) {
    infoText += lyricsBlock;
  }

  infoText += `${divider}\nDownloaded with Bandcamp Free & NYP Bulk Downloader\n${divider}\n`;

  return {
    releaseTitle,
    artist,
    artUrl,
    allImages,
    humanDate,
    dotDate,
    isFree,
    isNyp,
    isPurchased,
    isPaid,
    minPrice,
    priceFormatted,
    requireEmail,
    freeDlPage,
    trackListFormatted,
    audioStreams,
    aboutText,
    creditsText,
    licenseText,
    tagsMatches,
    infoText,
  };
}

// Inspect a single release subpage for artwork, full metadata, info text, and pricing
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
  }
): Promise<ScannedRelease> {
  try {
    const subRes = await fetch(item.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    if (!subRes.ok) throw new Error(`HTTP ${subRes.status}`);

    const subHtml = await subRes.text();
    const tralbum = extractBandcampTralbum(subHtml);
    const parsed = parseReleasePageData(subHtml, tralbum, item, origin, artistName);

    return {
      id: item.id,
      itemId: tralbum?.current?.id || item.itemId,
      itemType: item.type,
      title: parsed.releaseTitle,
      artist: parsed.artist,
      artistUrl: origin,
      url: item.url,
      artUrl: parsed.artUrl,
      extraImages: parsed.allImages,
      releaseDate: parsed.humanDate,
      isoDate: parsed.dotDate,
      isFree: parsed.isFree,
      isNameYourPrice: parsed.isNyp,
      isPurchased: parsed.isPurchased,
      minPrice: parsed.minPrice,
      currency: tralbum?.current?.currency || 'EUR',
      priceFormatted: parsed.priceFormatted,
      requiresEmail: parsed.requireEmail,
      freeDownloadPageUrl: parsed.freeDlPage,
      trackCount: parsed.trackListFormatted.length,
      trackList: parsed.trackListFormatted,
      audioStreams: parsed.audioStreams,
      aboutText: parsed.aboutText,
      creditsText: parsed.creditsText,
      infoText: parsed.infoText,
      tags: parsed.tagsMatches,
      selected: parsed.isFree || parsed.isNyp || parsed.isPurchased,
    };
  } catch (e) {
    return {
      id: item.id,
      itemId: item.itemId,
      itemType: item.type,
      title: item.title,
      artist: artistName,
      artistUrl: origin,
      url: item.url,
      artUrl: item.artUrl,
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

// Resolve genuine Bandcamp FLAC / MP3-320 download link via statdownload algorithm
async function resolveBandcampDownload(freeDownloadPageUrl: string, requestedFormat: string = 'flac'): Promise<{
  success: boolean;
  downloadUrl?: string;
  format?: string;
  description?: string;
  sizeMb?: string;
  isArchive?: boolean;
  error?: string;
}> {
  try {
    const dlRes = await fetch(freeDownloadPageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!dlRes.ok) throw new Error(`Download page HTTP ${dlRes.status}`);

    const dlHtml = await dlRes.text();
    const blobMatch = dlHtml.match(/data-blob="([^"]+)"/);
    if (!blobMatch) throw new Error('No data-blob found on download page');

    const blob = JSON.parse(blobMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const downloads = blob?.digital_items?.[0]?.downloads;
    if (!downloads) throw new Error('No downloads object found in digital_items');

    // Pick target format: strict preference for requested format (flac, mp3-320, wav, etc.)
    const target =
      downloads[requestedFormat] ||
      downloads['flac'] ||
      downloads['mp3-320'] ||
      downloads['mp3-v0'] ||
      downloads['wav'] ||
      Object.values(downloads)[0];

    if (!target?.url) throw new Error('No target download URL available');

    // Call Bandcamp statdownload API with random token & retry handling
    async function callStat(urlToStat: string): Promise<any> {
      const parsed = new URL(urlToStat);
      const statUrl =
        parsed.origin +
        parsed.pathname.replace('/download/', '/statdownload/') +
        parsed.search +
        '&.rand=' +
        Math.floor(Math.random() * 1000000) +
        '&.vrs=1';

      const res = await fetch(statUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Referer: freeDownloadPageUrl,
        },
      });

      const text = await res.text();
      const jsonMatch = text.match(/Downloads\.statResult\s*\(\s*(\{[\s\S]*?\})\s*\)/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      return null;
    }

    let stat = await callStat(target.url);
    if (stat?.result === 'err' && stat?.retry_url) {
      stat = await callStat(stat.retry_url);
    }

    if (stat?.download_url) {
      return {
        success: true,
        downloadUrl: stat.download_url,
        format: target.encoding_name,
        description: target.description,
        sizeMb: target.size_mb,
        isArchive: Boolean(target.url.includes('/album?')),
      };
    }

    return {
      success: true,
      downloadUrl: target.url,
      format: target.encoding_name,
      description: target.description,
      sizeMb: target.size_mb,
      isArchive: Boolean(target.url.includes('/album?')),
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
    };
  }
}

// Catalog scan endpoint
app.get('/api/bandcamp/scan', async (req: Request, res: Response) => {
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
    const { artistName, origin, items } = await discoverAllCatalogItems(targetUrl);

    const releases: ScannedRelease[] = [];
    const batchSize = 6;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(item => inspectReleaseSubpage(origin, artistName, item))
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
    const { artistName, origin, items } = await discoverAllCatalogItems(targetUrl);

    // Send initial catalog manifest
    res.write(`data: ${JSON.stringify({ type: 'manifest', total: items.length, artist: artistName, items })}\n\n`);

    // Stream enriched release details progressively
    for (let i = 0; i < items.length; i++) {
      const release = await inspectReleaseSubpage(origin, artistName, items[i]);
      res.write(`data: ${JSON.stringify({ type: 'release', index: i, total: items.length, release })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done', total: items.length })}\n\n`);
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// Resolve download endpoint: strictly resolves genuine FLAC or requested format
app.post('/api/bandcamp/resolve-download', async (req: Request, res: Response) => {
  const { albumUrl, releaseId, format = 'flac', email = '' } = req.body;

  try {
    const formatInfo = SUPPORTED_FORMATS.find(f => f.id === format) || SUPPORTED_FORMATS[0]; // defaults to FLAC!

    if (albumUrl) {
      const pageRes = await fetch(albumUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });

      if (pageRes.ok) {
        const pageHtml = await pageRes.text();
        const tralbum = extractBandcampTralbum(pageHtml);
        const origin = new URL(albumUrl).origin;
        const parsed = parseReleasePageData(
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

        // 1. Direct freeDownloadPage (e.g. CYPH WVNG studio master FLAC)
        if (tralbum?.freeDownloadPage) {
          const resolved = await resolveBandcampDownload(tralbum.freeDownloadPage, formatInfo.id);
          if (resolved.success && resolved.downloadUrl) {
            return res.json({
              success: true,
              type: resolved.isArchive ? 'direct_archive' : 'direct_audio',
              downloadUrl: resolved.downloadUrl,
              format: resolved.format || formatInfo.id,
              description: resolved.description || formatInfo.name,
              sizeMb: resolved.sizeMb,
              fileExtension: formatInfo.ext,
              infoText: parsed.infoText,
              artUrl: parsed.artUrl,
              extraImages: parsed.allImages,
              audioStreams: parsed.audioStreams,
              title: parsed.releaseTitle,
              artist: parsed.artist,
            });
          }
        }

        // 2. Email token submission for NYP releases
        if (email && tralbum?.current?.id) {
          try {
            const body = new URLSearchParams({
              encoding_name: formatInfo.id,
              item_id: String(tralbum.current.id),
              item_type: tralbum.current.type || 'album',
              address: email,
              country: 'US',
              postcode: '10001',
            });

            const emailRes = await fetch(`${origin}/email_download`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              },
              body,
            });

            if (emailRes.ok) {
              const emailData = await emailRes.json();
              if (emailData?.download_url) {
                const resolved = await resolveBandcampDownload(emailData.download_url, formatInfo.id);
                if (resolved.success && resolved.downloadUrl) {
                  return res.json({
                    success: true,
                    type: resolved.isArchive ? 'direct_archive' : 'direct_audio',
                    downloadUrl: resolved.downloadUrl,
                    format: resolved.format || formatInfo.id,
                    description: resolved.description || formatInfo.name,
                    sizeMb: resolved.sizeMb,
                    fileExtension: formatInfo.ext,
                    infoText: parsed.infoText,
                    artUrl: parsed.artUrl,
                    extraImages: parsed.allImages,
                    audioStreams: parsed.audioStreams,
                    title: parsed.releaseTitle,
                    artist: parsed.artist,
                  });
                }
              }
            }
          } catch (emailErr) {
            console.warn('email_download error:', emailErr);
          }
        }

        // 3. Free, NYP, or Purchased release with track streams (e.g. Eternal Life in Metastasized Dreams)
        if ((parsed.isFree || parsed.isNyp || parsed.isPurchased) && parsed.audioStreams.length > 0) {
          return res.json({
            success: true,
            type: 'tracks_collection',
            format: formatInfo.id,
            fileExtension: formatInfo.ext,
            infoText: parsed.infoText,
            artUrl: parsed.artUrl,
            extraImages: parsed.allImages,
            audioStreams: parsed.audioStreams,
            title: parsed.releaseTitle,
            artist: parsed.artist,
            description: `${parsed.audioStreams.length} tracks collection (${formatInfo.name})`,
          });
        }

        // 4. Paid album not purchased: skip audio and return metadata for bundling
        if (parsed.isPaid && !parsed.isPurchased) {
          return res.json({
            success: false,
            isPaid: true,
            skipAudio: true,
            releaseId,
            format: formatInfo.id,
            infoText: parsed.infoText,
            artUrl: parsed.artUrl,
            extraImages: parsed.allImages,
            audioStreams: parsed.audioStreams,
            title: parsed.releaseTitle,
            artist: parsed.artist,
            message: 'Paid release: audio skipped per policy. Packaging artwork, photos, info.txt, and lyrics.',
          });
        }

        return res.json({
          success: false,
          releaseId,
          format: formatInfo.id,
          infoText: parsed.infoText,
          artUrl: parsed.artUrl,
          extraImages: parsed.allImages,
          audioStreams: parsed.audioStreams,
          title: parsed.releaseTitle,
          artist: parsed.artist,
          error: `Audio download could not be resolved for this release.`,
        });
      }
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

// Image proxy endpoint: bypasses browser CORS restrictions so cover.jpg and photos never fail
app.get('/api/bandcamp/proxy-image', async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    return res.status(400).send('Missing image URL');
  }

  try {
    const imgRes = await fetch(imageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
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

  try {
    let audioRes: any = null;
    if (audioUrl) {
      audioRes = await fetch(audioUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });
    }

    // Auto-refresh expired stream URL from Bandcamp album page if 403 or missing
    if ((!audioRes || !audioRes.ok) && albumUrl) {
      try {
        const pageRes = await fetch(albumUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
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
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              },
            });
          }
        }
      } catch (refreshErr) {
        console.warn('Error refreshing fresh stream URL:', refreshErr);
      }
    }

    if (!audioRes || !audioRes.ok) {
      return res.status(audioRes ? audioRes.status : 500).send('Failed to fetch audio stream');
    }

    const contentType = audioRes.headers.get('content-type') || '';
    const isSourceNativeFlac = contentType.includes('flac') || (audioUrl && audioUrl.includes('.flac'));

    // If source is already native FLAC and target is FLAC, stream directly
    if (isSourceNativeFlac && targetFormat === 'flac') {
      res.setHeader('Content-Type', 'audio/flac');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
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
