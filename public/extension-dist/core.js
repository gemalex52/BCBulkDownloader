var BandcampCore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/services/bandcampCore.ts
  var bandcampCore_exports = {};
  __export(bandcampCore_exports, {
    BANDCAMP_FETCH_HEADERS: () => BANDCAMP_FETCH_HEADERS,
    cleanBandcampUrl: () => cleanBandcampUrl,
    cleanHtmlText: () => cleanHtmlText,
    cleanPhotoSectionTitle: () => cleanPhotoSectionTitle,
    debugLog: () => debugLog,
    extractArtistBioPicUrl: () => extractArtistBioPicUrl,
    extractBandcampTralbum: () => extractBandcampTralbum,
    extractExtraPhotosWithTitles: () => extractExtraPhotosWithTitles,
    extractImageNumericId: () => extractImageNumericId,
    formatDateToDotString: () => formatDateToDotString,
    formatFilenameBySchema: () => formatFilenameBySchema,
    getCompanionInfoZipName: () => getCompanionInfoZipName,
    isDebugLogging: () => isDebugLogging,
    parseReleasePageData: () => parseReleasePageData,
    resolveBandcampDownload: () => resolveBandcampDownload,
    setDebugLogging: () => setDebugLogging
  });
  var BANDCAMP_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1"
  };
  var _debugLoggingEnabled = false;
  function setDebugLogging(enabled) {
    _debugLoggingEnabled = enabled;
  }
  function isDebugLogging() {
    return _debugLoggingEnabled;
  }
  function debugLog(module, ...args) {
    if (_debugLoggingEnabled) {
      console.log(`[BandcampDL:${module}]`, ...args);
    }
  }
  function cleanHtmlText(raw) {
    if (!raw) return "";
    return raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&euml;/g, "\xEB").replace(/&Euml;/g, "\xCB").replace(/&auml;/g, "\xE4").replace(/&Auml;/g, "\xC4").replace(/&ouml;/g, "\xF6").replace(/&Ouml;/g, "\xD6").replace(/&uuml;/g, "\xFC").replace(/&Uuml;/g, "\xDC").replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10))).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function formatDateToDotString(raw) {
    if (!raw) return "";
    try {
      const clean = String(raw).replace(/released\s+/i, "").trim();
      const d = new Date(clean);
      if (!isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}.${mm}.${dd}`;
      }
    } catch (e) {
    }
    const match = String(raw).match(/(\d{4})[.-](\d{1,2})[.-](\d{1,2})/);
    if (match) {
      return `${match[1]}.${match[2].padStart(2, "0")}.${match[3].padStart(2, "0")}`;
    }
    return "";
  }
  function extractBandcampTralbum(html) {
    if (!html) return null;
    try {
      const tralbumDataMatch = html.match(/data-tralbum="([^"]+)"/);
      if (tralbumDataMatch) {
        const decoded = tralbumDataMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        return JSON.parse(decoded);
      }
      const tralbumVarMatch = html.match(/var\s+TralbumData\s*=\s*(\{[\s\S]*?\})\s*;/);
      if (tralbumVarMatch) {
        try {
          return JSON.parse(tralbumVarMatch[1]);
        } catch (e) {
          const fn = new Function(`return (${tralbumVarMatch[1]});`);
          return fn();
        }
      }
      const ldJsonMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
      if (ldJsonMatch) {
        const parsedLd = JSON.parse(ldJsonMatch[1]);
        if (parsedLd) {
          return {
            current: {
              title: parsedLd.name,
              release_date: parsedLd.datePublished || parsedLd.dateModified,
              about: parsedLd.description
            },
            artist: parsedLd.byArtist?.name
          };
        }
      }
    } catch (err) {
      console.warn("Error extracting TralbumData:", err);
    }
    return null;
  }
  function extractArtistBioPicUrl(html, tralbum, globalBioUrl) {
    if (!html && !tralbum) return globalBioUrl;
    const bioPicId = tralbum?.band?.bio_pic_id || tralbum?.bio_pic_id || tralbum?.band_photo_id;
    if (bioPicId) {
      return `https://f4.bcbits.com/img/00${bioPicId}_10.jpg`;
    }
    if (html) {
      const bioContainerMatch = html.match(/id="bio-container"[^>]*>([\s\S]*?)<\/div>/i);
      if (bioContainerMatch) {
        const imgInBio = bioContainerMatch[1].match(/(?:src|data-original)="([^"]+)"/i) || bioContainerMatch[1].match(/https?:\/\/f4\.bcbits\.com\/img\/(?:00\d+|a\d+)_\d+\.jpg/i);
        if (imgInBio) {
          const raw = imgInBio[1] || imgInBio[0];
          return raw.replace(/_\d+\.jpg/, "_10.jpg");
        }
      }
      const bioPicMatch = html.match(/class="[^"]*bio-pic[^"]*"[^>]*src="([^"]+)"/i) || html.match(/class="[^"]*band-photo[^"]*"[^>]*src="([^"]+)"/i) || html.match(/<img[^>]*class="[^"]*(?:bio-pic|band-photo)[^"]*"[^>]*src="([^"]+)"/i);
      if (bioPicMatch?.[1]) {
        return bioPicMatch[1].replace(/_\d+\.jpg/, "_10.jpg");
      }
    }
    return globalBioUrl || void 0;
  }
  function cleanBandcampUrl(input) {
    if (!input) return "";
    let cleaned = input.trim();
    if (cleaned.includes("url=")) {
      const match = cleaned.match(/url=([^&]+)/);
      if (match) {
        try {
          cleaned = decodeURIComponent(match[1]);
        } catch (e) {
          cleaned = match[1];
        }
      }
    }
    try {
      if (cleaned.includes("%3A") || cleaned.includes("%2F") || cleaned.includes("%3a") || cleaned.includes("%2f")) {
        cleaned = decodeURIComponent(cleaned);
      }
    } catch (e) {
    }
    cleaned = cleaned.replace(/(\/music)+$/i, "/music");
    cleaned = cleaned.replace(/\/+$/, "");
    if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
      cleaned = "https://" + cleaned;
    }
    try {
      const parsed = new URL(cleaned);
      if (parsed.hostname.endsWith(".bandcamp.com") && (parsed.pathname === "" || parsed.pathname === "/")) {
        cleaned = `${parsed.origin}/music`;
      }
    } catch (e) {
    }
    return cleaned;
  }
  function extractImageNumericId(url) {
    if (!url) return "";
    const m = url.match(/[a0-9]*?(\d{6,})_/);
    return m ? m[1].replace(/^0+/, "") : "";
  }
  function cleanPhotoSectionTitle(rawTitle) {
    if (!rawTitle) return "";
    let clean = cleanHtmlText(rawTitle);
    clean = clean.replace(/["'“”‘’]/g, "");
    clean = clean.replace(/[:*?"<>|\\\/]/g, " - ");
    clean = clean.replace(/\s*-\s*-\s*/g, " - ");
    clean = clean.replace(/\s{2,}/g, " ");
    clean = clean.replace(/^[\s\-_.]+/, "").replace(/[\s\-_.]+$/, "");
    return clean;
  }
  function extractExtraPhotosWithTitles(html, artUrl, artistBioPicUrl) {
    const coverId = extractImageNumericId(artUrl);
    const bioId = extractImageNumericId(artistBioPicUrl);
    const seenIds = /* @__PURE__ */ new Set();
    if (coverId) seenIds.add(coverId);
    if (bioId) seenIds.add(bioId);
    const excludedImageIds = /* @__PURE__ */ new Set();
    const fullDiscoBlocks = Array.from(
      html.matchAll(/<(?:li|div)[^>]*(?:id="buyFullDiscography"|class="[^"]*buyFullDiscography[^"]*")[^>]*>([\s\S]*?)<\/(?:li|div)>/gi)
    );
    for (const fdb of fullDiscoBlocks) {
      const discoImgs = Array.from(fdb[0].matchAll(/bcbits\.com\/img\/(?:a\d+|00\d+)_\d+\.jpg/gi)).map((m) => m[0]);
      for (const di of discoImgs) {
        const id = extractImageNumericId(di);
        if (id) excludedImageIds.add(id);
      }
    }
    const anyBuyItemBlocks = Array.from(html.matchAll(/<li[^>]*class="[^"]*buyItem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi));
    for (const bib of anyBuyItemBlocks) {
      if (/full\s+digital\s+discography/i.test(bib[0]) || /buyFullDiscography/i.test(bib[0])) {
        const discoImgs = Array.from(bib[0].matchAll(/bcbits\.com\/img\/(?:a\d+|00\d+)_\d+\.jpg/gi)).map((m) => m[0]);
        for (const di of discoImgs) {
          const id = extractImageNumericId(di);
          if (id) excludedImageIds.add(id);
        }
      }
    }
    const extraPhotos = [];
    const addPhoto = (rawUrl, sectionTitle) => {
      if (!rawUrl || typeof rawUrl !== "string") return;
      const cleanUrl = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
      const highResUrl = cleanUrl.replace(/_\d+\.jpg/, "_10.jpg");
      const id = extractImageNumericId(highResUrl);
      if (!id || seenIds.has(id) || excludedImageIds.has(id)) return;
      seenIds.add(id);
      const title = cleanPhotoSectionTitle(sectionTitle || "");
      extraPhotos.push({
        url: highResUrl,
        title: title || void 0
      });
    };
    const packageMatches = Array.from(
      html.matchAll(/<li[^>]*class="[^"]*(?:package|merch-item|buyItem)[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)
    ).concat(
      Array.from(html.matchAll(/<div[^>]*class="[^"]*(?:package|merch-item)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi))
    );
    for (const p of packageMatches) {
      const fullTag = p[0];
      const block = p[1];
      if (/buyFullDiscography/i.test(fullTag) || /id="buyFullDiscography"/i.test(fullTag) || /full\s+digital\s+discography/i.test(block)) {
        continue;
      }
      const titleMatch = block.match(/class="[^"]*buyItemPackageTitle[^"]*"[^>]*>([\s\S]*?)<\//i) || block.match(/class="[^"]*primaryText[^"]*"[^>]*>([\s\S]*?)<\//i) || block.match(/class="[^"]*(?:package-title|merch-item-title)[^"]*"[^>]*>([\s\S]*?)<\//i) || block.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/i) || block.match(/class="popupImage"[^>]*title="([^"]+)"/i) || block.match(/<img[^>]*alt="([^"]+)"/i);
      const sectionTitle = titleMatch ? cleanHtmlText(titleMatch[1]) : "";
      const imgUrls = Array.from(
        block.matchAll(/(?:href|src|data-original)="([^"]*bcbits\.com\/img\/(?:a\d+|00\d+)_\d+\.jpg)"/gi)
      ).map((m) => m[1]);
      for (const u of imgUrls) {
        addPhoto(u, sectionTitle);
      }
    }
    const popupAnchors = Array.from(
      html.matchAll(/<a[^>]*class="[^"]*popupImage[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)
    );
    for (const pa of popupAnchors) {
      const fullAnchor = pa[0];
      if (/discography/i.test(fullAnchor)) continue;
      const href = pa[1];
      const inner = pa[2];
      const titleMatch = fullAnchor.match(/title="([^"]+)"/i) || inner.match(/alt="([^"]+)"/i);
      addPhoto(href, titleMatch ? titleMatch[1] : "");
    }
    const moreThumbsMatch = html.match(/<ul[^>]*class="[^"]*more-thumbs[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
    if (moreThumbsMatch) {
      const thumbBlocks = Array.from(moreThumbsMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi));
      for (const tb of thumbBlocks) {
        const uMatch = tb[1].match(/(?:href|src|data-original)="([^"]*bcbits\.com\/img\/(?:a\d+|00\d+)_\d+\.jpg)"/i);
        const tMatch = tb[1].match(/(?:title|alt)="([^"]+)"/i);
        if (uMatch) {
          addPhoto(uMatch[1], tMatch ? tMatch[1] : "");
        }
      }
    }
    const imgTags = Array.from(
      html.matchAll(/<img[^>]*src="([^"]*bcbits\.com\/img\/(?:a\d+|00\d+)_\d+\.jpg)"[^>]*alt="([^"]+)"/gi)
    );
    for (const it of imgTags) {
      if (!/discography/i.test(it[2])) {
        addPhoto(it[1], it[2]);
      }
    }
    return {
      extraImages: extraPhotos.map((p) => p.url),
      extraPhotos
    };
  }
  function parseReleasePageData(subHtml, tralbum, item, origin, fallbackArtist, globalArtistBioPicUrl) {
    const current = tralbum?.current;
    const isPurchased = Boolean(
      tralbum?.is_purchased || tralbum?.has_purchased || tralbum?.you_own_it || /you\s+own\s+this|you\s+own\s+it|class="[^"]*you-own-this/i.test(subHtml)
    );
    const minPrice = current?.minimum_price != null ? current.minimum_price : 0;
    const isSetPrice = Boolean(current?.is_set_price);
    const hasFreeButton = /free\s+download/i.test(subHtml);
    const hasNypText = /name\s+your\s+price/i.test(subHtml) || /buyItemNyp/i.test(subHtml) || minPrice === 0 && current?.download_pref === 2;
    const requireEmailFlag = Boolean(current?.require_email === 1 || current?.require_email_0 === 1 || current?.require_email && !isSetPrice);
    const isNypEligible = !isSetPrice && (hasNypText || hasFreeButton || current?.require_email_0 === 1);
    const isEmailWalled = Boolean(
      requireEmailFlag || current?.require_email_0 === 1 || !isSetPrice && hasNypText && !hasFreeButton
    );
    const rawFreeDlPage = tralbum?.freeDownloadPage || null;
    const freeDlPage = !isEmailWalled && hasFreeButton && current?.require_email_0 !== 1 ? rawFreeDlPage : null;
    const requireEmail = isEmailWalled;
    let isFree = false;
    let isNyp = false;
    let isPaid = false;
    let badgeType = "free";
    if (isPurchased) {
      isFree = true;
      badgeType = "own";
    } else if (isEmailWalled) {
      isNyp = true;
      isFree = true;
      isPaid = false;
      badgeType = "email";
    } else if (Boolean(freeDlPage)) {
      isFree = true;
      badgeType = "free";
    } else if (isSetPrice || !hasFreeButton && !hasNypText && current?.require_email_0 !== 1 && minPrice > 0) {
      isPaid = true;
      isFree = false;
      isNyp = false;
      badgeType = "paid";
    } else if (hasFreeButton || minPrice === 0 && current?.download_pref === 1) {
      isFree = true;
      badgeType = "free";
    } else if (isNypEligible) {
      isNyp = true;
      badgeType = "email";
    } else if (minPrice > 0) {
      isPaid = true;
      badgeType = "paid";
    } else {
      isFree = true;
      badgeType = "free";
    }
    const cur = current?.currency || "EUR";
    const curSymbol = cur === "EUR" ? "\u20AC" : cur === "USD" ? "$" : cur === "GBP" ? "\xA3" : cur;
    let priceFormatted = "Paid";
    if (badgeType === "own") {
      priceFormatted = "Own";
    } else if (badgeType === "free") {
      priceFormatted = "Free";
    } else if (badgeType === "email") {
      priceFormatted = minPrice > 0 ? `Email (${curSymbol}${minPrice})` : "Email";
    } else if (badgeType === "paid") {
      priceFormatted = minPrice > 0 ? `Paid (${curSymbol}${minPrice})` : "Paid";
    }
    const audioStreams = [];
    if (tralbum?.trackinfo && Array.isArray(tralbum.trackinfo)) {
      tralbum.trackinfo.forEach((t, idx) => {
        const stream = t.file?.["mp3-128"];
        audioStreams.push({
          trackNum: t.track_num || idx + 1,
          title: cleanHtmlText(t.title) || `Track ${idx + 1}`,
          streamUrl: stream || void 0,
          url: stream || void 0,
          duration: t.duration ? Math.round(t.duration) : void 0,
          lyrics: t.lyrics ? String(t.lyrics).trim() : void 0
        });
      });
    }
    const artId = tralbum?.art_id;
    const artUrl = artId ? `https://f4.bcbits.com/img/a${artId}_10.jpg` : item.artUrl || "";
    const artistBioPicUrl = extractArtistBioPicUrl(subHtml, tralbum, globalArtistBioPicUrl);
    const { extraImages, extraPhotos } = extractExtraPhotosWithTitles(subHtml, artUrl, artistBioPicUrl);
    const allImages = extraImages;
    const aboutMatch = subHtml.match(/class="[^"]*tralbum-about[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || subHtml.match(/class="[^"]*track_story[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const creditsMatch = subHtml.match(/class="[^"]*tralbum-credits[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const licenseMatch = subHtml.match(/<div[^>]*id="license"[^>]*>([\s\S]*?)<\/div>/i) || subHtml.match(/<div[^>]*class="[^"]*license[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const lyricsDivMatch = subHtml.match(/class="[^"]*lyricsText[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const fromAlbumMatch = subHtml.match(/from\s+the\s+album\s*<a[^>]*>([^<]+)<\/a>/i) || subHtml.match(/class="[^"]*albumTitle[^"]*"[^>]*>([^<]+)</i);
    const fromAlbumTitle = tralbum?.album_title || tralbum?.current?.album_title || cleanHtmlText(fromAlbumMatch?.[1]);
    const firstTrackAbout = tralbum?.trackinfo?.[0]?.about ? cleanHtmlText(tralbum.trackinfo[0].about) : "";
    const firstTrackCredits = tralbum?.trackinfo?.[0]?.credits ? cleanHtmlText(tralbum.trackinfo[0].credits) : "";
    const aboutText = cleanHtmlText(current?.about) || cleanHtmlText(tralbum?.about) || firstTrackAbout || cleanHtmlText(aboutMatch?.[1]);
    const creditsText = cleanHtmlText(current?.credits) || cleanHtmlText(tralbum?.credits) || firstTrackCredits || cleanHtmlText(creditsMatch?.[1]);
    const licenseText = cleanHtmlText(licenseMatch?.[1]);
    const pageLyrics = cleanHtmlText(lyricsDivMatch?.[1]);
    let tagsMatches = tralbum?.tags && Array.isArray(tralbum.tags) && tralbum.tags.length > 0 ? tralbum.tags : Array.from(subHtml.matchAll(/<a[^>]*class="tag"[^>]*>([^<]+)<\/a>/gi)).map((tm) => cleanHtmlText(tm[1]));
    tagsMatches = Array.from(new Set(tagsMatches)).filter(Boolean);
    const albumArtistMatch = subHtml.match(/class="albumTitle"[^>]*>[\s\S]*?<span[^>]*class="artist"[^>]*>[\s\S]*?by\s*<a[^>]*>([^<]+)<\/a>/i) || subHtml.match(/<h3 class="albumTitle"[^>]*>[\s\S]*?<span>by\s*<a[^>]*>([^<]+)<\/a>/i) || subHtml.match(/<h3 class="albumTitle"[^>]*>[\s\S]*?by\s*<span>\s*<a[^>]*>([^<]+)<\/a>/i) || subHtml.match(/by\s+<span itemprop="byArtist">[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    const artistElMatch = albumArtistMatch || subHtml.match(/#band-name-location[^>]*class="title"[^>]*>([^<]+)/i) || subHtml.match(/<span[^>]*class="title"[^>]*>([^<]+)<\/span>/i) || subHtml.match(/<span\s+class="artist"[^>]*>([^<]+)<\/span>/i) || subHtml.match(/property="og:site_name"[^>]*content="([^"]+)"/i);
    const artist = cleanHtmlText(
      current?.artist || tralbum?.artist || tralbum?.band?.name || artistElMatch?.[1] || fallbackArtist
    );
    const dateMetaMatch = subHtml.match(/itemprop="datePublished"[^>]*content="([^"]+)"/i) || subHtml.match(/class="released"[^>]*>[\s\S]*?released\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i) || subHtml.match(/property="music:release_date"[^>]*content="([^"]+)"/i);
    const rawDate = current?.release_date || current?.publish_date || tralbum?.album_release_date || dateMetaMatch?.[1];
    const dotDate = formatDateToDotString(rawDate);
    let humanDate = void 0;
    if (rawDate) {
      try {
        const d = new Date(String(rawDate).replace(/released\s+/i, "").trim());
        if (!isNaN(d.getTime())) {
          humanDate = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        }
      } catch (e) {
      }
    }
    if (!humanDate && dotDate) {
      humanDate = dotDate;
    }
    const releaseTitle = cleanHtmlText(current?.title || item.title);
    const formatDuration = (sec) => {
      if (!sec) return "";
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return ` (${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")})`;
    };
    const trackListFormatted = audioStreams.length > 0 ? audioStreams.map((s) => `${s.trackNum}. ${s.title}${formatDuration(s.duration)}`) : ["1. " + releaseTitle];
    const tracksWithLyrics = audioStreams.filter((s) => s.lyrics && s.lyrics.trim().length > 0);
    let lyricsBlock = "";
    if (tracksWithLyrics.length > 0) {
      lyricsBlock = `================================================================================
LYRICS
================================================================================
(Track lyrics are also saved as separate .lrc files inside info ZIP)

` + tracksWithLyrics.map((t) => `--- Track ${t.trackNum}: ${t.title} ---
${t.lyrics}
`).join("\n") + "\n";
    } else if (pageLyrics) {
      lyricsBlock = `================================================================================
LYRICS
================================================================================
${pageLyrics}

`;
    }
    const divider = "=".repeat(80);
    let infoText = `${divider}
${releaseTitle.toUpperCase()} by ${artist}
${divider}
`;
    infoText += `Release Date : ${humanDate || "Unknown"}${dotDate && humanDate !== dotDate ? ` (${dotDate})` : ""}
`;
    infoText += `Type         : ${item.type.toUpperCase()}
`;
    if (fromAlbumTitle) {
      infoText += `From Album   : ${fromAlbumTitle}
`;
    }
    infoText += `Status       : ${priceFormatted}${isPaid ? " (Paid release - Audio skipped unless purchased. Artwork, photos & info bundled)" : ""}
`;
    infoText += `Bandcamp URL : ${item.url}
`;
    infoText += `Artist Page  : ${origin}

`;
    if (trackListFormatted.length > 0) {
      infoText += `${divider}
TRACKLIST (${trackListFormatted.length} Track${trackListFormatted.length > 1 ? "s" : ""})
${divider}
${trackListFormatted.join("\n")}

`;
    }
    if (aboutText) {
      infoText += `${divider}
LINER NOTES / ABOUT
${divider}
${aboutText}

`;
    }
    if (creditsText) {
      infoText += `${divider}
CREDITS
${divider}
${creditsText}

`;
    }
    if (licenseText) {
      infoText += `${divider}
LICENSE
${divider}
${licenseText}

`;
    }
    if (tagsMatches.length > 0) {
      infoText += `${divider}
TAGS & GENRES
${divider}
${tagsMatches.join(", ")}

`;
    }
    if (lyricsBlock) {
      infoText += lyricsBlock;
    }
    infoText += `${divider}
Downloaded with Bandcamp Free & NYP Bulk Downloader
${divider}
`;
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
      badgeType,
      minPrice,
      priceFormatted,
      requireEmail,
      freeDlPage: freeDlPage || void 0,
      trackListFormatted,
      audioStreams,
      aboutText,
      creditsText,
      licenseText,
      tagsMatches,
      infoText,
      fromAlbumTitle
    };
  }
  async function resolveBandcampDownload(downloadPageUrl, requestedFormat = "flac") {
    try {
      if (!downloadPageUrl || typeof downloadPageUrl !== "string" || !downloadPageUrl.trim()) {
        return {
          success: false,
          error: "Valid download page URL is required"
        };
      }
      const cleanUrl = downloadPageUrl.replace(/&amp;/g, "&").trim();
      if (!cleanUrl.startsWith("http")) {
        return {
          success: false,
          error: "Invalid download page URL protocol"
        };
      }
      if (cleanUrl.includes("bcbits.com/download/") || cleanUrl.includes("popplers")) {
        debugLog("resolver", "cleanUrl is already a direct bcbits download URL:", cleanUrl);
        return {
          success: true,
          downloadUrl: cleanUrl,
          format: requestedFormat,
          isArchive: cleanUrl.includes("/album/"),
          itemType: cleanUrl.includes("/album/") ? "album" : "track"
        };
      }
      debugLog("resolver", "Fetching Bandcamp download page:", cleanUrl);
      const dlRes = await fetch(cleanUrl, {
        headers: {
          ...BANDCAMP_FETCH_HEADERS,
          Referer: cleanUrl
        }
      });
      if (!dlRes.ok) throw new Error(`Download page HTTP ${dlRes.status}`);
      let cookieHeader = "";
      if (typeof dlRes.headers.getSetCookie === "function") {
        const cookies = dlRes.headers.getSetCookie();
        if (Array.isArray(cookies) && cookies.length > 0) {
          cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
        }
      } else {
        const sc = dlRes.headers.get("set-cookie");
        if (sc) cookieHeader = sc.split(";")[0];
      }
      const dlHtml = await dlRes.text();
      if (dlHtml.includes("<title>Client Challenge</title>") || dlHtml.includes("_fs-ch-")) {
        debugLog("resolver", "Bandcamp Cloudflare Bot Challenge triggered on server IP.");
        return {
          success: false,
          error: "Bandcamp Cloudflare Bot Challenge active on datacenter IP. Please use the Chrome Extension to download this email-walled release directly via your local browser session."
        };
      }
      const bcbitsMatches = Array.from(
        dlHtml.matchAll(/https?:\/\/[a-z0-9.]*bcbits\.com\/download\/(?:album|track)\/[^\s"'<>]+/gi)
      ).map((m) => m[0].replace(/&amp;/g, "&"));
      let directFormatUrl = "";
      if (bcbitsMatches.length > 0) {
        debugLog("resolver", `Found ${bcbitsMatches.length} direct bcbits download link(s) in HTML:`, bcbitsMatches);
        const matchForFormat = bcbitsMatches.find((u) => u.toLowerCase().includes(`/${requestedFormat.toLowerCase()}/`)) || bcbitsMatches.find((u) => u.toLowerCase().includes(requestedFormat.toLowerCase())) || bcbitsMatches.find((u) => u.toLowerCase().includes("/flac/")) || bcbitsMatches.find((u) => u.toLowerCase().includes("/mp3-320/")) || bcbitsMatches[0];
        if (matchForFormat) {
          directFormatUrl = matchForFormat;
        }
      }
      let blob = null;
      const blobRegexes = [
        /data-blob=["']([\s\S]*?)["']\s*(?:>|class|id)/i,
        /id=["']pagedata["'][^>]*data-blob=["']([\s\S]*?)["']/i,
        /<div[^>]*data-blob=["']([\s\S]*?)["']/i,
        /data-blob="([^"]+)"/i,
        /data-blob='([^']+)'/i,
        /var\s+pagedata\s*=\s*(\{[\s\S]*?\})\s*;/i,
        /window\.pagedata\s*=\s*(\{[\s\S]*?\})\s*;/i
      ];
      for (const rx of blobRegexes) {
        const m = dlHtml.match(rx);
        if (m && m[1]) {
          try {
            const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
            blob = JSON.parse(decoded);
            if (blob && (blob.digital_items || blob.downloads)) break;
          } catch (e) {
          }
        }
      }
      if (!blob) {
        const diMatch = dlHtml.match(/\{[\s\S]*?"digital_items"\s*:\s*\[[\s\S]*?\}\s*;/);
        if (diMatch) {
          try {
            blob = JSON.parse(diMatch[0].replace(/;\s*$/, ""));
          } catch (e) {
          }
        }
      }
      const digitalItem = blob?.digital_items?.[0] || blob;
      const downloads = digitalItem?.downloads;
      if (!downloads && directFormatUrl) {
        debugLog("resolver", "Resolved via direct HTML bcbits link:", directFormatUrl);
        const titleFromHtml = cleanHtmlText(dlHtml.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\|\s*Bandcamp/i, ""));
        return {
          success: true,
          downloadUrl: directFormatUrl,
          format: requestedFormat,
          description: requestedFormat.toUpperCase(),
          isArchive: directFormatUrl.includes("/album/"),
          itemType: directFormatUrl.includes("/album/") ? "album" : "track",
          title: titleFromHtml || "Album",
          artist: "Artist"
        };
      }
      if (!downloads) {
        throw new Error("No download links or data-blob found on download page. Please verify that the download link is active.");
      }
      const itemType = digitalItem.item_type || digitalItem.type || "album";
      const releaseTitle = cleanHtmlText(digitalItem.title);
      const releaseArtist = cleanHtmlText(digitalItem.artist);
      const target = downloads[requestedFormat] || downloads["flac"] || downloads["mp3-320"] || downloads["mp3-v0"] || downloads["wav"] || Object.values(downloads)[0];
      if (!target?.url) {
        if (directFormatUrl) {
          return {
            success: true,
            downloadUrl: directFormatUrl,
            format: requestedFormat,
            description: requestedFormat.toUpperCase(),
            isArchive: directFormatUrl.includes("/album/"),
            itemType,
            title: releaseTitle,
            artist: releaseArtist
          };
        }
        throw new Error("No target download URL available");
      }
      let finalUrl = "";
      try {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const directCheck = await fetch(target.url, {
          method: "GET",
          headers: {
            ...BANDCAMP_FETCH_HEADERS,
            Referer: cleanUrl,
            ...cookieHeader ? { Cookie: cookieHeader } : {}
          },
          redirect: "manual",
          signal: controller ? controller.signal : void 0
        });
        const contentType = (directCheck.headers.get("content-type") || "").toLowerCase();
        if ([301, 302, 303, 307, 308].includes(directCheck.status)) {
          const loc = directCheck.headers.get("location");
          if (loc) {
            finalUrl = loc.startsWith("http") ? loc : loc.startsWith("//") ? `https:${loc}` : `https://${loc}`;
          }
        } else if (directCheck.status === 200 && (contentType.includes("application/zip") || contentType.includes("application/octet-stream") || contentType.includes("audio/"))) {
          finalUrl = target.url;
        }
        if (controller) {
          controller.abort();
        }
      } catch (e) {
      }
      async function callStat(urlToStat) {
        try {
          if (!urlToStat) return null;
          const fullUrl = urlToStat.startsWith("//") ? `https:${urlToStat}` : urlToStat.startsWith("http") ? urlToStat : `https://${urlToStat}`;
          const parsed = new URL(fullUrl);
          parsed.pathname = parsed.pathname.replace("/download/", "/statdownload/");
          parsed.searchParams.set(".rand", String(Math.floor(Math.random() * 1e6)));
          parsed.searchParams.set(".vrs", "1");
          const statUrl = parsed.toString();
          const res = await fetch(statUrl, {
            method: "GET",
            headers: {
              ...BANDCAMP_FETCH_HEADERS,
              Referer: cleanUrl,
              ...cookieHeader ? { Cookie: cookieHeader } : {}
            }
          });
          if (!res.ok) return null;
          const text = await res.text();
          const jsonMatch = text.match(/Downloads\.statResult\s*\(\s*(\{[\s\S]*?\})\s*\)/);
          if (jsonMatch) return JSON.parse(jsonMatch[1]);
          try {
            return JSON.parse(text);
          } catch (pe) {
          }
        } catch (e) {
          console.warn("callStat error:", e);
        }
        return null;
      }
      if (!finalUrl) {
        let attempts = 0;
        const maxAttempts = 45;
        let nextStatUrl = target.url;
        let lastStat = null;
        while (attempts < maxAttempts) {
          attempts++;
          const stat = await callStat(nextStatUrl);
          if (stat) {
            lastStat = stat;
            if (stat.result === "ok" && stat.download_url) {
              debugLog("resolver", `Statdownload ready on attempt ${attempts}:`, stat.download_url);
              finalUrl = stat.download_url.startsWith("http") ? stat.download_url : stat.download_url.startsWith("//") ? `https:${stat.download_url}` : `https://${stat.download_url}`;
              break;
            }
            if (stat.result === "err") {
              debugLog("resolver", `Statdownload error on attempt ${attempts}:`, stat);
              break;
            }
            if (stat.result === "busy") {
              debugLog("resolver", `Statdownload busy (attempt ${attempts}/${maxAttempts}), waiting 2s...`);
            }
            if (stat.retry_url) {
              nextStatUrl = stat.retry_url.startsWith("http") ? stat.retry_url : stat.retry_url.startsWith("//") ? `https:${stat.retry_url}` : `https://${stat.retry_url}`;
            }
          }
          await new Promise((r) => setTimeout(r, 2e3));
        }
        if (!finalUrl && lastStat?.download_url) {
          finalUrl = lastStat.download_url;
        }
      }
      if (!finalUrl && directFormatUrl) {
        finalUrl = directFormatUrl;
      }
      if (!finalUrl) {
        try {
          const retryCheck = await fetch(target.url, {
            method: "GET",
            headers: {
              ...BANDCAMP_FETCH_HEADERS,
              Referer: cleanUrl,
              ...cookieHeader ? { Cookie: cookieHeader } : {}
            },
            redirect: "manual"
          });
          if ([301, 302, 303, 307, 308].includes(retryCheck.status)) {
            const loc = retryCheck.headers.get("location");
            if (loc) finalUrl = loc;
          }
        } catch (e) {
        }
      }
      if (!finalUrl) {
        throw new Error(
          "Archive preparation timed out on Bandcamp server. Please retry."
        );
      }
      const isArchive = itemType === "album" || target.url.includes("/album?") || target.url.includes("type=album") || target.encoding_name === "zip" || finalUrl.includes("/album?") || finalUrl.includes(".zip");
      return {
        success: true,
        downloadUrl: finalUrl,
        format: target.encoding_name || requestedFormat,
        description: target.description,
        sizeMb: target.size_mb,
        isArchive,
        itemType,
        title: releaseTitle,
        artist: releaseArtist
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }
  function formatFilenameBySchema(schema, meta, options = { allowSubfolders: false }) {
    const template = schema || "%artist% - %date% - %album%[%title%.%format%]";
    const isArchive = meta.isArchive || meta.type === "album" && meta.format === "zip";
    const isSingleTrackRelease = meta.type === "track" && (meta.album === meta.title || !meta.album || (meta.totalTracks || 1) <= 1);
    const clean = (s) => {
      if (!s) return "";
      let res = s.replace(/[:*?"<>|\\/]/g, "_").trim();
      if (!options.allowSubfolders) {
        res = res.replace(/[\\/]/g, "_");
      }
      return res;
    };
    const total = meta.totalTracks || 1;
    const padLen = Math.max(2, String(total).length);
    const trackNumStr = !isArchive && total > 1 && meta.trackNum != null ? String(meta.trackNum).padStart(padLen, "0") : "";
    const rawDate = meta.date || meta.year || "2026.01.01";
    let dateStr = "2026.01.01";
    try {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
      }
    } catch (e) {
    }
    const yearStr = dateStr.slice(0, 4);
    const defaultExt = isArchive ? "zip" : (meta.format || "flac").replace(/[^a-zA-Z0-9]/g, "");
    const titleVal = isArchive || isSingleTrackRelease ? "" : clean(meta.title || "");
    const values = {
      "%artist%": clean(meta.artist || "Bandcamp"),
      "%album%": clean(meta.album || meta.title || "Album"),
      "%title%": titleVal,
      "%track_num%": trackNumStr,
      "%date%": dateStr,
      "%year%": yearStr,
      "%format%": defaultExt,
      "%type%": clean(meta.type || "album")
    };
    const ESC_OPEN = "\uE000";
    const ESC_CLOSE = "\uE001";
    let str = template.replace(/\\\[/g, ESC_OPEN).replace(/\\\]/g, ESC_CLOSE);
    const bracketRegex = /\[([^\[\]]*)\]/;
    while (bracketRegex.test(str)) {
      str = str.replace(bracketRegex, (_, inner) => {
        const tokens = inner.match(/%[a-zA-Z0-9_]+%/g);
        if (!tokens || tokens.length === 0) return inner;
        const allValid = tokens.every((token) => {
          const val = values[token.toLowerCase()];
          return val != null && String(val).trim() !== "";
        });
        return allValid ? inner : "";
      });
    }
    str = str.replace(new RegExp(ESC_OPEN, "g"), "[").replace(new RegExp(ESC_CLOSE, "g"), "]");
    for (const [token, val] of Object.entries(values)) {
      str = str.replace(new RegExp(token, "gi"), val);
    }
    let result = str.replace(/[\[\]]/g, "").replace(/\s+/g, " ").replace(/\s*-\s*-\s*/g, " - ").replace(/\s*-\s*\./g, ".").replace(/\.{2,}/g, ".").trim();
    if (!result.toLowerCase().endsWith("." + defaultExt)) {
      result = `${result}.${defaultExt}`;
    }
    return result;
  }
  function getCompanionInfoZipName(audioFilename) {
    const lastDot = audioFilename.lastIndexOf(".");
    if (lastDot > 0) {
      const base = audioFilename.slice(0, lastDot);
      return `${base} (info).zip`;
    }
    return `${audioFilename} (info).zip`;
  }
  return __toCommonJS(bandcampCore_exports);
})();

if (typeof self !== 'undefined') { Object.assign(self, BandcampCore); }
if (typeof window !== 'undefined') { Object.assign(window, BandcampCore); }
if (typeof globalThis !== 'undefined') { Object.assign(globalThis, BandcampCore); }

