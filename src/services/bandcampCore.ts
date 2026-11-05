// Core Bandcamp Processing Engine (Unified Single Source of Truth for Server, Client, and Extension)

export const BANDCAMP_FETCH_HEADERS: Record<string, string> = {
  'User-Agent': 'curl/8.4.0',
  'Accept': '*/*',
};

export interface ParsedReleaseDetails {
  releaseTitle: string;
  artist: string;
  artUrl: string;
  artistBioPicUrl?: string;
  extraImages: string[];
  allImages: string[];
  humanDate?: string;
  dotDate?: string;
  isFree: boolean;
  isNyp: boolean;
  isPurchased: boolean;
  isPaid: boolean;
  badgeType: 'own' | 'free' | 'email' | 'paid';
  minPrice: number;
  priceFormatted: string;
  requireEmail: boolean;
  freeDlPage?: string | null;
  trackListFormatted: string[];
  audioStreams: {
    trackNum: number;
    title: string;
    streamUrl?: string;
    url?: string;
    duration?: number;
    lyrics?: string;
  }[];
  aboutText: string;
  creditsText: string;
  licenseText: string;
  tagsMatches: string[];
  infoText: string;
  fromAlbumTitle?: string;
}

export function cleanHtmlText(raw?: string): string {
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
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&euml;/g, 'ë')
    .replace(/&Euml;/g, 'Ë')
    .replace(/&auml;/g, 'ä')
    .replace(/&Auml;/g, 'Ä')
    .replace(/&ouml;/g, 'ö')
    .replace(/&Ouml;/g, 'Ö')
    .replace(/&uuml;/g, 'ü')
    .replace(/&Uuml;/g, 'Ü')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatDateToDotString(raw?: string): string {
  if (!raw) return '';
  try {
    const clean = String(raw).replace(/released\s+/i, '').trim();
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}.${mm}.${dd}`;
    }
  } catch (e) {}

  const match = String(raw).match(/(\d{4})[.-](\d{1,2})[.-](\d{1,2})/);
  if (match) {
    return `${match[1]}.${match[2].padStart(2, '0')}.${match[3].padStart(2, '0')}`;
  }
  return '';
}

export function extractBandcampTralbum(html: string): any {
  if (!html) return null;
  try {
    const tralbumDataMatch = html.match(/data-tralbum="([^"]+)"/);
    if (tralbumDataMatch) {
      const decoded = tralbumDataMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      return JSON.parse(decoded);
    }

    const tralbumVarMatch = html.match(/var\s+TralbumData\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (tralbumVarMatch) {
      try {
        return JSON.parse(tralbumVarMatch[1]);
      } catch (e) {
        // Evaluate loosely if unquoted keys are present
        const fn = new Function(`return (${tralbumVarMatch[1]});`);
        return fn();
      }
    }

    // Try JSON-LD as fallback
    const ldJsonMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (ldJsonMatch) {
      const parsedLd = JSON.parse(ldJsonMatch[1]);
      if (parsedLd) {
        return {
          current: {
            title: parsedLd.name,
            release_date: parsedLd.datePublished || parsedLd.dateModified,
            about: parsedLd.description,
          },
          artist: parsedLd.byArtist?.name,
        };
      }
    }
  } catch (err) {
    console.warn('Error extracting TralbumData:', err);
  }
  return null;
}

// Extract max-resolution artist bio picture (Bandcamp CDN 00..._10.jpg or bio-pic container)
export function extractArtistBioPicUrl(html: string, tralbum?: any, globalBioUrl?: string): string | undefined {
  if (!html && !tralbum) return globalBioUrl;

  // 1. Direct tralbum bio_pic_id (Bandcamp CDN standard prefix: 00)
  const bioPicId = tralbum?.band?.bio_pic_id || tralbum?.bio_pic_id;
  if (bioPicId) {
    return `https://f4.bcbits.com/img/00${bioPicId}_10.jpg`;
  }

  // 2. Specific Bandcamp artist CDN pattern: 00\d+_...
  const cdnBioMatch = html.match(/https?:\/\/f4\.bcbits\.com\/img\/00(\d+)_/i);
  if (cdnBioMatch) {
    return `https://f4.bcbits.com/img/00${cdnBioMatch[1]}_10.jpg`;
  }

  // 3. HTML class selector patterns: bio-pic, band-photo, photo
  const bioPicMatch =
    html.match(/class="[^"]*bio-pic[^"]*"[^>]*src="([^"]+)"/i) ||
    html.match(/id="bio-container"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i) ||
    html.match(/class="[^"]*band-photo[^"]*"[^>]*src="([^"]+)"/i) ||
    html.match(/<img[^>]*class="[^"]*photo[^"]*"[^>]*src="([^"]+)"/i);

  if (bioPicMatch?.[1]) {
    return bioPicMatch[1].replace(/_\d+\.jpg/, '_10.jpg');
  }

  return globalBioUrl || undefined;
}

// Complete release parser generating exhaustive info.txt and rich metadata
export function parseReleasePageData(
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
  fallbackArtist: string,
  globalArtistBioPicUrl?: string
): ParsedReleaseDetails {
  const current = tralbum?.current;
  const isPurchased = Boolean(
    tralbum?.is_purchased ||
    tralbum?.has_purchased ||
    tralbum?.you_own_it ||
    /you\s+own\s+this|you\s+own\s+it|class="[^"]*you-own-this/i.test(subHtml)
  );

  const minPrice = current?.minimum_price != null ? current.minimum_price : 0;
  const freeDlPage = tralbum?.freeDownloadPage || null;
  const hasFreeButton = /free\s+download/i.test(subHtml) || (minPrice === 0 && current?.download_pref === 1);
  const hasNypText = /name\s+your\s+price/i.test(subHtml) || current?.download_pref === 2;
  const requireEmail = Boolean(current?.require_email || current?.require_email_0);

  let isFree = false;
  let isNyp = false;
  let isPaid = false;
  let badgeType: 'own' | 'free' | 'email' | 'paid' = 'free';

  if (isPurchased) {
    isFree = true;
    badgeType = 'own';
  } else if (Boolean(freeDlPage) || (minPrice === 0 && current?.download_pref === 1 && !requireEmail) || (hasFreeButton && !requireEmail)) {
    // Direct free download without email
    isFree = true;
    badgeType = 'free';
  } else if (requireEmail || hasNypText) {
    // Email is sufficient for download (even if minPrice > 0, paying is optional)
    isNyp = hasNypText;
    badgeType = 'email';
  } else if (minPrice > 0) {
    // Strictly paid-only: requires payment, no email or free download option
    isPaid = true;
    badgeType = 'paid';
  } else {
    isFree = true;
    badgeType = 'free';
  }

  const cur = current?.currency || 'EUR';
  const curSymbol = cur === 'EUR' ? '€' : (cur === 'USD' ? '$' : (cur === 'GBP' ? '£' : cur));

  let priceFormatted = 'Paid';
  if (badgeType === 'own') {
    priceFormatted = 'Own';
  } else if (badgeType === 'free') {
    priceFormatted = 'Free';
  } else if (badgeType === 'email') {
    priceFormatted = minPrice > 0 ? `Email (${curSymbol}${minPrice})` : 'Email';
  } else if (badgeType === 'paid') {
    priceFormatted = minPrice > 0 ? `Paid (${curSymbol}${minPrice})` : 'Paid';
  }

  // Audio streams, durations, and lyrics
  const audioStreams: { trackNum: number; title: string; streamUrl?: string; url?: string; duration?: number; lyrics?: string }[] = [];
  if (tralbum?.trackinfo && Array.isArray(tralbum.trackinfo)) {
    tralbum.trackinfo.forEach((t: any, idx: number) => {
      const stream = t.file?.['mp3-128'];
      audioStreams.push({
        trackNum: t.track_num || idx + 1,
        title: cleanHtmlText(t.title) || `Track ${idx + 1}`,
        streamUrl: stream || undefined,
        url: stream || undefined,
        duration: t.duration ? Math.round(t.duration) : undefined,
        lyrics: t.lyrics ? String(t.lyrics).trim() : undefined,
      });
    });
  }

  // Artwork & extra packaging photos
  const artId = tralbum?.art_id;
  const artUrl = artId ? `https://f4.bcbits.com/img/a${artId}_10.jpg` : (item.artUrl || '');
  
  // Collect all high-res photos (excluding the main cover art)
  const popupImages = Array.from(subHtml.matchAll(/href="([^"]+a\d+_10\.jpg)"/gi)).map(m => m[1]);
  const imgMatches = Array.from(subHtml.matchAll(/src="([^"]+a\d+_10\.jpg)"/gi)).map(m => m[1]);
  const moreThumbs = Array.from(subHtml.matchAll(/data-original="([^"]+a\d+_10\.jpg)"/gi)).map(m => m[1]);
  const allImages = Array.from(new Set([...popupImages, ...imgMatches, ...moreThumbs])).filter(u => u !== artUrl);

  // Artist Bio Picture (for artist.jpg)
  const artistBioPicUrl = extractArtistBioPicUrl(subHtml, tralbum, globalArtistBioPicUrl);

  // Untruncated liner notes / about (checking current, tralbum root, trackinfo[0], and HTML)
  const aboutMatch = subHtml.match(/class="[^"]*tralbum-about[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                     subHtml.match(/class="[^"]*track_story[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const creditsMatch = subHtml.match(/class="[^"]*tralbum-credits[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const licenseMatch = subHtml.match(/<div[^>]*id="license"[^>]*>([\s\S]*?)<\/div>/i) ||
                       subHtml.match(/<div[^>]*class="[^"]*license[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const lyricsDivMatch = subHtml.match(/class="[^"]*lyricsText[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  // Track parent album title if single track
  const fromAlbumMatch = subHtml.match(/from\s+the\s+album\s*<a[^>]*>([^<]+)<\/a>/i) ||
                         subHtml.match(/class="[^"]*albumTitle[^"]*"[^>]*>([^<]+)</i);
  const fromAlbumTitle = tralbum?.album_title || tralbum?.current?.album_title || cleanHtmlText(fromAlbumMatch?.[1]);

  // For track releases, tralbum.trackinfo[0].about & credits are populated where current.about is null
  const firstTrackAbout = tralbum?.trackinfo?.[0]?.about ? cleanHtmlText(tralbum.trackinfo[0].about) : '';
  const firstTrackCredits = tralbum?.trackinfo?.[0]?.credits ? cleanHtmlText(tralbum.trackinfo[0].credits) : '';

  const aboutText = cleanHtmlText(current?.about) || cleanHtmlText(tralbum?.about) || firstTrackAbout || cleanHtmlText(aboutMatch?.[1]);
  const creditsText = cleanHtmlText(current?.credits) || cleanHtmlText(tralbum?.credits) || firstTrackCredits || cleanHtmlText(creditsMatch?.[1]);
  const licenseText = cleanHtmlText(licenseMatch?.[1]);
  const pageLyrics = cleanHtmlText(lyricsDivMatch?.[1]);

  let tagsMatches = (tralbum?.tags && Array.isArray(tralbum.tags) && tralbum.tags.length > 0)
    ? tralbum.tags
    : Array.from(subHtml.matchAll(/<a[^>]*class="tag"[^>]*>([^<]+)<\/a>/gi)).map(tm => cleanHtmlText(tm[1]));
  tagsMatches = Array.from(new Set(tagsMatches)).filter(Boolean);

  // Artist name detection
  const albumArtistMatch = subHtml.match(/class="albumTitle"[^>]*>[\s\S]*?<span[^>]*class="artist"[^>]*>[\s\S]*?by\s*<a[^>]*>([^<]+)<\/a>/i) ||
                           subHtml.match(/<h3 class="albumTitle"[^>]*>[\s\S]*?<span>by\s*<a[^>]*>([^<]+)<\/a>/i) ||
                           subHtml.match(/<h3 class="albumTitle"[^>]*>[\s\S]*?by\s*<span>\s*<a[^>]*>([^<]+)<\/a>/i) ||
                           subHtml.match(/by\s+<span itemprop="byArtist">[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);

  const artistElMatch = albumArtistMatch ||
                        subHtml.match(/#band-name-location[^>]*class="title"[^>]*>([^<]+)/i) ||
                        subHtml.match(/<span[^>]*class="title"[^>]*>([^<]+)<\/span>/i) ||
                        subHtml.match(/<span\s+class="artist"[^>]*>([^<]+)<\/span>/i) ||
                        subHtml.match(/property="og:site_name"[^>]*content="([^"]+)"/i);

  const artist = cleanHtmlText(
    current?.artist ||
    tralbum?.artist ||
    tralbum?.band?.name ||
    artistElMatch?.[1] ||
    fallbackArtist
  );

  // Format release date (from current, album_release_date, publish_date, or HTML)
  const dateMetaMatch = subHtml.match(/itemprop="datePublished"[^>]*content="([^"]+)"/i) ||
                        subHtml.match(/class="released"[^>]*>[\s\S]*?released\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i) ||
                        subHtml.match(/property="music:release_date"[^>]*content="([^"]+)"/i);

  const rawDate = current?.release_date || current?.publish_date || tralbum?.album_release_date || dateMetaMatch?.[1];
  const dotDate = formatDateToDotString(rawDate);
  let humanDate: string | undefined = undefined;
  if (rawDate) {
    try {
      const d = new Date(String(rawDate).replace(/released\s+/i, '').trim());
      if (!isNaN(d.getTime())) {
        humanDate = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      }
    } catch (e) {}
  }
  if (!humanDate && dotDate) {
    humanDate = dotDate;
  }

  const releaseTitle = cleanHtmlText(current?.title || item.title);

  // Tracklist formatting with accurate durations (MM:SS)
  const formatDuration = (sec?: number) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return ` (${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')})`;
  };

  const trackListFormatted = audioStreams.length > 0
    ? audioStreams.map(s => `${s.trackNum}. ${s.title}${formatDuration(s.duration)}`)
    : ['1. ' + releaseTitle];

  // Track lyrics
  const tracksWithLyrics = audioStreams.filter(s => s.lyrics && s.lyrics.trim().length > 0);
  let lyricsBlock = '';
  if (tracksWithLyrics.length > 0) {
    lyricsBlock = `================================================================================\nLYRICS\n================================================================================\n(Track lyrics are also saved as separate .lrc files inside info ZIP)\n\n` +
      tracksWithLyrics.map(t => `--- Track ${t.trackNum}: ${t.title} ---\n${t.lyrics}\n`).join('\n') + '\n';
  } else if (pageLyrics) {
    lyricsBlock = `================================================================================\nLYRICS\n================================================================================\n${pageLyrics}\n\n`;
  }

  // Build complete, untruncated info.txt
  const divider = '='.repeat(80);
  let infoText = `${divider}\n${releaseTitle.toUpperCase()} by ${artist}\n${divider}\n`;
  infoText += `Release Date : ${humanDate || 'Unknown'}${dotDate && humanDate !== dotDate ? ` (${dotDate})` : ''}\n`;
  infoText += `Type         : ${item.type.toUpperCase()}\n`;
  if (fromAlbumTitle) {
    infoText += `From Album   : ${fromAlbumTitle}\n`;
  }
  infoText += `Status       : ${priceFormatted}${isPaid ? ' (Paid release - Audio skipped unless purchased. Artwork, photos & info bundled)' : ''}\n`;
  infoText += `Bandcamp URL : ${item.url}\n`;
  infoText += `Artist Page  : ${origin}\n\n`;

  if (trackListFormatted.length > 0) {
    infoText += `${divider}\nTRACKLIST (${trackListFormatted.length} Track${trackListFormatted.length > 1 ? 's' : ''})\n${divider}\n${trackListFormatted.join('\n')}\n\n`;
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
    artistBioPicUrl,
    extraImages: allImages,
    allImages,
    humanDate,
    dotDate,
    isFree,
    isNyp,
    isPurchased,
    isPaid,
    badgeType,
    minPrice,
    priceFormatted,
    requireEmail,
    freeDlPage: freeDlPage || undefined,
    trackListFormatted,
    audioStreams,
    aboutText,
    creditsText,
    licenseText,
    tagsMatches,
    infoText,
    fromAlbumTitle,
  };
}

// Statdownload resolver: polls Bandcamp until the true studio FLAC/ZIP download URL is ready
export async function resolveBandcampDownload(
  downloadPageUrl: string,
  requestedFormat: string = 'flac'
): Promise<{
  success: boolean;
  downloadUrl?: string;
  format?: string;
  description?: string;
  sizeMb?: string;
  isArchive?: boolean;
  itemType?: 'album' | 'track';
  title?: string;
  artist?: string;
  error?: string;
}> {
  try {
    const dlRes = await fetch(downloadPageUrl, {
      headers: {
        ...BANDCAMP_FETCH_HEADERS,
        Referer: downloadPageUrl,
      },
    });

    if (!dlRes.ok) throw new Error(`Download page HTTP ${dlRes.status}`);

    const dlHtml = await dlRes.text();
    const blobMatch = dlHtml.match(/data-blob="([^"]+)"/);
    if (!blobMatch) throw new Error('No data-blob found on download page');

    const blob = JSON.parse(blobMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const digitalItem = blob?.digital_items?.[0];
    const downloads = digitalItem?.downloads;
    if (!downloads) throw new Error('No downloads object found in digital_items');

    const itemType = (digitalItem.item_type || digitalItem.type || 'album') as 'album' | 'track';
    const releaseTitle = cleanHtmlText(digitalItem.title);
    const releaseArtist = cleanHtmlText(digitalItem.artist);

    // Pick target format: strict preference for requested format
    const target =
      downloads[requestedFormat] ||
      downloads['flac'] ||
      downloads['mp3-320'] ||
      downloads['mp3-v0'] ||
      downloads['wav'] ||
      Object.values(downloads)[0];

    if (!target?.url) throw new Error('No target download URL available');

    // Helper to call statdownload
    async function callStat(urlToStat: string): Promise<any> {
      try {
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
            ...BANDCAMP_FETCH_HEADERS,
            Referer: downloadPageUrl,
          },
        });

        const text = await res.text();
        const jsonMatch = text.match(/Downloads\.statResult\s*\(\s*(\{[\s\S]*?\})\s*\)/);
        if (jsonMatch) return JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.warn('callStat error:', e);
      }
      return null;
    }

    let stat = await callStat(target.url);

    // Poll statdownload when Bandcamp is preparing archive ("busy") or following retry_url
    let attempts = 0;
    while (
      stat &&
      (stat.result === 'busy' || (!stat.download_url && stat.retry_url)) &&
      attempts < 25
    ) {
      attempts++;
      await new Promise(r => setTimeout(r, 1500));
      stat = await callStat(stat.retry_url || target.url);
      if (stat?.result === 'ok' && stat?.download_url) {
        break;
      }
    }

    const finalUrl = stat?.download_url;
    if (!finalUrl) {
      throw new Error(
        stat?.result === 'err'
          ? `Bandcamp error: ${stat.errortype || 'Download link preparation failed'}`
          : 'Archive preparation timed out on Bandcamp server. Please retry.'
      );
    }

    const isArchive =
      itemType === 'album' ||
      target.url.includes('/album?') ||
      target.url.includes('type=album') ||
      target.encoding_name === 'zip' ||
      finalUrl.includes('/album?') ||
      finalUrl.includes('.zip');

    return {
      success: true,
      downloadUrl: finalUrl,
      format: target.encoding_name || requestedFormat,
      description: target.description,
      sizeMb: target.size_mb,
      isArchive,
      itemType,
      title: releaseTitle,
      artist: releaseArtist,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
    };
  }
}

// File naming scheme parser supporting conditional brackets and title deduplication
export function formatFilenameBySchema(
  schema: string,
  meta: {
    artist?: string;
    album?: string;
    title?: string;
    trackNum?: number;
    totalTracks?: number;
    date?: string;
    year?: string;
    format?: string;
    type?: string;
    isArchive?: boolean;
  },
  options: { allowSubfolders?: boolean } = { allowSubfolders: false }
): string {
  const template = schema || '%artist% - %date% - %album%[%title%.%format%]';
  const isArchive = meta.isArchive || (meta.type === 'album' && meta.format === 'zip');
  const isSingleTrackRelease = meta.type === 'track' && (meta.album === meta.title || !meta.album || (meta.totalTracks || 1) <= 1);

  const clean = (s?: string) => {
    if (!s) return '';
    let res = s.replace(/[:*?"<>|\\/]/g, '_').trim();
    if (!options.allowSubfolders) {
      res = res.replace(/[\\/]/g, '_');
    }
    return res;
  };

  const total = meta.totalTracks || 1;
  const padLen = Math.max(2, String(total).length);
  const trackNumStr = (!isArchive && total > 1 && meta.trackNum != null)
    ? String(meta.trackNum).padStart(padLen, '0')
    : '';

  const rawDate = meta.date || meta.year || '2026.01.01';
  let dateStr = '2026.01.01';
  try {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    }
  } catch (e) {}

  const yearStr = dateStr.slice(0, 4);
  const defaultExt = isArchive ? 'zip' : (meta.format || 'flac').replace(/[^a-zA-Z0-9]/g, '');

  // Crucial: Omit track title for whole-album archives and single-track releases
  const titleVal = (isArchive || isSingleTrackRelease) ? '' : clean(meta.title || '');

  const values: Record<string, string> = {
    '%artist%': clean(meta.artist || 'Bandcamp'),
    '%album%': clean(meta.album || meta.title || 'Album'),
    '%title%': titleVal,
    '%track_num%': trackNumStr,
    '%date%': dateStr,
    '%year%': yearStr,
    '%format%': defaultExt,
    '%type%': clean(meta.type || 'album'),
  };

  // Evaluate conditional brackets: [content with %tokens%]
  const ESC_OPEN = '\uE000';
  const ESC_CLOSE = '\uE001';

  let str = template.replace(/\\\[/g, ESC_OPEN).replace(/\\\]/g, ESC_CLOSE);

  const bracketRegex = /\[([^\[\]]*)\]/;
  while (bracketRegex.test(str)) {
    str = str.replace(bracketRegex, (_, inner) => {
      const tokens = inner.match(/%[a-zA-Z0-9_]+%/g);
      if (!tokens || tokens.length === 0) return inner;
      const allValid = tokens.every((token: string) => {
        const val = values[token.toLowerCase()];
        return val != null && String(val).trim() !== '';
      });
      return allValid ? inner : '';
    });
  }

  str = str.replace(new RegExp(ESC_OPEN, 'g'), '[').replace(new RegExp(ESC_CLOSE, 'g'), ']');

  for (const [token, val] of Object.entries(values)) {
    str = str.replace(new RegExp(token, 'gi'), val);
  }

  // Remove any remaining stray brackets, multi-spaces, or trailing dashes
  let result = str
    .replace(/[\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*-\s*/g, ' - ')
    .replace(/\s*-\s*\./g, '.')
    .replace(/\.{2,}/g, '.')
    .trim();

  // Ensure valid extension
  if (!result.toLowerCase().endsWith('.' + defaultExt)) {
    result = `${result}.${defaultExt}`;
  }

  return result;
}

export function getCompanionInfoZipName(audioFilename: string): string {
  const lastDot = audioFilename.lastIndexOf('.');
  if (lastDot > 0) {
    const base = audioFilename.slice(0, lastDot);
    return `${base} (info).zip`;
  }
  return `${audioFilename} (info).zip`;
}
