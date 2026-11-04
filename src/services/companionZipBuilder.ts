import JSZip from 'jszip';
import { QueueItem, ScannedRelease, TrackAudioStream } from '../types/bandcamp';

export interface CompanionZipOptions {
  release: ScannedRelease | QueueItem;
  infoText?: string;
  artUrl?: string;
  artistBioPicUrl?: string;
  extraImages?: string[];
  audioStreams?: TrackAudioStream[];
  proxyFetch?: (url: string) => Promise<Response>;
}

export async function buildCompanionInfoZip(options: CompanionZipOptions): Promise<{
  blob: Blob;
  sizeBytes: number;
  filesCount: number;
}> {
  const { release, infoText, artUrl, artistBioPicUrl, extraImages, audioStreams, proxyFetch } = options;
  const zip = new JSZip();
  let filesCount = 0;

  // Default fetch handler (uses proxy to avoid CORS when available)
  const doFetch = proxyFetch || (async (u: string) => {
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
  const targetArt = artUrl || release.artUrl;
  if (targetArt) {
    try {
      const artRes = await doFetch(targetArt);
      if (artRes.ok) {
        const artBuf = await artRes.arrayBuffer();
        zip.file('cover.jpg', artBuf);
        filesCount++;
      }
    } catch (e) {
      console.warn('Failed fetching cover.jpg for info zip:', e);
    }
  }

  // 3. artist.jpg: Bandcamp bio_pic image
  const targetBio = artistBioPicUrl || (release as any).artistBioPicUrl;
  if (targetBio) {
    try {
      const bioRes = await doFetch(targetBio);
      if (bioRes.ok) {
        const bioBuf = await bioRes.arrayBuffer();
        zip.file('artist.jpg', bioBuf);
        filesCount++;
      }
    } catch (e) {
      console.warn('Failed fetching artist.jpg for info zip:', e);
    }
  }

  // 4. photos/: Additional CD/LP and gatefold packaging photos
  const targetPhotos = extraImages || release.extraImages || [];
  if (targetPhotos.length > 0) {
    for (let i = 0; i < targetPhotos.length; i++) {
      try {
        const pRes = await doFetch(targetPhotos[i]);
        if (pRes.ok) {
          const pBuf = await pRes.arrayBuffer();
          zip.file(`photos/photo_${i + 1}.jpg`, pBuf);
          filesCount++;
        }
      } catch (e) {}
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
