import { ScannedRelease } from '../types/bandcamp';

export interface ParsedListEntry {
  raw: string;
  cleaned: string;
  artist: string;
  date: string;
  album: string;
}

export interface MatchedReleaseItem {
  release: ScannedRelease;
  matchedLine: string;
  entry: ParsedListEntry;
  matchType: 'exact' | 'high' | 'partial';
  reason: string;
  selected: boolean; // whether this item should be applied (user can toggle in preview)
}

/**
 * Normalizes a string for lenient comparison across diacritics, typography, case, and punctuation
 */
export function normalizeForMatching(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics / accents
    .toLowerCase()
    .replace(/["'“”‘’`]/g, '') // remove quotes/apostrophes
    .replace(/[-–—_]/g, ' ') // convert hyphens & underscores to space
    .replace(/[^\w\s]/g, '') // remove remaining punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses a single line representing a downloaded file, folder, or archive
 * Supporting rough format: %artist% - [%date% - ]%album% (with [%date% - ] optional)
 */
export function parseFileLine(line: string): ParsedListEntry | null {
  if (!line || !line.trim()) return null;

  let cleaned = line.trim();

  // 1. Strip path prefixes (e.g. "D:\Music\" or "/Volumes/Audio/")
  const lastSlash = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  if (lastSlash !== -1) {
    cleaned = cleaned.substring(lastSlash + 1).trim();
  }

  // 2. Strip leading numbers or bullets (e.g. "1. ", "01 - ", "[01] ")
  cleaned = cleaned.replace(/^\[?\d+\]?[.\s\-_]+/, '').trim();

  // 3. Strip surrounding quotes
  cleaned = cleaned.replace(/^["'“”]/, '').replace(/["'”]$/, '').trim();

  // 4. Strip common file extensions
  cleaned = cleaned.replace(/\.(zip|flac|mp3|rar|7z|tar|gz|wav|aiff|m4a|ogg|opus|aac|wma)$/i, '').trim();

  // 5. Strip trailing archive / packaging descriptors
  cleaned = cleaned
    .replace(/\s*\(info\)$/i, '')
    .replace(/\s*\[info\]$/i, '')
    .replace(/\s*\[(flac|mp3|24[- ]?96|16[- ]?44|320|v0|lossless|cd|vinyl)[^\]]*\]/gi, '')
    .replace(/\s*\((flac|mp3|24[- ]?96|16[- ]?44|320|v0|lossless|cd|vinyl)[^)]*\)/gi, '')
    .trim();

  // 6. Split on dash delimiter: " - ", " – ", " — "
  const parts = cleaned.split(/\s*[-–—]\s*/);
  let artist = '';
  let date = '';
  let album = '';

  if (parts.length >= 3) {
    // Check if parts[1] is a date / year / timestamp
    const datePattern = /^\d{4}(?:[.-/]\d{1,2}(?:[.-/]\d{1,2})?)?$/;
    const isNumericDate = datePattern.test(parts[1]) || /^\d{6,8}$/.test(parts[1]);

    if (isNumericDate) {
      artist = parts[0];
      date = parts[1];
      album = parts.slice(2).join(' - ');
    } else {
      artist = parts[0];
      album = parts.slice(1).join(' - ');
    }
  } else if (parts.length === 2) {
    artist = parts[0];
    album = parts[1];
  } else if (parts.length === 1) {
    album = parts[0];
  }

  // Strip trailing parenthetical date from album if present: "Album Name (2020)" -> "Album Name"
  album = album.replace(/\s*\(\d{4}(?:[.-/]\d{1,2}(?:[.-/]\d{1,2})?)?\)$/, '').trim();

  return {
    raw: line,
    cleaned,
    artist: artist.trim(),
    date: date.trim(),
    album: album.trim(),
  };
}

/**
 * Cross-references a list of lines against the currently scanned releases
 */
export function matchPastedListAgainstReleases(
  text: string,
  releases: ScannedRelease[]
): {
  matches: MatchedReleaseItem[];
  totalLines: number;
  validParsedLines: number;
  unmatchedReleasesCount: number;
} {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const matchedMap = new Map<string, MatchedReleaseItem>();
  let validParsed = 0;

  for (const rawLine of lines) {
    const entry = parseFileLine(rawLine);
    if (!entry || (!entry.album && !entry.artist)) continue;
    validParsed++;

    const normParsedAlbum = normalizeForMatching(entry.album);
    const normParsedArtist = normalizeForMatching(entry.artist);
    const normLine = normalizeForMatching(rawLine);

    for (const rel of releases) {
      if (matchedMap.has(rel.id)) continue;

      const normRelTitle = normalizeForMatching(rel.title);
      const normRelArtist = normalizeForMatching(rel.artist);

      let matched = false;
      let matchType: 'exact' | 'high' | 'partial' = 'partial';
      let reason = '';

      // Check 1: Exact match on both artist and album title
      if (normParsedArtist && normParsedAlbum && normParsedArtist === normRelArtist && normParsedAlbum === normRelTitle) {
        matched = true;
        matchType = 'exact';
        reason = `Exact match: "${entry.artist}" - "${entry.album}"`;
      }
      // Check 2: Album title matches exactly, and parsed artist is either empty or consistent with release artist
      else if (
        normParsedAlbum &&
        normParsedAlbum === normRelTitle &&
        (!normParsedArtist || normRelArtist.includes(normParsedArtist) || normParsedArtist.includes(normRelArtist))
      ) {
        matched = true;
        matchType = 'high';
        reason = `Album title matched: "${entry.album}"`;
      }
      // Check 3: Raw line contains both normalized artist and release title
      else if (normLine.includes(normRelTitle) && (!normRelArtist || normLine.includes(normRelArtist))) {
        matched = true;
        matchType = 'high';
        reason = `Full line matched release title "${rel.title}"`;
      }
      // Check 4: Prefix / Substring match for releases with lengthy subtitles
      else if (
        normParsedAlbum.length >= 6 &&
        normRelTitle.length >= 6 &&
        (normRelTitle.startsWith(normParsedAlbum) || normParsedAlbum.startsWith(normRelTitle)) &&
        (!normParsedArtist || normRelArtist.includes(normParsedArtist) || normParsedArtist.includes(normRelArtist))
      ) {
        matched = true;
        matchType = 'partial';
        reason = `Close title match: "${entry.album}" ≈ "${rel.title}"`;
      }

      if (matched) {
        matchedMap.set(rel.id, {
          release: rel,
          matchedLine: rawLine,
          entry,
          matchType,
          reason,
          selected: true,
        });
      }
    }
  }

  const matches = Array.from(matchedMap.values());
  return {
    matches,
    totalLines: lines.length,
    validParsedLines: validParsed,
    unmatchedReleasesCount: releases.length - matches.length,
  };
}
