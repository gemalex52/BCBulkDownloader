import JSZip from 'jszip';
import { QueueItem, ScannedRelease, TrackAudioStream, ExtraPhotoItem } from '../types/bandcamp';
import { isExtension, apiClient } from './unifiedClient';
import { extractImageNumericId, cleanPhotoSectionTitle } from './bandcampCore';

export interface CompanionZipOptions {
  release: ScannedRelease | QueueItem;
  infoText?: string;
  artUrl?: string;
  artistBioPicUrl?: string;
  extraImages?: string[];
  extraPhotos?: ExtraPhotoItem[];
  audioStreams?: TrackAudioStream[];
  proxyFetch?: (url: string) => Promise<Response>;
}

export async function buildCompanionInfoZip(options: CompanionZipOptions): Promise<{
  blob: Blob;
  sizeBytes: number;
  filesCount: number;
}> {
  const { release, infoText, artUrl, artistBioPicUrl, extraImages, extraPhotos, audioStreams, proxyFetch } = options;
  const zip = new JSZip();
  let filesCount = 0;

  // Default fetch handler (uses extension background RPC or proxy to avoid CORS)
  const doFetch = proxyFetch || (async (u: string) => {
    if (isExtension) {
      try {
        const b = await apiClient.fetchBinaryAsBlob(u);
        if (b) {
          return new Response(b);
        }
      } catch (e) {}
    }
    try {
      const pUrl = `/api/bandcamp/proxy-image?url=${encodeURIComponent(u)}`;
      const res = await fetch(pUrl);
      if (res.ok) return res;
    } catch (e) {}
    return fetch(u);
  });

  // 1. info.txt: Untruncated liner notes, credits, tracklist, and release info
  const finalInfo = infoText || release.infoText || `Title: ${release.title}\nArtist: ${release.artist}\nURL: ${release.url}\n`;
  zip.file('info.txt', finalInfo);
  filesCount++;

  // 2. cover.jpg: Hi-res artwork
  let coverBuf: ArrayBuffer | null = null;
  const targetArt = artUrl || release.artUrl;
  if (targetArt) {
    try {
      const artRes = await doFetch(targetArt);
      if (artRes.ok) {
        coverBuf = await artRes.arrayBuffer();
        zip.file('cover.jpg', coverBuf);
        filesCount++;
      }
    } catch (e) {
      console.warn('Failed fetching cover.jpg for info zip:', e);
    }
  }

  // 3. artist.jpg: Bandcamp bio_pic image
  let bioBuf: ArrayBuffer | null = null;
  const targetBio = artistBioPicUrl || (release as any).artistBioPicUrl;
  if (targetBio) {
    try {
      const bioRes = await doFetch(targetBio);
      if (bioRes.ok) {
        bioBuf = await bioRes.arrayBuffer();
        zip.file('artist.jpg', bioBuf);
        filesCount++;
      }
    } catch (e) {
      console.warn('Failed fetching artist.jpg for info zip:', e);
    }
  }

  // 4. photos/: Additional CD/LP and gatefold packaging photos
  // User requirements: Do not include duplicates of cover.jpg or artist.jpg,
  // and guess pic names from the HTML section (cleared of punctuation).
  const coverId = extractImageNumericId(targetArt);
  const bioId = extractImageNumericId(targetBio);
  const seenPhotoIds = new Set<string>();
  if (coverId) seenPhotoIds.add(coverId);
  if (bioId) seenPhotoIds.add(bioId);

  const photoCandidates: { url: string; title?: string }[] = [];
  const rawPhotos = extraPhotos || (release as any).extraPhotos;
  const rawImages = extraImages || release.extraImages || [];

  if (rawPhotos && Array.isArray(rawPhotos) && rawPhotos.length > 0) {
    for (const p of rawPhotos) {
      if (typeof p === 'string') {
        photoCandidates.push({ url: p });
      } else if (p && p.url) {
        photoCandidates.push(p);
      }
    }
  } else if (rawImages && Array.isArray(rawImages)) {
    for (const img of rawImages) {
      if (typeof img === 'string') {
        photoCandidates.push({ url: img });
      } else if (img && (img as any).url) {
        photoCandidates.push(img as any);
      }
    }
  }

  const usedFilenames = new Map<string, number>();

  function areBuffersIdentical(a: ArrayBuffer, b: ArrayBuffer): boolean {
    if (a.byteLength !== b.byteLength) return false;
    const viewA = new Uint8Array(a);
    const viewB = new Uint8Array(b);
    const sampleSize = Math.min(viewA.length, 1024);
    for (let i = 0; i < sampleSize; i++) {
      if (viewA[i] !== viewB[i]) return false;
    }
    return true;
  }

  if (photoCandidates.length > 0) {
    for (let i = 0; i < photoCandidates.length; i++) {
      const candidate = photoCandidates[i];
      const photoUrl = candidate.url;
      const photoId = extractImageNumericId(photoUrl);

      // Exclude if it's the cover, artist photo, or already processed
      if (photoId && seenPhotoIds.has(photoId)) {
        continue;
      }
      if (photoId) seenPhotoIds.add(photoId);

      try {
        const pRes = await doFetch(photoUrl);
        if (pRes.ok) {
          const pBuf = await pRes.arrayBuffer();

          // Byte-level duplicate safety net against cover and artist images
          if (coverBuf && areBuffersIdentical(pBuf, coverBuf)) {
            continue;
          }
          if (bioBuf && areBuffersIdentical(pBuf, bioBuf)) {
            continue;
          }

          let baseName = candidate.title ? cleanPhotoSectionTitle(candidate.title) : '';
          if (!baseName || /^package(\s+image)?$/i.test(baseName) || /^photo(\s+\d+)?$/i.test(baseName)) {
            baseName = `photo_${i + 1}`;
          }

          const lowerKey = baseName.toLowerCase();
          const count = (usedFilenames.get(lowerKey) || 0) + 1;
          usedFilenames.set(lowerKey, count);

          const finalPhotoName = count > 1 ? `${baseName} (${count}).jpg` : `${baseName}.jpg`;
          console.log(`[companionZipBuilder] Packaging photo ${i + 1}/${photoCandidates.length}: "${finalPhotoName}" (source title: "${candidate.title || ''}")`);
          zip.file(`photos/${finalPhotoName}`, pBuf);
          filesCount++;
        }
      } catch (e) {
        console.warn('Failed fetching photo for info zip:', e);
      }
    }
  }

  // 5. *.lrc: Synchronized or plain lyrics for tracks with lyrics
  const streams = audioStreams || (release as any).audioStreams || [];
  if (streams.length > 0) {
    for (const stream of streams) {
      if (stream.lyrics && stream.lyrics.trim().length > 0) {
        const total = streams.length;
        const padLen = Math.max(2, String(total).length);
        const trackNumPrefix = total > 1 ? `${String(stream.trackNum || 1).padStart(padLen, '0')}. ` : '';
        const cleanTitle = (stream.title || 'Track').replace(/[:*?"<>|/]/g, '_').trim();
        const lrcFilename = `${trackNumPrefix}${cleanTitle}.lrc`;

        const lrcContent = `[ti:${stream.title}]\n[ar:${release.artist}]\n[al:${release.title}]\n\n${stream.lyrics}\n`;
        zip.file(lrcFilename, lrcContent);
        filesCount++;
      }
    }
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    blob,
    sizeBytes: blob.size,
    filesCount,
  };
}
