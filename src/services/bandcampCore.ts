// Core Bandcamp Processing Engine (Unified Single Source of Truth for Server, Client, and Extension)
import { ExtraPhotoItem } from '../types/bandcamp';

export const BANDCAMP_FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

let _debugLoggingEnabled = false;
export function setDebugLogging(enabled: boolean): void {
  _debugLoggingEnabled = enabled;
}

export function isDebugLogging(): boolean {
  return _debugLoggingEnabled;
}

export function debugLog(module: string, ...args: any[]): void {
  if (_debugLoggingEnabled) {
    console.log(`[BandcampDL:${module}]`, ...args);
  }
}

export interface ParsedReleaseDetails {
  releaseTitle: string;
  artist: string;
  artUrl: string;
  artistBioPicUrl?: string;
  extraImages: string[];
  extraPhotos?: ExtraPhotoItem[];
  allImages: string[];
  humanDate?: string;
  dotDate?: string;
  isFree: boolean;
  isNyp: boolean;
  isPurchased: boolean;
  isPaid: boolean;
  isPreorder?: boolean;
  badgeType: 'own' | 'free' | 'email' | 'paid' | 'preorder';
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
  const bioPicId = tralbum?.band?.bio_pic_id || tralbum?.bio_pic_id || tralbum?.band_photo_id;
  if (bioPicId) {
    return `https://f4.bcbits.com/img/00${bioPicId}_10.jpg`;
  }

  // 2. HTML dedicated bio containers (#bio-container, .bio-pic, .band-photo)
  if (html) {
    const bioContainerMatch = html.match(/id="bio-container"[^>]*>([\s\S]*?)<\/div>/i);
    if (bioContainerMatch) {
      const imgInBio =
        bioContainerMatch[1].match(/(?:src|data-original)="([^"]+)"/i) ||
        bioContainerMatch[1].match(/https?:\/\/f4\.bcbits\.com\/img\/(?:00\d+|a\d+)_\d+\.jpg/i);
      if (imgInBio) {
        const raw = imgInBio[1] || imgInBio[0];
        return raw.replace(/_\d+\.jpg/, '_10.jpg');
      }
    }

    const bioPicMatch =
      html.match(/class="[^"]*bio-pic[^"]*"[^>]*src="([^"]+)"/i) ||
      html.match(/class="[^"]*band-photo[^"]*"[^>]*src="([^"]+)"/i) ||
      html.match(/<img[^>]*class="[^"]*(?:bio-pic|band-photo)[^"]*"[^>]*src="([^"]+)"/i);

    if (bioPicMatch?.[1]) {
      return bioPicMatch[1].replace(/_\d+\.jpg/, '_10.jpg');
    }
  }

  return globalBioUrl || undefined;
}

export function cleanBandcampUrl(input: string): string {
  if (!input) return '';
  let cleaned = input.trim();

  // If input contains a dashboard parameter like dashboard.html?url=...
  if (cleaned.includes('url=')) {
    const match = cleaned.match(/url=([^&]+)/);
    if (match) {
      try {
        cleaned = decodeURIComponent(match[1]);
      } catch (e) {
        cleaned = match[1];
      }
    }
  }

  // Attempt decode in case %3A%2F%2F is present
  try {
    if (cleaned.includes('%3A') || cleaned.includes('%2F') || cleaned.includes('%3a') || cleaned.includes('%2f')) {
      cleaned = decodeURIComponent(cleaned);
    }
  } catch (e) {}

  // Strip duplicate trailing /music repeats (e.g. /music/music -> /music)
  cleaned = cleaned.replace(/(\/music)+$/i, '/music');

  // Strip trailing slashes
  cleaned = cleaned.replace(/\/+$/, '');

  // If bare domain e.g. esoctrilihum.bandcamp.com
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned;
  }

  // If artist subdomain root (e.g. https://esoctrilihum.bandcamp.com), append /music
  try {
    const parsed = new URL(cleaned);
    if (parsed.hostname.endsWith('.bandcamp.com') && (parsed.pathname === '' || parsed.pathname === '/')) {
      cleaned = `${parsed.origin}/music`;
    }
  } catch (e) {}

  return cleaned;
}

export function extractImageNumericId(url?: string): string {
  if (!url) return '';
  const m = url.match(/[a0-9]*?(\d{6,})_/);
  return m ? m[1].replace(/^0+/, '') : '';
}

export function cleanPhotoSectionTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  let clean = cleanHtmlText(rawTitle);
  // Clear quotes and punctuation as requested: '"Arise" - Picture Vinyl' -> 'Arise - Picture Vinyl'
  clean = clean.replace(/["'“”‘’]/g, '');
  clean = clean.replace(/[:*?"<>|\\\/]/g, ' - ');
  clean = clean.replace(/\s*-\s*-\s*/g, ' - ');
  clean = clean.replace(/\s{2,}/g, ' ');
  clean = clean.replace(/^[\s\-_.]+/, '').replace(/[\s\-_.]+$/, '');
  return clean;
}

export function extractExtraPhotosWithTitles(
  html: string,
  artUrl?: string,
  artistBioPicUrl?: string
): { extraImages: string[]; extraPhotos: ExtraPhotoItem[] } {
  if (!html) return { extraImages: [], extraPhotos: [] };

  const coverId = extractImageNumericId(artUrl);
  const bioId = extractImageNumericId(artistBioPicUrl);

  const seenIds = new Set<string>();
  if (coverId) seenIds.add(coverId);
  if (bioId) seenIds.add(bioId);

  const excludedImageIds = new Set<string>();

  // 1. Completely exclude Full Discography sections (class "buyFullDiscography" or id "buyFullDiscography")
  const fullDiscoRegexes = [
    /<(?:li|div|section)[^>]*(?:id="buyFullDiscography"|class="[^"]*buyFullDiscography[^"]*")[^>]*>[\s\S]*?<\/(?:li|div|section)>/gi,
    /<li[^>]*class="[^"]*buyItem[^"]*"[^>]*>[\s\S]*?(?:full\s+digital\s+discography|buyFullDiscography)[\s\S]*?<\/li>/gi,
  ];

  for (const re of fullDiscoRegexes) {
    const matches = Array.from(html.matchAll(re));
    for (const m of matches) {
      const discoImgs = Array.from(m[0].matchAll(/bcbits\.com\/img\/(?:a\d+|00\d+)_\d+\.jpg/gi)).map((x) => x[0]);
      for (const di of discoImgs) {
        const id = extractImageNumericId(di);
        if (id) excludedImageIds.add(id);
      }
    }
  }

  // 2. Completely exclude "Supported by" / Collectors / Fans sections
  // Class IDs "collected-by collectors", "#collectors-token", ".collectors", etc.
  const collectorsRegexes = [
    /<(?:div|section)[^>]*(?:id="collectors-token"|class="[^"]*(?:collected-by|collectors|deper-fans|fans-wrapper|fans)[^"]*")[^>]*>[\s\S]*?<\/(?:div|section)>/gi,
    /<div[^>]*id="fans"[^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]*class="[^"]*collected-by[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]*class="[^"]*fan-avatar[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<a[^>]*class="[^"]*fan\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
  ];

  for (const re of collectorsRegexes) {
    const matches = Array.from(html.matchAll(re));
    for (const m of matches) {
      const fanImgs = Array.from(m[0].matchAll(/bcbits\.com\/img\/(?:a\d+|00\d+)_\d+\.jpg/gi)).map((x) => x[0]);
      for (const fi of fanImgs) {
        const id = extractImageNumericId(fi);
        if (id) excludedImageIds.add(id);
      }
    }
  }

  // Create a clean sanitized version of html without full discography or collectors
  let cleanHtml = html;
  for (const re of fullDiscoRegexes) {
    cleanHtml = cleanHtml.replace(re, '');
  }
  for (const re of collectorsRegexes) {
    cleanHtml = cleanHtml.replace(re, '');
  }

  const extraPhotos: ExtraPhotoItem[] = [];

  const addPhoto = (rawUrl: string, sectionTitle?: string) => {
    if (!rawUrl || typeof rawUrl !== 'string') return;
    const cleanUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    // Upgrade to _10.jpg
    const highResUrl = cleanUrl.replace(/_\d+\.jpg/, '_10.jpg');
    const id = extractImageNumericId(highResUrl);
    if (!id || seenIds.has(id) || excludedImageIds.has(id)) return;
    seenIds.add(id);

    const title = cleanPhotoSectionTitle(sectionTitle || '');
    extraPhotos.push({
      url: highResUrl,
      title: title || undefined,
    });
  };

  // Helper to accurately extract package title from buyItemPackageTitle primaryText
  const extractPackageTitle = (block: string): string => {
    // 1. Direct match on buyItemPackageTitle element (a, span, div, h3)
    const buyItemPkgMatch = block.match(/<[a-z0-9]+[^>]*class="[^"]*buyItemPackageTitle[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    if (buyItemPkgMatch) {
      const t = cleanPhotoSectionTitle(buyItemPkgMatch[1]);
      if (t) return t;
    }
    // 2. primaryText inside package
    const primaryTextMatch = block.match(/<[a-z0-9]+[^>]*class="[^"]*primaryText[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    if (primaryTextMatch) {
      const t = cleanPhotoSectionTitle(primaryTextMatch[1]);
      if (t && !/discography/i.test(t)) return t;
    }
    // 3. package-title or merch-item-title
    const pkgTitleMatch = block.match(/<[a-z0-9]+[^>]*class="[^"]*(?:package-title|merch-item-title)[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    if (pkgTitleMatch) {
      const t = cleanPhotoSectionTitle(pkgTitleMatch[1]);
      if (t) return t;
    }
    // 4. h3 or h4 heading in merch block
    const hMatch = block.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/i);
    if (hMatch) {
      const t = cleanPhotoSectionTitle(hMatch[1]);
      if (t && !/discography/i.test(t)) return t;
    }
    // 5. popupImage title attribute
    const popupMatch = block.match(/class="[^"]*popupImage[^"]*"[^>]*title="([^"]+)"/i) || block.match(/title="([^"]+)"[^>]*class="[^"]*popupImage[^"]*"/i);
    if (popupMatch) {
      const t = cleanPhotoSectionTitle(popupMatch[1]);
      if (t) return t;
    }
    return '';
  };

  // 1. Scan merch & physical packages
  const packageMatches = Array.from(
    cleanHtml.matchAll(/<li[^>]*class="[^"]*(?:package|merch-item|buyItem)[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)
  ).concat(
    Array.from(cleanHtml.matchAll(/<div[^>]*class="[^"]*(?:package|merch-item|buyItemPackage)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi))
  );

  for (const p of packageMatches) {
    const fullTag = p[0];
    const block = p[1];

    if (/buyFullDiscography|full\s+digital\s+discography/i.test(fullTag) || /buyFullDiscography|full\s+digital\s+discography/i.test(block)) {
      continue;
    }
    if (/collected-by|collectors|fans/i.test(fullTag)) {
      continue;
    }

    const packageTitle = extractPackageTitle(block);

    // Extract all image URLs in this package block
    const imgUrls = Array.from(
      block.matchAll(/(?:href|src|data-original)="([^"]*bcbits\.com\/img\/(?:a\d+|00\d+)_\d+\.jpg)"/gi)
    ).map((m) => m[1]);

    for (const u of imgUrls) {
      addPhoto(u, packageTitle);
    }
  }

  // 2. popupImage anchors across the cleaned page (excluding discography & fans)
  const popupAnchors = Array.from(
    cleanHtml.matchAll(/<a[^>]*class="[^"]*popupImage[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)
  );
  for (const pa of popupAnchors) {
    const fullAnchor = pa[0];
    if (/discography/i.test(fullAnchor)) continue;
    const href = pa[1];
    const inner = pa[2];
    const titleMatch = fullAnchor.match(/title="([^"]+)"/i) || inner.match(/alt="([^"]+)"/i);
    addPhoto(href, titleMatch ? titleMatch[1] : '');
  }

  // 3. More thumbs list (alternate packaging artwork)
  const moreThumbsMatch = cleanHtml.match(/<ul[^>]*class="[^"]*more-thumbs[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
  if (moreThumbsMatch) {
    const thumbBlocks = Array.from(moreThumbsMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi));
    for (const tb of thumbBlocks) {
      const uMatch = tb[1].match(/(?:href|src|data-original)="([^"]*bcbits\.com\/img\/(?:a\d+|00\d+)_\d+\.jpg)"/i);
      const tMatch = tb[1].match(/(?:title|alt)="([^"]+)"/i);
      if (uMatch) {
        addPhoto(uMatch[1], tMatch ? tMatch[1] : '');
      }
    }
  }

  return {
    extraImages: extraPhotos.map((p) => p.url),
    extraPhotos,
  };
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
  const isSetPrice = Boolean(current?.is_set_price);
  const hasFreeButton = /free\s+download/i.test(subHtml);
  const hasNypText = /name\s+your\s+price/i.test(subHtml) || /buyItemNyp/i.test(subHtml) || (minPrice === 0 && current?.download_pref === 2);
  const requireEmailFlag = Boolean(current?.require_email === 1 || current?.require_email_0 === 1 || (current?.require_email && !isSetPrice));
  const isNypEligible = !isSetPrice && (hasNypText || hasFreeButton || current?.require_email_0 === 1);

  // If Name Your Price is present without a direct "free download" button, Bandcamp requires an email address for $0 checkout
  const isEmailWalled = Boolean(
    requireEmailFlag ||
    current?.require_email_0 === 1 ||
    (!isSetPrice && hasNypText && !hasFreeButton)
  );

  // freeDownloadPage is ONLY a direct download link if the release is NOT email-walled and has a direct free download button without email required
  const rawFreeDlPage = tralbum?.freeDownloadPage || null;
  const freeDlPage = (!isEmailWalled && hasFreeButton && current?.require_email_0 !== 1) ? rawFreeDlPage : null;
  const requireEmail = isEmailWalled;

  // Check for pre-order status
  let isFutureDate = false;
  if (current?.release_date) {
    try {
      const rd = new Date(current.release_date);
      if (!isNaN(rd.getTime()) && rd.getTime() > Date.now()) {
        isFutureDate = true;
      }
    } catch (e) {}
  }

  const isPreorder = Boolean(
    current?.is_preorder ||
    tralbum?.is_preorder ||
    tralbum?.album_is_preorder ||
    current?.preorder ||
    /class="[^"]*pre-?order[^"]*"/i.test(subHtml) ||
    /buyItem[^"]*pre-?order/i.test(subHtml) ||
    /pre-?order\s+(?:digital|now|track|album)/i.test(subHtml) ||
    /<button[^>]*class="[^"]*buy-link[^"]*"[^>]*>\s*pre-?order/i.test(subHtml) ||
    /<span[^>]*class="[^"]*buyItemDigital[^"]*"[^>]*>[\s\S]*?pre-?order/i.test(subHtml) ||
    /<h\d[^>]*class="[^"]*compound-button[^"]*"[^>]*>[\s\S]*?pre-?order/i.test(subHtml) ||
    (isFutureDate && /pre-?order/i.test(subHtml))
  );

  let isFree = false;
  let isNyp = false;
  let isPaid = false;
  let badgeType: 'own' | 'free' | 'email' | 'paid' | 'preorder' = 'free';

  if (isPurchased) {
    isFree = true;
    badgeType = 'own';
  } else if (isPreorder) {
    // Pre-order release: audio master is not yet available prior to official release date
    badgeType = 'preorder';
    isPaid = true;
    isFree = false;
    isNyp = false;
  } else if (isEmailWalled) {
    // Free download via email / Name Your Price email gate
    isNyp = true;
    isFree = true;
    isPaid = false;
    badgeType = 'email';
  } else if (Boolean(freeDlPage)) {
    isFree = true;
    badgeType = 'free';
  } else if (isSetPrice || (!hasFreeButton && !hasNypText && current?.require_email_0 !== 1 && minPrice > 0)) {
    // Strictly paid-only: requires payment, no email or free download option
    isPaid = true;
    isFree = false;
    isNyp = false;
    badgeType = 'paid';
  } else if (hasFreeButton || (minPrice === 0 && current?.download_pref === 1)) {
    // Direct free download without email
    isFree = true;
    badgeType = 'free';
  } else if (isNypEligible) {
    // Free download via Name Your Price
    isNyp = true;
    badgeType = 'email';
  } else if (minPrice > 0) {
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
  } else if (badgeType === 'preorder') {
    priceFormatted = minPrice > 0 ? `Pre-order (${curSymbol}${minPrice})` : 'Pre-order';
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

  // Artwork & artist bio picture
  const artId = tralbum?.art_id;
  const artUrl = artId ? `https://f4.bcbits.com/img/a${artId}_10.jpg` : (item.artUrl || '');
  const artistBioPicUrl = extractArtistBioPicUrl(subHtml, tralbum, globalArtistBioPicUrl);

  // Extract extra packaging photos with guessed section titles (excluding cover & artist bio duplicates)
  const { extraImages, extraPhotos } = extractExtraPhotosWithTitles(subHtml, artUrl, artistBioPicUrl);
  const allImages = extraImages;

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
  let statusDetail = priceFormatted;
  if (badgeType === 'preorder') {
    statusDetail += ' (Pre-order - Audio master is not yet available prior to official release date. Artwork, photos & info bundled)';
  } else if (isPaid) {
    statusDetail += ' (Paid release - Audio skipped unless purchased. Artwork, photos & info bundled)';
  }
  infoText += `Status       : ${statusDetail}\n`;
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
    extraImages,
    extraPhotos,
    allImages,
    humanDate,
    dotDate,
    isFree,
    isNyp,
    isPurchased,
    isPaid,
    isPreorder,
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
    if (!downloadPageUrl || typeof downloadPageUrl !== 'string' || !downloadPageUrl.trim()) {
      return {
        success: false,
        error: 'Valid download page URL is required',
      };
    }
    const cleanUrl = downloadPageUrl.replace(/&amp;/g, '&').trim();
    if (!cleanUrl.startsWith('http')) {
      return {
        success: false,
        error: 'Invalid download page URL protocol',
      };
    }

    // Direct check: If cleanUrl is already a direct bcbits/popplers CDN download URL
    if (cleanUrl.includes('bcbits.com/download/') || cleanUrl.includes('popplers')) {
      debugLog('resolver', 'cleanUrl is already a direct bcbits download URL:', cleanUrl);
      return {
        success: true,
        downloadUrl: cleanUrl,
        format: requestedFormat,
        isArchive: cleanUrl.includes('/album/'),
        itemType: cleanUrl.includes('/album/') ? 'album' : 'track',
      };
    }

    debugLog('resolver', 'Fetching Bandcamp download page:', cleanUrl);
    const dlRes = await fetch(cleanUrl, {
      headers: {
        ...BANDCAMP_FETCH_HEADERS,
        Referer: cleanUrl,
      },
    });

    if (!dlRes.ok) throw new Error(`Download page HTTP ${dlRes.status}`);

    // Capture session cookies to pass along to statdownload / popplers CDN
    let cookieHeader = '';
    if (typeof (dlRes.headers as any).getSetCookie === 'function') {
      const cookies = (dlRes.headers as any).getSetCookie();
      if (Array.isArray(cookies) && cookies.length > 0) {
        cookieHeader = cookies.map((c: string) => c.split(';')[0]).join('; ');
      }
    } else {
      const sc = dlRes.headers.get('set-cookie');
      if (sc) cookieHeader = sc.split(';')[0];
    }

    const dlHtml = await dlRes.text();

    // Fastly / Cloudflare Bot Challenge Check
    if (dlHtml.includes('<title>Client Challenge</title>') || dlHtml.includes('_fs-ch-')) {
      debugLog('resolver', 'Bandcamp Cloudflare Bot Challenge triggered on server IP.');
      return {
        success: false,
        error: 'Bandcamp Cloudflare Bot Challenge active on datacenter IP. Please use the Chrome Extension to download this email-walled release directly via your local browser session.',
      };
    }

    // Direct Extraction: Match any direct https://p*.bcbits.com/download/(album|track)/... links in HTML
    const bcbitsMatches = Array.from(
      dlHtml.matchAll(/https?:\/\/[a-z0-9.]*bcbits\.com\/download\/(?:album|track)\/[^\s"'<>]+/gi)
    ).map(m => m[0].replace(/&amp;/g, '&'));

    let directFormatUrl = '';
    if (bcbitsMatches.length > 0) {
      debugLog('resolver', `Found ${bcbitsMatches.length} direct bcbits download link(s) in HTML:`, bcbitsMatches);
      const matchForFormat = bcbitsMatches.find(u => u.toLowerCase().includes(`/${requestedFormat.toLowerCase()}/`)) ||
                             bcbitsMatches.find(u => u.toLowerCase().includes(requestedFormat.toLowerCase())) ||
                             bcbitsMatches.find(u => u.toLowerCase().includes('/flac/')) ||
                             bcbitsMatches.find(u => u.toLowerCase().includes('/mp3-320/')) ||
                             bcbitsMatches[0];
      if (matchForFormat) {
        directFormatUrl = matchForFormat;
      }
    }

    // Tolerant Data-Blob Extraction
    let blob: any = null;
    const blobRegexes = [
      /data-blob=["']([\s\S]*?)["']\s*(?:>|class|id)/i,
      /id=["']pagedata["'][^>]*data-blob=["']([\s\S]*?)["']/i,
      /<div[^>]*data-blob=["']([\s\S]*?)["']/i,
      /data-blob="([^"]+)"/i,
      /data-blob='([^']+)'/i,
      /var\s+pagedata\s*=\s*(\{[\s\S]*?\})\s*;/i,
      /window\.pagedata\s*=\s*(\{[\s\S]*?\})\s*;/i,
    ];

    for (const rx of blobRegexes) {
      const m = dlHtml.match(rx);
      if (m && m[1]) {
        try {
          const decoded = m[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          blob = JSON.parse(decoded);
          if (blob && (blob.digital_items || blob.downloads)) break;
        } catch (e) {}
      }
    }

    if (!blob) {
      const diMatch = dlHtml.match(/\{[\s\S]*?"digital_items"\s*:\s*\[[\s\S]*?\}\s*;/);
      if (diMatch) {
        try {
          blob = JSON.parse(diMatch[0].replace(/;\s*$/, ''));
        } catch (e) {}
      }
    }

    const digitalItem = blob?.digital_items?.[0] || blob;
    const downloads = digitalItem?.downloads;

    // If no blob but we have a direct bcbits link in the HTML, return it!
    if (!downloads && directFormatUrl) {
      debugLog('resolver', 'Resolved via direct HTML bcbits link:', directFormatUrl);
      const titleFromHtml = cleanHtmlText(dlHtml.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\|\s*Bandcamp/i, ''));
      return {
        success: true,
        downloadUrl: directFormatUrl,
        format: requestedFormat,
        description: requestedFormat.toUpperCase(),
        isArchive: directFormatUrl.includes('/album/'),
        itemType: directFormatUrl.includes('/album/') ? 'album' : 'track',
        title: titleFromHtml || 'Album',
        artist: 'Artist',
      };
    }

    if (!downloads) {
      throw new Error('No download links or data-blob found on download page. Please verify that the download link is active.');
    }

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

    if (!target?.url) {
      if (directFormatUrl) {
        return {
          success: true,
          downloadUrl: directFormatUrl,
          format: requestedFormat,
          description: requestedFormat.toUpperCase(),
          isArchive: directFormatUrl.includes('/album/'),
          itemType,
          title: releaseTitle,
          artist: releaseArtist,
        };
      }
      throw new Error('No target download URL available');
    }

    let finalUrl = '';

    // Direct check: Bandcamp single tracks and prepared archives often return immediate HTTP 302 redirect or direct 200 zip stream
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const directCheck = await fetch(target.url, {
        method: 'GET',
        headers: {
          ...BANDCAMP_FETCH_HEADERS,
          Referer: cleanUrl,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        redirect: 'manual',
        signal: controller ? controller.signal : undefined,
      });

      const contentType = (directCheck.headers.get('content-type') || '').toLowerCase();
      if ([301, 302, 303, 307, 308].includes(directCheck.status)) {
        const loc = directCheck.headers.get('location');
        if (loc) {
          finalUrl = loc.startsWith('http') ? loc : (loc.startsWith('//') ? `https:${loc}` : `https://${loc}`);
        }
      } else if (directCheck.status === 200 && (
        contentType.includes('application/zip') ||
        contentType.includes('application/octet-stream') ||
        contentType.includes('audio/')
      )) {
        finalUrl = target.url;
      }
      if (controller) {
        controller.abort(); // Immediately release socket so we do not stream the 500MB zip into memory during resolution!
      }
    } catch (e) {
      // Aborting throws AbortError which is expected
    }

    // Helper to call statdownload
    async function callStat(urlToStat: string): Promise<any> {
      try {
        if (!urlToStat) return null;
        const fullUrl = urlToStat.startsWith('//') ? `https:${urlToStat}` : (urlToStat.startsWith('http') ? urlToStat : `https://${urlToStat}`);
        const parsed = new URL(fullUrl);
        parsed.pathname = parsed.pathname.replace('/download/', '/statdownload/');
        parsed.searchParams.set('.rand', String(Math.floor(Math.random() * 1000000)));
        parsed.searchParams.set('.vrs', '1');
        const statUrl = parsed.toString();

        const res = await fetch(statUrl, {
          method: 'GET',
          headers: {
            ...BANDCAMP_FETCH_HEADERS,
            Referer: cleanUrl,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
        });

        if (!res.ok) return null;
        const text = await res.text();
        const jsonMatch = text.match(/Downloads\.statResult\s*\(\s*(\{[\s\S]*?\})\s*\)/);
        if (jsonMatch) return JSON.parse(jsonMatch[1]);
        try {
          return JSON.parse(text);
        } catch (pe) {}
      } catch (e) {
        console.warn('callStat error:', e);
      }
      return null;
    }

    if (!finalUrl) {
      let attempts = 0;
      const maxAttempts = 45; // 45 attempts * 2s = ~90s max waiting for Bandcamp to prepare audio
      let nextStatUrl = target.url;
      let lastStat: any = null;

      while (attempts < maxAttempts) {
        attempts++;
        const stat = await callStat(nextStatUrl);
        if (stat) {
          lastStat = stat;
          if (stat.result === 'ok' && stat.download_url) {
            debugLog('resolver', `Statdownload ready on attempt ${attempts}:`, stat.download_url);
            finalUrl = stat.download_url.startsWith('http') ? stat.download_url : (stat.download_url.startsWith('//') ? `https:${stat.download_url}` : `https://${stat.download_url}`);
            break;
          }
          if (stat.result === 'err') {
            debugLog('resolver', `Statdownload error on attempt ${attempts}:`, stat);
            break;
          }
          if (stat.result === 'busy') {
            debugLog('resolver', `Statdownload busy (attempt ${attempts}/${maxAttempts}), waiting 2s...`);
          }
          if (stat.retry_url) {
            nextStatUrl = stat.retry_url.startsWith('http') ? stat.retry_url : (stat.retry_url.startsWith('//') ? `https:${stat.retry_url}` : `https://${stat.retry_url}`);
          }
        }
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!finalUrl && lastStat?.download_url) {
        finalUrl = lastStat.download_url;
      }
    }

    // Final attempt if still no URL: check target.url redirect once more or use directFormatUrl
    if (!finalUrl && directFormatUrl) {
      finalUrl = directFormatUrl;
    }

    if (!finalUrl) {
      try {
        const retryCheck = await fetch(target.url, {
          method: 'GET',
          headers: {
            ...BANDCAMP_FETCH_HEADERS,
            Referer: cleanUrl,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
          redirect: 'manual',
        });
        if ([301, 302, 303, 307, 308].includes(retryCheck.status)) {
          const loc = retryCheck.headers.get('location');
          if (loc) finalUrl = loc;
        }
      } catch (e) {}
    }

    if (!finalUrl) {
      throw new Error(
        'Archive preparation timed out on Bandcamp server. Please retry.'
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

export interface DiscoveredCatalogItem {
  id: string;
  itemId: number;
  url: string;
  title: string;
  artUrl: string;
  artist?: string;
  type: 'album' | 'track';
}

export interface DiscoveredCatalogResult {
  artistName: string;
  origin: string;
  artistBioPicUrl?: string;
  items: DiscoveredCatalogItem[];
}

/**
 * Universal Bandcamp Catalog Scanner
 * Robustly parses Bandcamp artist & label discography pages:
 * 1. Initial 16 static HTML <li> items inside ol#music-grid (regardless of whether data-item-id is on the li,
 *    supporting relative or absolute URLs, label artist overrides, and lazy-loaded artwork).
 * 2. Featured releases (e.g. #featured-item).
 * 3. Additional items beyond the initial 16 from data-client-items JSON attribute.
 * 4. Fallback link sweep if layout is unconventional.
 */
export function discoverCatalogItemsFromHtml(html: string, targetUrl: string): DiscoveredCatalogResult {
  const parsedUrl = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
  const origin = parsedUrl.origin;

  const artistName =
    cleanHtmlText(html.match(/#band-name-location[^>]*class="title"[^>]*>([^<]+)/i)?.[1]) ||
    cleanHtmlText(html.match(/<span[^>]*class="title"[^>]*>([^<]+)<\/span>/i)?.[1]) ||
    cleanHtmlText(html.match(/property="og:site_name"[^>]*content="([^"]+)"/i)?.[1]) ||
    cleanHtmlText(html.match(/<title>([^|<]+)/i)?.[1]) ||
    parsedUrl.hostname.split('.')[0];

  const artistBioPicUrl = extractArtistBioPicUrl(html);
  const itemsMap = new Map<string, DiscoveredCatalogItem>();

  const addItem = (
    rawHref: string | undefined,
    rawId: string | undefined,
    rawTitle: string | undefined,
    rawArtUrl: string | undefined,
    itemArtist: string | undefined
  ) => {
    if (!rawHref) return;
    let pathname = '';
    let fullUrl = '';
    try {
      const u = new URL(rawHref, origin);
      pathname = u.pathname;
      fullUrl = u.href;
    } catch {
      return;
    }

    const isAlbum = pathname.startsWith('/album/');
    const isTrack = pathname.startsWith('/track/');
    if (!isAlbum && !isTrack) return;

    // Deduplicate by clean pathname (lowercased without trailing slash)
    const normKey = pathname.replace(/\/+$/, '').toLowerCase();
    if (itemsMap.has(normKey)) return;

    const id = rawId && rawId.trim()
      ? rawId.trim()
      : `${isAlbum ? 'album' : 'track'}-${normKey.replace(/^\/(?:album|track)\//, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    const numId = parseInt(id.replace(/\D/g, '') || '0', 10);
    const cleanTitle = cleanHtmlText(rawTitle) || 'Release';
    const cleanArt = (rawArtUrl || '').replace(/_\d+\.jpg/, '_10.jpg');

    itemsMap.set(normKey, {
      id,
      itemId: numId,
      url: fullUrl,
      title: cleanTitle,
      artUrl: cleanArt,
      artist: cleanHtmlText(itemArtist || artistName),
      type: isAlbum ? 'album' : 'track',
    });
  };

  // 1. Single release detection (when current page is an album or track)
  const tralbum = typeof extractBandcampTralbum === 'function' ? extractBandcampTralbum(html) : null;
  if (tralbum && tralbum.current) {
    const isAlbum = tralbum.current.type === 'album' || parsedUrl.pathname.startsWith('/album/');
    const releaseTitle = cleanHtmlText(tralbum.current.title) || 'Release';
    const artUrl = tralbum.art_id ? `https://f4.bcbits.com/img/a${tralbum.art_id}_10.jpg` : '';
    const rawId = `${tralbum.current.type || (isAlbum ? 'album' : 'track')}-${tralbum.current.id}`;
    addItem(parsedUrl.pathname || '/', rawId, releaseTitle, artUrl, artistName);
  }

  // 2. Featured item on music page
  const featuredMatch = html.match(/<(?:div|li)[^>]*id=["']featured-item["'][^>]*>([\s\S]*?)<\/(?:div|li)>/i) ||
                        html.match(/<(?:div|li)[^>]*class=["'][^"']*featured-item[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li)>/i);
  if (featuredMatch) {
    const fContent = featuredMatch[1];
    const linkMatch = fContent.match(/href=["']([^"']*(?:\/album\/|\/track\/)[^"']*)["']/i);
    if (linkMatch) {
      const idMatch = featuredMatch[0].match(/data-item-id=["']([^"']+)["']/i) || fContent.match(/data-item-id=["']([^"']+)["']/i);
      const titleMatch = fContent.match(/<[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
      const imgMatch = fContent.match(/<img[^>]*>/i);
      const artMatch = imgMatch ? (imgMatch[0].match(/data-original=["']([^"']+)["']/i) || imgMatch[0].match(/src=["']([^"']+)["']/i)) : null;
      addItem(linkMatch[1], idMatch?.[1], titleMatch?.[1], artMatch?.[1], artistName);
    }
  }

  // 3. Grid items extraction from ol#music-grid or across HTML
  const gridMatch = html.match(/<ol[^>]*id=["']music-grid["'][^>]*>([\s\S]*?)<\/ol>/i);
  const searchHtml = gridMatch ? gridMatch[1] : html;

  // Extract all <li> blocks from the grid container and any li.music-grid-item
  const liMatches = [
    ...Array.from(searchHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)),
    ...(gridMatch ? [] : Array.from(html.matchAll(/<li[^>]*class=["'][^"']*music-grid-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi))),
  ];

  for (const m of liMatches) {
    const fullLiTag = m[0];
    const content = m[1];

    // Find the release link (matches /album/ or /track/ in relative or absolute URL)
    const linkMatch = content.match(/href=["']([^"']*(?:\/album\/|\/track\/)[^"']*)["']/i);
    if (!linkMatch) continue;

    const rawHref = linkMatch[1];
    const idMatch = fullLiTag.match(/data-item-id=["']([^"']+)["']/i) || content.match(/data-item-id=["']([^"']+)["']/i);
    const rawId = idMatch ? idMatch[1] : undefined;

    // Extract Title & Artist (supporting label pages where band name is in artist-override or artist span)
    const titleElMatch = content.match(/<p[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
                         content.match(/<[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    let titleStr = '';
    let itemArtistStr = '';
    if (titleElMatch) {
      const fullTitleHtml = titleElMatch[1];
      const artistSubMatch = fullTitleHtml.match(/<span[^>]*class=["'](?:artist-override|artist)["'][^>]*>([^<]+)<\/span>/i) ||
                             content.match(/<span[^>]*class=["'](?:artist-override|artist)["'][^>]*>([^<]+)<\/span>/i);
      if (artistSubMatch) {
        itemArtistStr = artistSubMatch[1].trim();
      }
      titleStr = fullTitleHtml
        .replace(/<span[^>]*class=["'](?:artist-override|artist)["'][^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .trim();
    }

    if (!titleStr) {
      const imgAltMatch = content.match(/<img[^>]*alt=["']([^"']+)["']/i);
      if (imgAltMatch && imgAltMatch[1].trim()) {
        titleStr = imgAltMatch[1].trim();
      }
    }

    // Extract Artwork URL: check data-original first (lazy load), then src (skip blank.gif)
    const imgMatch = content.match(/<img[^>]*>/i);
    let artUrlStr = '';
    if (imgMatch) {
      const tag = imgMatch[0];
      const origMatch = tag.match(/data-original=["']([^"']+)["']/i);
      const srcMatch = tag.match(/src=["']([^"']+)["']/i);
      const chosen = (origMatch && origMatch[1]) || (srcMatch && !srcMatch[1].includes('blank.gif') && srcMatch[1]) || '';
      artUrlStr = chosen.replace(/_\d+\.jpg/, '_10.jpg');
    }

    addItem(rawHref, rawId, titleStr, artUrlStr, itemArtistStr);
  }

  // 4. Remaining items from data-client-items attribute on ol#music-grid
  const clientMatch = html.match(/data-client-items=["']([\s\S]*?)["'](?=[\s>]|data-)/i) ||
                      html.match(/data-client-items="([^"]+)"/i);
  if (clientMatch) {
    try {
      const raw = clientMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      const clientItems: any[] = JSON.parse(raw);
      if (Array.isArray(clientItems)) {
        for (const item of clientItems) {
          if (!item.page_url) continue;
          const artUrl = item.art_id ? `https://f4.bcbits.com/img/a${item.art_id}_10.jpg` : '';
          const rawId = `${item.type || 'album'}-${item.id}`;
          const itemArtist = item.band_name || item.artist_name || item.artist || artistName;
          addItem(item.page_url, rawId, item.title, artUrl, itemArtist);
        }
      }
    } catch (e) {
      debugLog('scanner', 'Failed parsing data-client-items:', e);
    }
  }

  // 5. Ultimate Fallback: If 0 items were found, sweep all release links on the page
  if (itemsMap.size === 0) {
    const allLinks = Array.from(html.matchAll(/<a[^>]*href=["']([^"']*(?:\/album\/|\/track\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi));
    for (const lMatch of allLinks) {
      const rawHref = lMatch[1];
      const linkBody = lMatch[2];
      const textTitle = cleanHtmlText(linkBody.replace(/<[^>]+>/g, ''));
      addItem(rawHref, undefined, textTitle || 'Release', undefined, artistName);
    }
  }

  return {
    artistName,
    origin,
    artistBioPicUrl,
    items: Array.from(itemsMap.values()),
  };
}
