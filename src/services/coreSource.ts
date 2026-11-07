// Pure string embedding of core.js for Chrome extension bundling
// This avoids '?raw' module resolution issues in esbuild node bundles
export const CORE_JS_SOURCE = `// Bandcamp Bulk Downloader - Unified Core Engine
// Shared by Standalone Node Server, React Client App, and Chrome Extension

/**
 * Strips HTML tags, decodes common HTML entities (including umlauts/accents), and trims text.
 */
function cleanHtmlText(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>/gi, '')
    .replace(/<style\\b[^<]*(?:(?!<\\/style>)<[^<]*)*<\\/style>/gi, '')
    .replace(/<br\\s*\\/?>/gi, '\\n')
    .replace(/<\\/p>/gi, '\\n\\n')
    .replace(/<\\/div>/gi, '\\n')
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
    .replace(/&icirc;/g, 'î')
    .replace(/&Icirc;/g, 'Î')
    .replace(/&eacute;/g, 'é')
    .replace(/&Eacute;/g, 'É')
    .replace(/&egrave;/g, 'è')
    .replace(/&Egrave;/g, 'È')
    .replace(/&ccedil;/g, 'ç')
    .replace(/&Ccedil;/g, 'Ç')
    .replace(/&#(\\d+);/g, function(_, dec) { return String.fromCharCode(parseInt(dec, 10)); })
    .replace(/\\r\\n/g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();
}

/**
 * Normalizes any date string (ISO, "released 16 Jun 2025", or timestamp) into "YYYY.MM.DD".
 */
function formatDateToDotString(raw) {
  if (!raw) return '';
  try {
    var clean = String(raw).replace(/released\\s+/i, '').trim();
    var d = new Date(clean);
    if (!isNaN(d.getTime())) {
      var yyyy = d.getFullYear();
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      return yyyy + '.' + mm + '.' + dd;
    }
  } catch (e) {}

  var match = String(raw).match(/(\\d{4})[.-](\\d{1,2})[.-](\\d{1,2})/);
  if (match) {
    return match[1] + '.' + match[2].padStart(2, '0') + '.' + match[3].padStart(2, '0');
  }
  return '';
}

/**
 * Robustly extracts the Bandcamp TralbumData object from page HTML.
 */
function extractBandcampTralbum(html) {
  if (!html) return null;
  try {
    var tralbumDataMatch = html.match(/data-tralbum="([^"]+)"/);
    if (tralbumDataMatch) {
      var decoded = tralbumDataMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      return JSON.parse(decoded);
    }

    var tralbumVarMatch = html.match(/var\\s+TralbumData\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;/);
    if (tralbumVarMatch) {
      try {
        return JSON.parse(tralbumVarMatch[1]);
      } catch (e) {
        var fn = new Function('return (' + tralbumVarMatch[1] + ');');
        return fn();
      }
    }

    var ldJsonMatch = html.match(/<script[^>]*type="application\\/ld\\+json"[^>]*>([\\s\\S]*?)<\\/script>/i);
    if (ldJsonMatch) {
      var parsedLd = JSON.parse(ldJsonMatch[1]);
      if (parsedLd) {
        return {
          current: {
            title: parsedLd.name,
            release_date: parsedLd.datePublished || parsedLd.dateModified,
            about: parsedLd.description,
          },
          artist: parsedLd.byArtist ? parsedLd.byArtist.name : undefined,
        };
      }
    }
  } catch (err) {
    console.warn('Error extracting TralbumData:', err);
  }
  return null;
}

/**
 * Extracts the maximum resolution artist bio picture URL (Bandcamp CDN 00..._10.jpg).
 */
function extractArtistBioPicUrl(html, tralbum, globalBioUrl) {
  if (!html && !tralbum) return globalBioUrl;

  var bioPicId = (tralbum && tralbum.band && tralbum.band.bio_pic_id) || (tralbum && tralbum.bio_pic_id);
  if (bioPicId) {
    return 'https://f4.bcbits.com/img/00' + bioPicId + '_10.jpg';
  }

  if (html) {
    var cdnBioMatch = html.match(/https?:\\/\\/f4\\.bcbits\\.com\\/img\\/00(\\d+)_/i);
    if (cdnBioMatch) {
      return 'https://f4.bcbits.com/img/00' + cdnBioMatch[1] + '_10.jpg';
    }

    var bioPicMatch =
      html.match(/class="[^"]*bio-pic[^"]*"[^>]*src="([^"]+)"/i) ||
      html.match(/id="bio-container"[^>]*>[\\s\\S]*?<img[^>]*src="([^"]+)"/i) ||
      html.match(/class="[^"]*band-photo[^"]*"[^>]*src="([^"]+)"/i) ||
      html.match(/<img[^>]*class="[^"]*photo[^"]*"[^>]*src="([^"]+)"/i);

    if (bioPicMatch && bioPicMatch[1]) {
      return bioPicMatch[1].replace(/_\\d+\\.jpg/, '_10.jpg');
    }
  }

  return globalBioUrl || undefined;
}

/**
 * Comprehensive release parser extracting untruncated liner notes, credits, tracklist with durations, tags, lyrics, and photos.
 */
function parseReleasePageData(subHtml, tralbum, item, origin, fallbackArtist, globalArtistBioPicUrl) {
  var current = tralbum ? tralbum.current : null;
  var isPurchased = Boolean(
    (tralbum && (tralbum.is_purchased || tralbum.has_purchased || tralbum.you_own_it)) ||
    /you\\s+own\\s+this|you\\s+own\\s+it|class="[^"]*you-own-this/i.test(subHtml)
  );

  var minPrice = (current && current.minimum_price != null) ? current.minimum_price : 0;
  var freeDlPage = (tralbum && tralbum.freeDownloadPage) ? tralbum.freeDownloadPage : null;
  var hasFreeButton = /free\\s+download/i.test(subHtml) || (minPrice === 0 && current && current.download_pref === 1);
  var hasNypText = /name\\s+your\\s+price/i.test(subHtml) || (current && current.download_pref === 2);
  var requireEmail = Boolean(current && (current.require_email || current.require_email_0));

  var isFree = false;
  var isNyp = false;
  var isPaid = false;
  var badgeType = 'free';

  if (isPurchased) {
    isFree = true;
    badgeType = 'own';
  } else if (Boolean(freeDlPage) || (minPrice === 0 && current && current.download_pref === 1 && !requireEmail) || (hasFreeButton && !requireEmail)) {
    isFree = true;
    badgeType = 'free';
  } else if (requireEmail || hasNypText) {
    isNyp = Boolean(hasNypText);
    badgeType = 'email';
  } else if (minPrice > 0) {
    isPaid = true;
    badgeType = 'paid';
  } else {
    isFree = true;
    badgeType = 'free';
  }

  var cur = (current && current.currency) || 'EUR';
  var curSymbol = cur === 'EUR' ? '€' : (cur === 'USD' ? '$' : (cur === 'GBP' ? '£' : cur));

  var priceFormatted = 'Paid';
  if (badgeType === 'own') {
    priceFormatted = 'Own';
  } else if (badgeType === 'free') {
    priceFormatted = 'Free';
  } else if (badgeType === 'email') {
    priceFormatted = minPrice > 0 ? ('Email (' + curSymbol + minPrice + ')') : 'Email';
  } else if (badgeType === 'paid') {
    priceFormatted = minPrice > 0 ? ('Paid (' + curSymbol + minPrice + ')') : 'Paid';
  }

  // Audio streams, durations, and lyrics
  var audioStreams = [];
  if (tralbum && tralbum.trackinfo && Array.isArray(tralbum.trackinfo)) {
    tralbum.trackinfo.forEach(function(t, idx) {
      var stream = t.file ? t.file['mp3-128'] : undefined;
      audioStreams.push({
        trackNum: t.track_num || (idx + 1),
        title: cleanHtmlText(t.title) || ('Track ' + (idx + 1)),
        streamUrl: stream || undefined,
        url: stream || undefined,
        duration: t.duration ? Math.round(t.duration) : undefined,
        lyrics: t.lyrics ? String(t.lyrics).trim() : undefined,
      });
    });
  }

  // Artwork & extra packaging photos
  var artId = tralbum ? tralbum.art_id : null;
  var artUrl = artId ? ('https://f4.bcbits.com/img/a' + artId + '_10.jpg') : (item.artUrl || '');

  var popupImages = Array.from(subHtml.matchAll(/href="([^"]+a\\d+_10\\.jpg)"/gi)).map(function(m) { return m[1]; });
  var imgMatches = Array.from(subHtml.matchAll(/src="([^"]+a\\d+_10\\.jpg)"/gi)).map(function(m) { return m[1]; });
  var moreThumbs = Array.from(subHtml.matchAll(/data-original="([^"]+a\\d+_10\\.jpg)"/gi)).map(function(m) { return m[1]; });
  var allImages = Array.from(new Set(popupImages.concat(imgMatches, moreThumbs))).filter(function(u) { return u !== artUrl; });

  // Artist Bio Picture (for artist.jpg)
  var artistBioPicUrl = extractArtistBioPicUrl(subHtml, tralbum, globalArtistBioPicUrl);

  // Untruncated liner notes / about
  var aboutMatch = subHtml.match(/class="[^"]*tralbum-about[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i) ||
                   subHtml.match(/class="[^"]*track_story[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i);
  var creditsMatch = subHtml.match(/class="[^"]*tralbum-credits[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i);
  var licenseMatch = subHtml.match(/<div[^>]*id="license"[^>]*>([\\s\\S]*?)<\\/div>/i) ||
                     subHtml.match(/<div[^>]*class="[^"]*license[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i);
  var lyricsDivMatch = subHtml.match(/class="[^"]*lyricsText[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i);

  var fromAlbumMatch = subHtml.match(/from\\s+the\\s+album\\s*<a[^>]*>([^<]+)<\\/a>/i) ||
                       subHtml.match(/class="[^"]*albumTitle[^"]*"[^>]*>([^<]+)</i);
  var fromAlbumTitle = (tralbum && tralbum.album_title) || (current && current.album_title) || cleanHtmlText(fromAlbumMatch ? fromAlbumMatch[1] : '');

  var firstTrackAbout = (tralbum && tralbum.trackinfo && tralbum.trackinfo[0] && tralbum.trackinfo[0].about) ? cleanHtmlText(tralbum.trackinfo[0].about) : '';
  var firstTrackCredits = (tralbum && tralbum.trackinfo && tralbum.trackinfo[0] && tralbum.trackinfo[0].credits) ? cleanHtmlText(tralbum.trackinfo[0].credits) : '';

  var aboutText = cleanHtmlText(current && current.about) || cleanHtmlText(tralbum && tralbum.about) || firstTrackAbout || cleanHtmlText(aboutMatch ? aboutMatch[1] : '');
  var creditsText = cleanHtmlText(current && current.credits) || cleanHtmlText(tralbum && tralbum.credits) || firstTrackCredits || cleanHtmlText(creditsMatch ? creditsMatch[1] : '');
  var licenseText = cleanHtmlText(licenseMatch ? licenseMatch[1] : '');
  var pageLyrics = cleanHtmlText(lyricsDivMatch ? lyricsDivMatch[1] : '');

  var tagsMatches = (tralbum && tralbum.tags && Array.isArray(tralbum.tags) && tralbum.tags.length > 0)
    ? tralbum.tags
    : Array.from(subHtml.matchAll(/<a[^>]*class="tag"[^>]*>([^<]+)<\\/a>/gi)).map(function(tm) { return cleanHtmlText(tm[1]); });
  tagsMatches = Array.from(new Set(tagsMatches)).filter(Boolean);

  // Artist name detection
  var albumArtistMatch = subHtml.match(/class="albumTitle"[^>]*>[\\s\\S]*?<span[^>]*class="artist"[^>]*>[\\s\\S]*?by\\s*<a[^>]*>([^<]+)<\\/a>/i) ||
                         subHtml.match(/<h3 class="albumTitle"[^>]*>[\\s\\S]*?<span>by\\s*<a[^>]*>([^<]+)<\\/a>/i) ||
                         subHtml.match(/<h3 class="albumTitle"[^>]*>[\\s\\S]*?by\\s*<span>\\s*<a[^>]*>([^<]+)<\\/a>/i) ||
                         subHtml.match(/by\\s+<span itemprop="byArtist">[\\s\\S]*?<a[^>]*>([^<]+)<\\/a>/i);

  var artistElMatch = albumArtistMatch ||
                      subHtml.match(/#band-name-location[^>]*class="title"[^>]*>([^<]+)/i) ||
                      subHtml.match(/<span[^>]*class="title"[^>]*>([^<]+)<\\/span>/i) ||
                      subHtml.match(/<span\\s+class="artist"[^>]*>([^<]+)<\\/span>/i) ||
                      subHtml.match(/property="og:site_name"[^>]*content="([^"]+)"/i);

  var artist = cleanHtmlText(
    (current && current.artist) ||
    (tralbum && tralbum.artist) ||
    (tralbum && tralbum.band && tralbum.band.name) ||
    (artistElMatch ? artistElMatch[1] : '') ||
    fallbackArtist
  );

  // Format release date
  var dateMetaMatch = subHtml.match(/itemprop="datePublished"[^>]*content="([^"]+)"/i) ||
                      subHtml.match(/class="released"[^>]*>[\\s\\S]*?released\\s+([A-Za-z]+\\s+\\d{1,2},\\s+\\d{4})/i) ||
                      subHtml.match(/property="music:release_date"[^>]*content="([^"]+)"/i);

  var rawDate = (current && current.release_date) || (current && current.publish_date) || (tralbum && tralbum.album_release_date) || (dateMetaMatch ? dateMetaMatch[1] : '');
  var dotDate = formatDateToDotString(rawDate);
  var humanDate = undefined;
  if (rawDate) {
    try {
      var d = new Date(String(rawDate).replace(/released\\s+/i, '').trim());
      if (!isNaN(d.getTime())) {
        humanDate = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      }
    } catch (e) {}
  }
  if (!humanDate && dotDate) {
    humanDate = dotDate;
  }

  var releaseTitle = cleanHtmlText((current && current.title) || item.title);

  var formatDuration = function(sec) {
    if (!sec) return '';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return ' (' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ')';
  };

  var trackListFormatted = audioStreams.length > 0
    ? audioStreams.map(function(s) { return s.trackNum + '. ' + s.title + formatDuration(s.duration); })
    : ['1. ' + releaseTitle];

  var tracksWithLyrics = audioStreams.filter(function(s) { return s.lyrics && s.lyrics.trim().length > 0; });
  var lyricsBlock = '';
  if (tracksWithLyrics.length > 0) {
    lyricsBlock = '================================================================================\\nLYRICS\\n================================================================================\\n(Track lyrics are also saved as separate .lrc files inside info ZIP)\\n\\n' +
      tracksWithLyrics.map(function(t) { return '--- Track ' + t.trackNum + ': ' + t.title + ' ---\\n' + t.lyrics + '\\n'; }).join('\\n') + '\\n';
  } else if (pageLyrics) {
    lyricsBlock = '================================================================================\\nLYRICS\\n================================================================================\\n' + pageLyrics + '\\n\\n';
  }

  var divider = '='.repeat(80);
  var infoText = divider + '\\n' + releaseTitle.toUpperCase() + ' by ' + artist + '\\n' + divider + '\\n';
  infoText += 'Release Date : ' + (humanDate || 'Unknown') + (dotDate && humanDate !== dotDate ? ' (' + dotDate + ')' : '') + '\\n';
  infoText += 'Type         : ' + item.type.toUpperCase() + '\\n';
  if (fromAlbumTitle) {
    infoText += 'From Album   : ' + fromAlbumTitle + '\\n';
  }
  infoText += 'Status       : ' + priceFormatted + (isPaid ? ' (Paid release - Audio skipped unless purchased. Artwork, photos & info bundled)' : '') + '\\n';
  infoText += 'Bandcamp URL : ' + item.url + '\\n';
  infoText += 'Artist Page  : ' + origin + '\\n\\n';

  if (trackListFormatted.length > 0) {
    infoText += divider + '\\nTRACKLIST (' + trackListFormatted.length + ' Track' + (trackListFormatted.length > 1 ? 's' : '') + ')\\n' + divider + '\\n' + trackListFormatted.join('\\n') + '\\n\\n';
  }

  if (aboutText) {
    infoText += divider + '\\nLINER NOTES / ABOUT\\n' + divider + '\\n' + aboutText + '\\n\\n';
  }

  if (creditsText) {
    infoText += divider + '\\nCREDITS\\n' + divider + '\\n' + creditsText + '\\n\\n';
  }

  if (licenseText) {
    infoText += divider + '\\nLICENSE\\n' + divider + '\\n' + licenseText + '\\n\\n';
  }

  if (tagsMatches.length > 0) {
    infoText += divider + '\\nTAGS & GENRES\\n' + divider + '\\n' + tagsMatches.join(', ') + '\\n\\n';
  }

  if (lyricsBlock) {
    infoText += lyricsBlock;
  }

  infoText += divider + '\\nDownloaded with Bandcamp Free & NYP Bulk Downloader\\n' + divider + '\\n';

  return {
    releaseTitle: releaseTitle,
    artist: artist,
    artUrl: artUrl,
    artistBioPicUrl: artistBioPicUrl,
    extraImages: allImages,
    allImages: allImages,
    humanDate: humanDate,
    dotDate: dotDate,
    isFree: isFree,
    isNyp: isNyp,
    isPurchased: isPurchased,
    isPaid: isPaid,
    badgeType: badgeType,
    minPrice: minPrice,
    priceFormatted: priceFormatted,
    requireEmail: requireEmail,
    freeDlPage: freeDlPage || undefined,
    trackListFormatted: trackListFormatted,
    audioStreams: audioStreams,
    aboutText: aboutText,
    creditsText: creditsText,
    licenseText: licenseText,
    tagsMatches: tagsMatches,
    infoText: infoText,
    fromAlbumTitle: fromAlbumTitle,
  };
}

/**
 * Resolves a Bandcamp free or email-walled download page by calling statdownload and waiting for busy preparation.
 */
async function resolveBandcampDownload(downloadPageUrl, requestedFormat) {
  function getSafeHeaders(ref, cookieHeader) {
    var h = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    };
    if (ref) h['Referer'] = ref;
    if (cookieHeader) h['Cookie'] = cookieHeader;
    if (typeof window === 'undefined') {
      h['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
    }
    return h;
  }

  requestedFormat = requestedFormat || 'flac';
  try {
    if (!downloadPageUrl || typeof downloadPageUrl !== 'string' || !downloadPageUrl.trim()) {
      return { success: false, error: 'Valid download page URL is required' };
    }
    var cleanUrl = String(downloadPageUrl || '').replace(/&amp;/g, '&').trim();
    if (!cleanUrl.startsWith('http')) {
      return { success: false, error: 'Invalid download page URL protocol' };
    }

    if (cleanUrl.indexOf('bcbits.com/download/') !== -1 || cleanUrl.indexOf('popplers') !== -1) {
      return {
        success: true,
        downloadUrl: cleanUrl,
        format: requestedFormat,
        isArchive: cleanUrl.indexOf('/album/') !== -1,
        itemType: cleanUrl.indexOf('/album/') !== -1 ? 'album' : 'track'
      };
    }

    var dlRes = await fetch(cleanUrl, {
      headers: getSafeHeaders(cleanUrl),
    });

    if (!dlRes.ok) throw new Error('Download page HTTP ' + dlRes.status);

    var cookieHeader = '';
    try {
      if (typeof dlRes.headers.getSetCookie === 'function') {
        var cookies = dlRes.headers.getSetCookie();
        if (Array.isArray(cookies) && cookies.length > 0) {
          cookieHeader = cookies.map(function(c) { return c.split(';')[0]; }).join('; ');
        }
      } else {
        var sc = dlRes.headers.get('set-cookie');
        if (sc) cookieHeader = sc.split(';')[0];
      }
    } catch(e) {}

    var dlHtml = await dlRes.text();

    if (dlHtml.indexOf('<title>Client Challenge</title>') !== -1 || dlHtml.indexOf('_fs-ch-') !== -1) {
      return {
        success: false,
        error: 'Bandcamp Cloudflare Bot Challenge active on datacenter IP. Please use the Chrome Extension to download this release directly through your local browser session.'
      };
    }

    // Direct Extraction: Match any direct https://p*.bcbits.com/download/(album|track)/... links in HTML
    var bcbitsMatches = Array.from(
      dlHtml.matchAll(/https?:\\/\\/[a-z0-9.]*bcbits\\.com\\/download\\/(?:album|track)\\/[^\\s"'<>]+/gi)
    ).map(function(m) { return m[0].replace(/&amp;/g, '&'); });

    var directFormatUrl = '';
    if (bcbitsMatches.length > 0) {
      var matchForFormat = bcbitsMatches.find(function(u) { return u.toLowerCase().indexOf('/' + requestedFormat.toLowerCase() + '/') !== -1; }) ||
                           bcbitsMatches.find(function(u) { return u.toLowerCase().indexOf(requestedFormat.toLowerCase()) !== -1; }) ||
                           bcbitsMatches.find(function(u) { return u.toLowerCase().indexOf('/flac/') !== -1; }) ||
                           bcbitsMatches.find(function(u) { return u.toLowerCase().indexOf('/mp3-320/') !== -1; }) ||
                           bcbitsMatches[0];
      if (matchForFormat) {
        directFormatUrl = matchForFormat;
      }
    }

    var blob = null;
    var blobRegexes = [
      /data-blob=["']([\\s\\S]*?)["']\\s*(?:>|class|id)/i,
      /id=["']pagedata["'][^>]*data-blob=["']([\\s\\S]*?)["']/i,
      /<div[^>]*data-blob=["']([\\s\\S]*?)["']/i,
      /data-blob="([^"]+)"/i,
      /data-blob='([^']+)'/i,
      /var\\s+pagedata\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;/i,
      /window\\.pagedata\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;/i
    ];

    for (var i = 0; i < blobRegexes.length; i++) {
      var m = dlHtml.match(blobRegexes[i]);
      if (m && m[1]) {
        try {
          var decoded = m[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          blob = JSON.parse(decoded);
          if (blob && (blob.digital_items || blob.downloads)) break;
        } catch(e) {}
      }
    }

    if (!blob) {
      var diMatch = dlHtml.match(/\\{[\\s\\S]*?"digital_items"\\s*:\\s*\\[[\\s\\S]*?\\}\\s*;/);
      if (diMatch) {
        try {
          blob = JSON.parse(diMatch[0].replace(/;\\s*$/, ''));
        } catch(e) {}
      }
    }

    var digitalItem = blob && (blob.digital_items ? blob.digital_items[0] : blob);
    var downloads = digitalItem && digitalItem.downloads;

    if (!downloads && directFormatUrl) {
      var titleMatch = dlHtml.match(/<title>([^<]+)<\\/title>/i);
      var titleFromHtml = titleMatch ? cleanHtmlText(titleMatch[1].replace(/\\|\\s*Bandcamp/i, '')) : 'Album';
      return {
        success: true,
        downloadUrl: directFormatUrl,
        format: requestedFormat,
        description: requestedFormat.toUpperCase(),
        isArchive: directFormatUrl.indexOf('/album/') !== -1,
        itemType: directFormatUrl.indexOf('/album/') !== -1 ? 'album' : 'track',
        title: titleFromHtml,
        artist: 'Artist'
      };
    }

    if (!downloads) throw new Error('No download links or data-blob found on download page. Please verify that the download link is active.');

    var itemType = (digitalItem.item_type || digitalItem.type || 'album');
    var releaseTitle = cleanHtmlText(digitalItem.title);
    var releaseArtist = cleanHtmlText(digitalItem.artist);

    var target =
      downloads[requestedFormat] ||
      downloads['flac'] ||
      downloads['mp3-320'] ||
      downloads['mp3-v0'] ||
      downloads['wav'] ||
      Object.values(downloads)[0];

    if (!target || !target.url) {
      if (directFormatUrl) {
        return {
          success: true,
          downloadUrl: directFormatUrl,
          format: requestedFormat,
          description: requestedFormat.toUpperCase(),
          isArchive: directFormatUrl.indexOf('/album/') !== -1,
          itemType: itemType,
          title: releaseTitle,
          artist: releaseArtist
        };
      }
      throw new Error('No target download URL available');
    }

    var finalUrl = '';

    // Direct check: Bandcamp single tracks and ready archives often return HTTP 302 redirect
    try {
      var directCheck = await fetch(target.url, {
        method: 'GET',
        headers: getSafeHeaders(cleanUrl, cookieHeader),
        redirect: 'manual',
      });
      if ([301, 302, 303, 307, 308].indexOf(directCheck.status) !== -1) {
        var loc = directCheck.headers.get('location');
        if (loc) finalUrl = loc;
      }
    } catch (e) {}

    async function callStat(urlToStat) {
      try {
        var parsed = new URL(urlToStat);
        var statUrl =
          parsed.origin +
          parsed.pathname.replace('/download/', '/statdownload/') +
          parsed.search +
          '&.rand=' +
          Math.floor(Math.random() * 1000000) +
          '&.vrs=1';

        var res = await fetch(statUrl, {
          headers: getSafeHeaders(cleanUrl, cookieHeader),
        });

        var text = await res.text();
        var jsonMatch = text.match(/Downloads\\.statResult\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)/);
        if (jsonMatch) return JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.warn('callStat error:', e);
      }
      return null;
    }

    if (!finalUrl) {
      var stat = await callStat(target.url);

      var attempts = 0;
      while (
        stat &&
        (stat.result === 'busy' || (!stat.download_url && stat.retry_url)) &&
        attempts < 25
      ) {
        attempts++;
        await new Promise(function(r) { setTimeout(r, 1500); });
        stat = await callStat(stat.retry_url || target.url);
        if (stat && stat.result === 'ok' && stat.download_url) {
          break;
        }
      }

      if (stat && stat.download_url) {
        finalUrl = stat.download_url;
      }
    }

    if (!finalUrl) {
      try {
        var retryCheck = await fetch(target.url, {
          method: 'GET',
          headers: getSafeHeaders(cleanUrl, cookieHeader),
          redirect: 'manual',
        });
        if ([301, 302, 303, 307, 308].indexOf(retryCheck.status) !== -1) {
          var loc2 = retryCheck.headers.get('location');
          if (loc2) finalUrl = loc2;
        }
      } catch(e) {}
    }

    if (!finalUrl) {
      throw new Error(
        (stat && stat.result === 'err')
          ? ('Bandcamp error: ' + (stat.errortype || 'Download link preparation failed'))
          : 'Archive preparation timed out on Bandcamp server. Please retry.'
      );
    }

    var isArchive =
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
      isArchive: isArchive,
      itemType: itemType,
      title: releaseTitle,
      artist: releaseArtist,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * File naming scheme parser supporting conditional brackets and title deduplication.
 */
function formatFilenameBySchema(schema, meta, options) {
  options = options || { allowSubfolders: false };
  var template = schema || '%artist% - %date% - %album%[%title%.%format%]';
  var isArchive = meta.isArchive || (meta.type === 'album' && meta.format === 'zip');
  var isSingleTrackRelease = meta.type === 'track' && (meta.album === meta.title || !meta.album || (meta.totalTracks || 1) <= 1);

  var clean = function(s) {
    if (!s) return '';
    var res = String(s).replace(/[:*?"<>|\\\\/]/g, '_').trim();
    if (!options.allowSubfolders) {
      res = res.replace(/[\\\\/]/g, '_');
    }
    return res;
  };

  var total = meta.totalTracks || 1;
  var padLen = Math.max(2, String(total).length);
  var trackNumStr = (!isArchive && total > 1 && meta.trackNum != null)
    ? String(meta.trackNum).padStart(padLen, '0')
    : '';

  var rawDate = meta.date || meta.year || '2026.01.01';
  var dateStr = '2026.01.01';
  try {
    var d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      dateStr = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
    }
  } catch (e) {}

  var yearStr = dateStr.slice(0, 4);
  var defaultExt = isArchive ? 'zip' : (meta.format || 'flac').replace(/[^a-zA-Z0-9]/g, '');

  var titleVal = (isArchive || isSingleTrackRelease) ? '' : clean(meta.title || '');

  var values = {
    '%artist%': clean(meta.artist || 'Bandcamp'),
    '%album%': clean(meta.album || meta.title || 'Album'),
    '%title%': titleVal,
    '%track_num%': trackNumStr,
    '%date%': dateStr,
    '%year%': yearStr,
    '%format%': defaultExt,
    '%type%': clean(meta.type || 'album'),
  };

  var ESC_OPEN = '\\uE000';
  var ESC_CLOSE = '\\uE001';

  var str = template.replace(/\\\\\\[/g, ESC_OPEN).replace(/\\\\\\]/g, ESC_CLOSE);

  var bracketRegex = /\\[([^\\[\\]]*)\\]/;
  while (bracketRegex.test(str)) {
    str = str.replace(bracketRegex, function(_, inner) {
      var tokens = inner.match(/%[a-zA-Z0-9_]+%/g);
      if (!tokens || tokens.length === 0) return inner;
      var allValid = tokens.every(function(token) {
        var val = values[token.toLowerCase()];
        return val != null && String(val).trim() !== '';
      });
      return allValid ? inner : '';
    });
  }

  str = str.replace(new RegExp(ESC_OPEN, 'g'), '[').replace(new RegExp(ESC_CLOSE, 'g'), ']');

  for (var token in values) {
    if (Object.prototype.hasOwnProperty.call(values, token)) {
      str = str.replace(new RegExp(token, 'gi'), values[token]);
    }
  }

  var result = str
    .replace(/[\\[\\]]/g, '')
    .replace(/\\s+/g, ' ')
    .replace(/\\s*-\\s*-\\s*/g, ' - ')
    .replace(/\\s*-\\s*\\./g, '.')
    .replace(/\\.{2,}/g, '.')
    .trim();

  if (!result.toLowerCase().endsWith('.' + defaultExt)) {
    result = result + '.' + defaultExt;
  }

  return result;
}

function getCompanionInfoZipName(audioFilename) {
  var lastDot = audioFilename.lastIndexOf('.');
  if (lastDot > 0) {
    var base = audioFilename.slice(0, lastDot);
    return base + ' (info).zip';
  }
  return audioFilename + ' (info).zip';
}

var _targetGlobal = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
if (_targetGlobal) {
  _targetGlobal.BandcampCore = {
    cleanHtmlText: cleanHtmlText,
    formatDateToDotString: formatDateToDotString,
    extractBandcampTralbum: extractBandcampTralbum,
    extractArtistBioPicUrl: extractArtistBioPicUrl,
    parseReleasePageData: parseReleasePageData,
    resolveBandcampDownload: resolveBandcampDownload,
    formatFilenameBySchema: formatFilenameBySchema,
    getCompanionInfoZipName: getCompanionInfoZipName,
  };
  _targetGlobal.cleanHtmlText = cleanHtmlText;
  _targetGlobal.formatDateToDotString = formatDateToDotString;
  _targetGlobal.extractBandcampTralbum = extractBandcampTralbum;
  _targetGlobal.extractArtistBioPicUrl = extractArtistBioPicUrl;
  _targetGlobal.parseReleasePageData = parseReleasePageData;
  _targetGlobal.resolveBandcampDownload = resolveBandcampDownload;
  _targetGlobal.formatFilenameBySchema = formatFilenameBySchema;
  _targetGlobal.getCompanionInfoZipName = getCompanionInfoZipName;
}
`;
