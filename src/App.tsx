import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import {
  ScannedRelease,
  DownloadTask,
  AppSettings,
  DeliveryMode,
  AUDIO_FORMATS,
  formatFilenameBySchema,
} from './types/bandcamp';
import { Header } from './components/Header';
import { ScannerBar } from './components/ScannerBar';
import { ReleaseCatalog } from './components/ReleaseCatalog';
import { DownloadManager } from './components/DownloadManager';
import { ExtensionPackageCenter } from './components/ExtensionPackageCenter';
import { InstallGuide } from './components/InstallGuide';
import { SettingsView } from './components/SettingsView';
import { createExtensionZip } from './services/extensionPackage';

const DEFAULT_URL = 'https://esoctrilihum.bandcamp.com/music';
const SETTINGS_STORAGE_KEY = 'bc_app_settings';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'scanner' | 'extension' | 'guide' | 'settings'>('scanner');
  const [url, setUrl] = useState(DEFAULT_URL);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgressText, setScanProgressText] = useState('');
  const [releases, setReleases] = useState<ScannedRelease[]>([]);
  const [skipTrackSubpages, setSkipTrackSubpages] = useState(true);
  const [selectedFormat, setSelectedFormat] = useState('flac'); // Default to FLAC
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('zip'); // Default to ZIP
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [scanMeta, setScanMeta] = useState<{ source: string; timestamp?: string }>({ source: '', timestamp: '' });

  // Download Queue State
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);

  // App Settings with localStorage persistence
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {}
    return {
      fallbackEmail: 'listener@example.com',
      preferredFormat: 'flac',
      deliveryMode: 'zip',
      concurrentDownloads: 3,
      skipEmailRequired: false,
      skipAlbumTrackSubpages: true,
      namingSchema: '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%',
    };
  });

  // Sync settings to localStorage and format/mode states
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {}
  }, [settings]);

  const activeEventSourceRef = useRef<EventSource | null>(null);

  // Helper to load cached catalog from localStorage
  const loadFromLocalCache = (targetUrl: string): boolean => {
    try {
      const cacheKey = `bc_cache_v6_${encodeURIComponent(targetUrl.trim().toLowerCase())}`;
      const cachedRaw = localStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached.releases && Array.isArray(cached.releases) && cached.releases.length > 0) {
          setReleases(cached.releases);
          setScanMeta({
            source: 'local_cache',
            timestamp: new Date(cached.scannedAt).toLocaleTimeString(),
          });
          setScanProgressText(
            `Loaded ${cached.releases.length} releases from cache (${cached.releases.filter((r: ScannedRelease) => r.isFree || r.isNameYourPrice).length} free/NYP)`
          );
          return true;
        }
      }
    } catch (e) {
      console.warn('Failed to read from localStorage cache:', e);
    }
    return false;
  };

  // Helper to save catalog to localStorage
  const saveToLocalCache = (targetUrl: string, artist: string, items: ScannedRelease[]) => {
    try {
      const cacheKey = `bc_cache_v6_${encodeURIComponent(targetUrl.trim().toLowerCase())}`;
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          scannedAt: new Date().toISOString(),
          artist,
          releases: items,
        })
      );
    } catch (e) {
      console.warn('Failed to write to localStorage cache:', e);
    }
  };

  // Perform Scan on URL with Progressive Dynamic Rendering
  const runScan = async (targetUrl: string = url, forceRefresh: boolean = false) => {
    if (!forceRefresh) {
      const hasCached = loadFromLocalCache(targetUrl);
      if (hasCached) {
        return;
      }
    }

    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
      activeEventSourceRef.current = null;
    }

    setIsScanning(true);
    setScanProgressText(`Connecting to ${targetUrl}...`);

    try {
      const streamUrl = `/api/bandcamp/scan-stream?url=${encodeURIComponent(targetUrl)}`;
      const es = new EventSource(streamUrl);
      activeEventSourceRef.current = es;

      let currentItems: ScannedRelease[] = [];
      let totalExpected = 0;
      let artistName = '';

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.type === 'manifest') {
            totalExpected = payload.total;
            artistName = payload.artist;
            currentItems = payload.items.map((it: any) => ({
              id: it.id,
              itemId: it.itemId,
              itemType: it.type,
              title: it.title,
              artist: artistName,
              artistUrl: payload.origin || targetUrl,
              url: it.url,
              artUrl: it.artUrl,
              isFree: true,
              isNameYourPrice: false,
              minPrice: 0,
              currency: 'EUR',
              priceFormatted: 'Inspecting...',
              requiresEmail: false,
              trackCount: 1,
              selected: true,
            }));
            setReleases([...currentItems]);
            setScanProgressText(`Discovered ${payload.total} releases. Enriching subpages...`);
          } else if (payload.type === 'release') {
            const enriched: ScannedRelease = {
              ...payload.release,
              selected: payload.release.isFree || payload.release.isNameYourPrice,
            };
            currentItems[payload.index] = enriched;
            setReleases([...currentItems]);
            setScanProgressText(
              `Inspecting discography: ${payload.index + 1}/${totalExpected} (${enriched.title})`
            );
          } else if (payload.type === 'done') {
            es.close();
            activeEventSourceRef.current = null;
            setIsScanning(false);
            setScanMeta({
              source: 'live_crawl',
              timestamp: new Date().toLocaleTimeString(),
            });
            saveToLocalCache(targetUrl, artistName, currentItems);
            setScanProgressText(
              `Completed! ${currentItems.length} releases loaded (${currentItems.filter((r) => r.isFree || r.isNameYourPrice).length} free/NYP)`
            );
          } else if (payload.type === 'error') {
            throw new Error(payload.error);
          }
        } catch (err) {
          console.warn('Error parsing SSE event:', err);
        }
      };

      es.onerror = async () => {
        es.close();
        activeEventSourceRef.current = null;
        try {
          setScanProgressText('Scanning via batch crawl...');
          const res = await fetch(`/api/bandcamp/scan?url=${encodeURIComponent(targetUrl)}&forceRefresh=true`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (data.releases && Array.isArray(data.releases)) {
            const processed = data.releases.map((r: ScannedRelease) => ({
              ...r,
              selected: r.isFree || r.isNameYourPrice,
            }));
            setReleases(processed);
            setScanMeta({
              source: data.source || 'live_crawl',
              timestamp: new Date().toLocaleTimeString(),
            });
            saveToLocalCache(targetUrl, data.artist, processed);
            setScanProgressText(
              `Discovered ${processed.length} releases (${processed.filter((r: ScannedRelease) => r.isFree || r.isNameYourPrice).length} free/NYP)`
            );
          }
        } catch (fallbackErr) {
          console.error('Batch scan fallback error:', fallbackErr);
          setScanProgressText('Failed to scan URL. Please verify artist page.');
        } finally {
          setIsScanning(false);
        }
      };
    } catch (err) {
      console.error('Scan error:', err);
      setScanProgressText('Failed to scan URL.');
      setIsScanning(false);
    }
  };

  // Initial load: check local cache or trigger scan
  useEffect(() => {
    const cached = loadFromLocalCache(DEFAULT_URL);
    if (!cached) {
      runScan(DEFAULT_URL, false);
    }
    return () => {
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
      }
    };
  }, []);

  // Selection handlers
  const handleToggleSelect = (id: string) => {
    setReleases((prev) =>
      prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r))
    );
  };

  const handleSelectAllFreeAndNyp = () => {
    setReleases((prev) =>
      prev.map((r) => ({
        ...r,
        selected: r.isFree || r.isNameYourPrice,
      }))
    );
  };

  const handleSelectAll = () => {
    setReleases((prev) => prev.map((r) => ({ ...r, selected: true })));
  };

  const handleDeselectAll = () => {
    setReleases((prev) => prev.map((r) => ({ ...r, selected: false })));
  };

  const selectedReleases = releases.filter((r) => r.selected);

  // Bulk Download Execution with Genuine FLAC/Audio Resolution & ZIP Bundling
  const handleStartBulkDownload = async () => {
    if (selectedReleases.length === 0) return;

    setIsDownloading(true);

    const initialTasks: DownloadTask[] = selectedReleases.map((rel) => ({
      id: `task-${rel.id}-${Date.now()}`,
      releaseId: rel.id,
      releaseTitle: rel.title,
      artist: rel.artist,
      artUrl: rel.artUrl,
      format: selectedFormat,
      status: 'queued',
      progress: 0,
    }));

    setDownloadTasks(initialTasks);

    const zip = new JSZip();

    for (let i = 0; i < initialTasks.length; i++) {
      const task = initialTasks[i];
      const rel = selectedReleases[i];

      setDownloadTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: 'resolving', progress: 20 } : t))
      );

      try {
        const resolveRes = await fetch('/api/bandcamp/resolve-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            albumUrl: rel.url,
            releaseId: rel.id,
            format: selectedFormat,
            email: settings.fallbackEmail,
          }),
        });

        const resolveData = await resolveRes.json();

        setDownloadTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: 'downloading', progress: 50 } : t))
        );

        if (deliveryMode === 'zip') {
          // Determine formatted audio filename and unified release directory (no duplicate %album% nesting!)
          const formattedAudioName = formatFilenameBySchema(
            settings.namingSchema,
            {
              artist: rel.artist,
              album: rel.title,
              title: rel.title,
              trackNum: 1,
              totalTracks: rel.trackCount || 1,
              date: rel.isoDate || rel.releaseDate,
              year: rel.isoDate?.slice(0, 4) || rel.releaseDate?.slice(-4),
              format: resolveData.format || selectedFormat,
              type: rel.itemType,
            },
            { allowSubfolders: true }
          );

          let releaseDir = '';
          const lastSlash = formattedAudioName.lastIndexOf('/');
          if (lastSlash !== -1) {
            releaseDir = formattedAudioName.substring(0, lastSlash);
          } else {
            const sanitize = (s: string) => String(s || '').replace(/[:*?"<>|]/g, '_').trim();
            releaseDir = `${sanitize(rel.artist)}/${sanitize(rel.title)}`;
          }

          // 1. Write comprehensive info.txt directly in the release directory
          const infoContent = resolveData.infoText || rel.infoText || `Title: ${rel.title}\nArtist: ${rel.artist}\nURL: ${rel.url}\n`;
          zip.file(`${releaseDir}/info.txt`, infoContent);

          // 2. Fetch and store hi-res cover artwork "cover.jpg" via backend proxy (avoids CORS)
          const artUrlToUse = resolveData.artUrl || rel.artUrl;
          if (artUrlToUse) {
            try {
              const artRes = await fetch(`/api/bandcamp/proxy-image?url=${encodeURIComponent(artUrlToUse)}`);
              if (artRes.ok) {
                const artBuf = await artRes.arrayBuffer();
                zip.file(`${releaseDir}/cover.jpg`, artBuf);
              }
            } catch (e) {
              console.warn('Cover fetch error:', e);
            }
          }

          // 3. Fetch all extra photos (CD/LP photos, package gatefold, etc.) via backend proxy
          const imagesToUse = (resolveData.extraImages && resolveData.extraImages.length > 0) ? resolveData.extraImages : (rel.extraImages || []);
          if (imagesToUse.length > 0) {
            for (let pIdx = 0; pIdx < imagesToUse.length; pIdx++) {
              try {
                const pRes = await fetch(`/api/bandcamp/proxy-image?url=${encodeURIComponent(imagesToUse[pIdx])}`);
                if (pRes.ok) {
                  const pBuf = await pRes.arrayBuffer();
                  zip.file(`${releaseDir}/photos/photo_${pIdx + 1}.jpg`, pBuf);
                }
              } catch (e) {}
            }
          }

          // 4. Generate .lrc lyrics files alongside tracks if track lyrics are available
          const streamsToUse = (resolveData.audioStreams && resolveData.audioStreams.length > 0) ? resolveData.audioStreams : (rel.audioStreams || []);
          if (streamsToUse.length > 0) {
            for (const stream of streamsToUse) {
              if (stream.lyrics && stream.lyrics.trim().length > 0) {
                const streamFormattedName = formatFilenameBySchema(
                  settings.namingSchema,
                  {
                    artist: rel.artist,
                    album: rel.title,
                    title: stream.title,
                    trackNum: stream.trackNum,
                    totalTracks: streamsToUse.length,
                    date: rel.isoDate || rel.releaseDate,
                    year: rel.isoDate?.slice(0, 4) || rel.releaseDate?.slice(-4),
                    format: selectedFormat,
                    type: 'track',
                  },
                  { allowSubfolders: true }
                );
                const lrcPath = streamFormattedName.replace(/\.[^/.]+$/, '') + '.lrc';
                const lrcContent = `[ti:${stream.title}]\n[ar:${rel.artist}]\n[al:${rel.title}]\n\n${stream.lyrics}\n`;
                zip.file(lrcPath, lrcContent);
              }
            }
          }

          // 5. Audio Handling:
          // If paid and not owned, skip audio per policy, but keep bundled non-audio assets!
          if (resolveData.isPaid && resolveData.skipAudio) {
            setDownloadTasks((prev) =>
              prev.map((t) =>
                t.id === task.id
                  ? {
                      ...t,
                      status: 'completed',
                      progress: 100,
                      error: 'Paid release: audio skipped (not owned). Artwork, photos, and info.txt bundled.',
                    }
                  : t
              )
            );
            continue;
          }

          // Case A: Direct studio archive or single track file (e.g. CYPH WVNG studio FLAC)
          if (resolveData.success && resolveData.downloadUrl) {
            try {
              const audioRes = await fetch(
                `/api/bandcamp/proxy-audio?url=${encodeURIComponent(resolveData.downloadUrl)}&filename=audio.${resolveData.fileExtension || selectedFormat}&format=${selectedFormat}`
              );
              if (audioRes.ok) {
                const audioBuffer = await audioRes.arrayBuffer();
                const bytes = new Uint8Array(audioBuffer);

                // If Bandcamp provided a zip archive for the release, extract audio directly into releaseDir
                if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
                  try {
                    const innerArchive = await JSZip.loadAsync(audioBuffer);
                    for (const [entryName, entryFile] of Object.entries(innerArchive.files)) {
                      if (!entryFile.dir) {
                        const entryBuf = await entryFile.async('arraybuffer');
                        const simpleName = entryName.split('/').pop() || entryName;
                        zip.file(`${releaseDir}/${simpleName}`, entryBuf);
                      }
                    }
                  } catch (e) {
                    zip.file(formattedAudioName, audioBuffer);
                  }
                } else {
                  zip.file(formattedAudioName, audioBuffer);
                }
              }
            } catch (audioErr) {
              console.warn('Audio fetch error:', audioErr);
            }
          } else if ((resolveData.success || !resolveData.isPaid) && streamsToUse.length > 0) {
            // Case B: Collection of tracks (e.g. Eternal Life in Metastasized Dreams or multitrack release)
            // Download each track converted to FLAC/MP3 with full metadata tags!
            for (const stream of streamsToUse) {
              const streamUrl = stream.streamUrl || (stream as any).url;
              if (streamUrl) {
                try {
                  const streamArtist = resolveData.artist || rel.artist;
                  const streamAlbum = resolveData.title || rel.title;
                  const streamFormattedName = formatFilenameBySchema(
                    settings.namingSchema,
                    {
                      artist: streamArtist,
                      album: streamAlbum,
                      title: stream.title,
                      trackNum: stream.trackNum,
                      totalTracks: streamsToUse.length,
                      date: rel.isoDate || rel.releaseDate,
                      year: rel.isoDate?.slice(0, 4) || rel.releaseDate?.slice(-4),
                      format: selectedFormat,
                      type: 'track',
                    },
                    { allowSubfolders: true }
                  );

                  const trackFilename = streamFormattedName.split('/').pop() || `${stream.title}.${selectedFormat}`;
                  const audioRes = await fetch(
                    `/api/bandcamp/proxy-audio?url=${encodeURIComponent(streamUrl)}&filename=${encodeURIComponent(trackFilename)}&title=${encodeURIComponent(stream.title)}&artist=${encodeURIComponent(streamArtist)}&album=${encodeURIComponent(streamAlbum)}&year=${encodeURIComponent(rel.isoDate?.slice(0, 4) || '')}&trackNum=${encodeURIComponent(String(stream.trackNum))}&format=${selectedFormat}`
                  );
                  if (audioRes.ok) {
                    const trackBuf = await audioRes.arrayBuffer();
                    zip.file(streamFormattedName, trackBuf);
                  }
                } catch (trackErr) {
                  console.warn('Track audio fetch error:', trackErr);
                }
              }
            }
          }
        } else {
          // Individual mode: trigger browser download with slashes converted to hyphens
          const infoContent = resolveData.infoText || rel.infoText || `Title: ${rel.title}\nArtist: ${rel.artist}\nURL: ${rel.url}\n`;
          const artUrlToUse = resolveData.artUrl || rel.artUrl;
          const streamsToUse = (resolveData.audioStreams && resolveData.audioStreams.length > 0) ? resolveData.audioStreams : (rel.audioStreams || []);

          if (resolveData.isPaid && resolveData.skipAudio) {
            const infoBlob = new Blob([infoContent], { type: 'text/plain;charset=utf-8' });
            const infoUrl = URL.createObjectURL(infoBlob);
            const aInfo = document.createElement('a');
            aInfo.href = infoUrl;
            aInfo.download = `${rel.artist} - ${rel.title} - info.txt`.replace(/[:*?"<>|]/g, '_');
            aInfo.click();
            URL.revokeObjectURL(infoUrl);

            if (artUrlToUse) {
              const aArt = document.createElement('a');
              aArt.href = `/api/bandcamp/proxy-image?url=${encodeURIComponent(artUrlToUse)}`;
              aArt.download = `${rel.artist} - ${rel.title} - cover.jpg`.replace(/[:*?"<>|]/g, '_');
              aArt.click();
            }

            setDownloadTasks((prev) =>
              prev.map((t) =>
                t.id === task.id
                  ? {
                      ...t,
                      status: 'completed',
                      progress: 100,
                      error: 'Paid release: audio skipped (not owned). Downloaded artwork and info.txt.',
                    }
                  : t
              )
            );
            continue;
          }

          if (resolveData.success && resolveData.downloadUrl) {
            const formattedName = formatFilenameBySchema(
              settings.namingSchema,
              {
                artist: rel.artist,
                album: rel.title,
                title: rel.title,
                trackNum: 1,
                totalTracks: rel.trackCount || 1,
                date: rel.isoDate || rel.releaseDate,
                year: rel.isoDate?.slice(0, 4) || rel.releaseDate?.slice(-4),
                format: resolveData.format || selectedFormat,
                type: rel.itemType,
              },
              { allowSubfolders: false }
            );

            const a = document.createElement('a');
            a.href = `/api/bandcamp/proxy-audio?url=${encodeURIComponent(resolveData.downloadUrl)}&filename=${encodeURIComponent(formattedName)}&title=${encodeURIComponent(rel.title)}&artist=${encodeURIComponent(rel.artist)}&format=${selectedFormat}`;
            a.download = formattedName;
            a.click();
            await new Promise((r) => setTimeout(r, 800));
          } else if ((resolveData.success || !resolveData.isPaid) && streamsToUse.length > 0) {
            for (const stream of streamsToUse) {
              const streamUrl = stream.streamUrl || (stream as any).url;
              if (streamUrl) {
                const streamArtist = resolveData.artist || rel.artist;
                const streamAlbum = resolveData.title || rel.title;
                const streamFormattedName = formatFilenameBySchema(
                  settings.namingSchema,
                  {
                    artist: streamArtist,
                    album: streamAlbum,
                    title: stream.title,
                    trackNum: stream.trackNum,
                    totalTracks: streamsToUse.length,
                    date: rel.isoDate || rel.releaseDate,
                    year: rel.isoDate?.slice(0, 4) || rel.releaseDate?.slice(-4),
                    format: selectedFormat,
                    type: 'track',
                  },
                  { allowSubfolders: false }
                );

                const a = document.createElement('a');
                a.href = `/api/bandcamp/proxy-audio?url=${encodeURIComponent(streamUrl)}&filename=${encodeURIComponent(streamFormattedName)}&title=${encodeURIComponent(stream.title)}&artist=${encodeURIComponent(streamArtist)}&album=${encodeURIComponent(streamAlbum)}&year=${encodeURIComponent(rel.isoDate?.slice(0, 4) || '')}&trackNum=${encodeURIComponent(String(stream.trackNum))}&format=${selectedFormat}`;
                a.download = streamFormattedName;
                a.click();
                await new Promise((r) => setTimeout(r, 800));
              }
            }
          }
        }

        setDownloadTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: 'completed', progress: 100 } : t))
        );
      } catch (err: any) {
        setDownloadTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, status: 'error', error: err.message || 'Download resolution failed' }
              : t
          )
        );
      }
    }

    if (deliveryMode === 'zip') {
      try {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = zipUrl;
        const artistName = (selectedReleases[0]?.artist || 'Bandcamp').toLowerCase().replace(/\s+/g, '_');
        a.download = `${artistName}_bulk_discography_${selectedFormat}.zip`;
        a.click();
        URL.revokeObjectURL(zipUrl);
      } catch (zipErr) {
        console.error('ZIP generation error:', zipErr);
      }
    }

    setIsDownloading(false);
  };

  // Download Single Release
  const handleDownloadSingle = async (release: ScannedRelease) => {
    const singleTask: DownloadTask = {
      id: `task-single-${release.id}-${Date.now()}`,
      releaseId: release.id,
      releaseTitle: release.title,
      artist: release.artist,
      artUrl: release.artUrl,
      format: selectedFormat,
      status: 'downloading',
      progress: 50,
    };
    setDownloadTasks((prev) => [singleTask, ...prev]);

    try {
      const resolveRes = await fetch('/api/bandcamp/resolve-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumUrl: release.url,
          releaseId: release.id,
          format: selectedFormat,
          email: settings.fallbackEmail,
        }),
      });
      const resolveData = await resolveRes.json();
      const targetUrl = resolveData.downloadUrl || release.audioStreams?.[0]?.streamUrl;

      if (targetUrl) {
        const formattedName = formatFilenameBySchema(
          settings.namingSchema,
          {
            artist: release.artist,
            album: release.title,
            title: release.title,
            trackNum: 1,
            totalTracks: release.trackCount || 1,
            date: release.isoDate || release.releaseDate,
            year: release.isoDate?.slice(0, 4) || release.releaseDate?.slice(-4),
            format: resolveData.format || (resolveData.downloadUrl ? selectedFormat : 'mp3'),
            type: release.itemType,
          },
          { allowSubfolders: false }
        );

        const a = document.createElement('a');
        a.href = `/api/bandcamp/proxy-audio?url=${encodeURIComponent(targetUrl)}&filename=${encodeURIComponent(formattedName)}&title=${encodeURIComponent(release.title)}&artist=${encodeURIComponent(release.artist)}`;
        a.download = formattedName;
        a.click();
      }

      setDownloadTasks((prev) =>
        prev.map((t) => (t.id === singleTask.id ? { ...t, status: 'completed', progress: 100 } : t))
      );
    } catch (e: any) {
      setDownloadTasks((prev) =>
        prev.map((t) => (t.id === singleTask.id ? { ...t, status: 'error', error: e.message } : t))
      );
    }
  };

  // Download Chrome Extension ZIP
  const handleDownloadExtensionZip = async () => {
    setIsDownloadingZip(true);
    try {
      const response = await fetch('/api/extension/download-zip');
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bandcamp-bulk-downloader-extension.zip';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = await createExtensionZip();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bandcamp-bulk-downloader-extension.zip';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Extension zip download error:', e);
    } finally {
      setIsDownloadingZip(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-sans pb-28">
      {/* Top Bar Navigation */}
      <Header
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onDownloadZip={handleDownloadExtensionZip}
        isDownloadingZip={isDownloadingZip}
      />

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 flex-1 w-full">
        {currentTab === 'scanner' && (
          <div>
            {/* Scanner Input & Controls */}
            <ScannerBar
              url={url}
              onUrlChange={setUrl}
              onScan={() => runScan(url, false)}
              onForceRefreshScan={() => runScan(url, true)}
              isScanning={isScanning}
              scanProgressText={scanProgressText}
              skipTrackSubpages={skipTrackSubpages}
              onToggleSkipTracks={setSkipTrackSubpages}
              onLoadEsoctrilihum={() => {
                setUrl(DEFAULT_URL);
                runScan(DEFAULT_URL, false);
              }}
              isCached={scanMeta.source === 'local_cache' || scanMeta.source === 'server_cache'}
              cacheTime={scanMeta.timestamp}
            />

            {/* Scan Status Banner */}
            {scanMeta.source && (
              <div className="flex items-center justify-between gap-2 mb-4 px-4 py-2.5 bg-slate-900/60 border border-slate-800 rounded-xl text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      scanMeta.source === 'local_cache' ? 'bg-cyan-400' : 'bg-emerald-400 animate-pulse'
                    }`}
                  />
                  <span className="font-semibold text-slate-200">
                    {scanMeta.source === 'local_cache' ? 'Local Cache Active:' : 'Live Crawl Complete:'}
                  </span>
                  <span className="text-slate-400">
                    Showing {releases.length} releases from {url} ({releases.filter((r) => r.isFree || r.isNameYourPrice).length} free/NYP)
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {scanMeta.timestamp && (
                    <span className="text-slate-400 font-mono text-[11px]">
                      {scanMeta.source === 'local_cache' ? 'Cached at ' : 'Updated at '}
                      {scanMeta.timestamp}
                    </span>
                  )}
                  <button
                    onClick={() => runScan(url, true)}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold"
                  >
                    Force Re-scan
                  </button>
                </div>
              </div>
            )}

            {/* Catalog Grid & Selection Table */}
            <ReleaseCatalog
              releases={releases}
              onToggleSelect={handleToggleSelect}
              onSelectAllFreeAndNyp={handleSelectAllFreeAndNyp}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onDownloadSingle={handleDownloadSingle}
            />
          </div>
        )}

        {currentTab === 'extension' && (
          <ExtensionPackageCenter
            onDownloadZip={handleDownloadExtensionZip}
            isDownloadingZip={isDownloadingZip}
          />
        )}

        {currentTab === 'guide' && (
          <InstallGuide onDownloadZip={handleDownloadExtensionZip} />
        )}

        {currentTab === 'settings' && (
          <SettingsView
            settings={settings}
            onUpdateSettings={(newSettings) => {
              setSettings(newSettings);
              setSelectedFormat(newSettings.preferredFormat);
              setDeliveryMode(newSettings.deliveryMode);
              setSkipTrackSubpages(newSettings.skipAlbumTrackSubpages);
            }}
          />
        )}
      </main>

      {/* Persistent Bottom Download Bar */}
      {currentTab === 'scanner' && (
        <DownloadManager
          selectedReleases={selectedReleases}
          selectedFormat={selectedFormat}
          onFormatChange={setSelectedFormat}
          deliveryMode={deliveryMode}
          onDeliveryModeChange={setDeliveryMode}
          fallbackEmail={settings.fallbackEmail}
          onFallbackEmailChange={(email) =>
            setSettings((prev) => ({ ...prev, fallbackEmail: email }))
          }
          namingSchema={settings.namingSchema}
          onNamingSchemaChange={(schema) =>
            setSettings((prev) => ({ ...prev, namingSchema: schema }))
          }
          onStartBulkDownload={handleStartBulkDownload}
          isDownloading={isDownloading}
          downloadTasks={downloadTasks}
          onCancelDownload={() => setIsDownloading(false)}
          onRetryTask={(taskId) => {
            setDownloadTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, status: 'downloading', progress: 50, error: undefined } : t
              )
            );
          }}
        />
      )}
    </div>
  );
}
