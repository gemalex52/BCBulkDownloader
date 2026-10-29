export interface TrackAudioStream {
  trackNum: number;
  title: string;
  streamUrl?: string;
  duration?: number;
  lyrics?: string;
}

export interface ScannedRelease {
  id: string;
  itemId: number;
  itemType: 'album' | 'track';
  title: string;
  artist: string;
  artistUrl: string;
  url: string;
  artUrl: string;
  extraImages?: string[];
  releaseDate?: string;
  isoDate?: string;
  isFree: boolean;
  isNameYourPrice: boolean;
  isPurchased?: boolean;
  minPrice: number;
  currency: string;
  priceFormatted: string;
  requiresEmail: boolean;
  freeDownloadPageUrl?: string;
  trackCount?: number;
  trackList?: string[];
  audioStreams?: TrackAudioStream[];
  aboutText?: string;
  creditsText?: string;
  infoText?: string;
  description?: string;
  tags?: string[];
  selected?: boolean;
}

export interface AudioFormat {
  id: string;
  name: string;
  ext: string;
  desc: string;
  approxMbPerTrack: number;
}

export const AUDIO_FORMATS: AudioFormat[] = [
  { id: 'flac', name: 'FLAC (Lossless)', ext: 'flac', desc: 'True lossless audio compression, studio master quality (Default)', approxMbPerTrack: 35 },
  { id: 'mp3-320', name: 'MP3 320k', ext: 'mp3', desc: 'Highest MP3 quality (320kbps CBR), universal playback', approxMbPerTrack: 10 },
  { id: 'mp3-v0', name: 'MP3 V0 (VBR)', ext: 'mp3', desc: 'Variable bit-rate (approx 245kbps), optimal size/quality', approxMbPerTrack: 7 },
  { id: 'wav', name: 'WAV 16-bit', ext: 'wav', desc: 'Uncompressed linear PCM audio', approxMbPerTrack: 50 },
  { id: 'aac-hi', name: 'AAC (VBR)', ext: 'm4a', desc: 'High bit-rate AAC, native for Apple devices', approxMbPerTrack: 9 },
  { id: 'alac', name: 'ALAC', ext: 'm4a', desc: 'Apple Lossless Audio Codec', approxMbPerTrack: 35 },
  { id: 'aiff-lossless', name: 'AIFF', ext: 'aiff', desc: 'Uncompressed audio format', approxMbPerTrack: 50 },
];

export type DeliveryMode = 'zip' | 'individual';

export interface DownloadTask {
  id: string;
  releaseId: string;
  releaseTitle: string;
  artist: string;
  artUrl: string;
  format: string;
  status: 'queued' | 'resolving' | 'downloading' | 'zipping' | 'completed' | 'error';
  progress: number;
  downloadUrl?: string;
  fileSizeMb?: number;
  error?: string;
}

export interface AppSettings {
  fallbackEmail: string;
  preferredFormat: string;
  deliveryMode: DeliveryMode;
  concurrentDownloads: number;
  skipEmailRequired: boolean;
  skipAlbumTrackSubpages: boolean;
  namingSchema: string;
}

export function formatDateToDotString(raw?: string): string {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}.${mm}.${dd}`;
    }
  } catch (e) {}
  return String(raw).replace(/[^0-9.]/g, '');
}

export function processConditionalBrackets(
  template: string,
  values: Record<string, string>
): string {
  const ESC_OPEN = '\uE000';
  const ESC_CLOSE = '\uE001';

  // Protect escaped brackets \[ and \]
  let str = template
    .replace(/\\\[/g, ESC_OPEN)
    .replace(/\\\]/g, ESC_CLOSE);

  // Iteratively process innermost [ ... ] groups
  const bracketRegex = /\[([^\[\]]*)\]/;
  while (bracketRegex.test(str)) {
    str = str.replace(bracketRegex, (_, inner) => {
      const tokens = inner.match(/%[a-zA-Z0-9_]+%/g);
      if (!tokens || tokens.length === 0) {
        return inner;
      }
      // Bracket is kept only if all referenced meta tokens are valid/non-empty
      const allValid = tokens.every((token: string) => {
        const val = values[token.toLowerCase()];
        return val != null && String(val).trim() !== '';
      });
      return allValid ? inner : '';
    });
  }

  // Restore escaped brackets as literals
  return str
    .replace(new RegExp(ESC_OPEN, 'g'), '[')
    .replace(new RegExp(ESC_CLOSE, 'g'), ']');
}

export function formatFilenameBySchema(
  schema: string,
  meta: {
    artist: string;
    album: string;
    title: string;
    trackNum?: number | string;
    totalTracks?: number;
    year?: string | number;
    date?: string;
    format: string;
    type?: string;
  },
  options: {
    allowSubfolders?: boolean;
  } = {}
): string {
  const allowSubfolders = options.allowSubfolders ?? false;
  const template = schema || '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%';

  // Track number logic:
  // - Empty for single-track releases
  // - Zero-padded to total tracks count for multitrack releases
  let trackNumStr = '';
  const total = meta.totalTracks ?? (meta.type === 'track' ? 1 : 2);
  if (total > 1 && meta.trackNum != null && meta.trackNum !== '') {
    const padLen = Math.max(2, String(total).length);
    trackNumStr = String(meta.trackNum).padStart(padLen, '0');
  }

  // Format full release date (e.g. 2026.10.31) and year (e.g. 2026)
  const fullDate = formatDateToDotString(meta.date || (meta.year ? String(meta.year) : ''));
  const yearStr = fullDate ? fullDate.slice(0, 4) : String(meta.year || new Date().getFullYear());

  const sanitizeSegment = (s: string) =>
    String(s || '').replace(/[:*?"<>|]/g, '_').trim();

  const values: Record<string, string> = {
    '%artist%': sanitizeSegment(meta.artist || 'Bandcamp'),
    '%album%': sanitizeSegment(meta.album || meta.title || 'Album'),
    '%title%': sanitizeSegment(meta.title || 'Track'),
    '%track_num%': trackNumStr,
    '%date%': fullDate || yearStr,
    '%year%': yearStr,
    '%format%': (meta.format || 'flac').replace(/[^a-zA-Z0-9]/g, ''),
    '%type%': sanitizeSegment(meta.type || 'track'),
  };

  // Evaluate conditional brackets [ ... ]
  let formatted = processConditionalBrackets(template, values);

  // Substitute meta tokens
  for (const [token, val] of Object.entries(values)) {
    const re = new RegExp(token, 'gi');
    formatted = formatted.replace(re, val);
  }

  // Clean up double separators if tokens were empty
  formatted = formatted
    .replace(/\s*[-_]\s*[-_]\s*/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\/\s*-\s*/g, '/')
    .replace(/\s*-\s*\//g, '/');

  // Handle slashes for subfolders
  if (allowSubfolders) {
    formatted = formatted
      .replace(/\\/g, '/')
      .split('/')
      .map(part => part.replace(/[:*?"<>|]/g, '_').trim())
      .filter(Boolean)
      .join('/');
  } else {
    // Replace / and \ with hyphen for individual file downloads
    formatted = formatted
      .replace(/[\\/]/g, ' - ')
      .replace(/\s*-\s*-\s*/g, ' - ')
      .trim();
  }

  // Determine standard file extension
  let ext = (meta.format || 'flac').toLowerCase().trim();
  if (ext.startsWith('mp3')) ext = 'mp3';
  else if (ext === 'aac-hi' || ext === 'alac') ext = 'm4a';
  else if (ext === 'aiff-lossless') ext = 'aiff';
  else if (ext === 'wav') ext = 'wav';
  else if (ext === 'flac') ext = 'flac';

  if (!formatted.toLowerCase().endsWith('.' + ext)) {
    formatted = `${formatted}.${ext}`;
  }

  return formatted;
}

export interface ExtensionFileItem {
  name: string;
  path: string;
  language: 'json' | 'javascript' | 'html' | 'css' | 'markdown';
  description: string;
  content: string;
  binaryBuffer?: Uint8Array;
}
