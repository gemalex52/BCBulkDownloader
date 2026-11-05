import React, { useState, useEffect, useRef } from 'react';
import {
  ScannedRelease,
  DownloadTask,
  AppSettings,
  DeliveryMode,
  AUDIO_FORMATS,
  DEFAULT_APP_SETTINGS,
  QueueItem,
  SiteQueueSession,
  formatFilenameBySchema,
  getCompanionInfoZipName,
} from './types/bandcamp';
import { Header } from './components/Header';
import { ScannerBar } from './components/ScannerBar';
import { ReleaseCatalog } from './components/ReleaseCatalog';
import { DownloadManager } from './components/DownloadManager';
import { ExtensionPackageCenter } from './components/ExtensionPackageCenter';
import { InstallGuide } from './components/InstallGuide';
import { SettingsView } from './components/SettingsView';
import { createExtensionZip } from './services/extensionPackage';
import { buildCompanionInfoZip } from './services/companionZipBuilder';
import {
  getDomainHostname,
  loadSiteSession,
  saveSiteSession,
  initSiteSession,
  updateQueueItem,
  appendItemLog,
  resetItemForRetry,
  calculatePacingDelayMs,
  sleep,
} from './services/queueManager';

const DEFAULT_URL = 'https://esoctrilihum.bandcamp.com/music';
const SETTINGS_STORAGE_KEY = 'bc_app_settings_v2';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'scanner' | 'extension' | 'guide' | 'settings'>('scanner');
  const [url, setUrl] = useState(DEFAULT_URL);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgressText, setScanProgressText] = useState('');
  const [releases, setReleases] = useState<ScannedRelease[]>([]);
  const [skipTrackSubpages, setSkipTrackSubpages] = useState(true);
  const [selectedFormat, setSelectedFormat] = useState('flac');
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [scanMeta, setScanMeta] = useState<{ source: string; timestamp?: string }>({ source: '', timestamp: '' });

  // Persistent Queue Session State
  const [currentSession, setCurrentSession] = useState<SiteQueueSession | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [pacingNotice, setPacingNotice] = useState<string>('');
  const isCancelledRef = useRef(false);

  // App Settings with localStorage persistence
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (e) {}
    return { ...DEFAULT_APP_SETTINGS };
  });

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {}
  }, [settings]);

  const activeEventSourceRef = useRef<EventSource | null>(null);

  // Synchronize or load session whenever URL or releases change
  const currentHostname = getDomainHostname(url);

  const syncSessionFromStorage = (hostname: string) => {
    const sess = loadSiteSession(hostname);
    if (sess) {
      setCurrentSession(sess);
    }
    return sess;
  };

  // Helper to load cached catalog from localStorage
  const loadFromLocalCache = (targetUrl: string): boolean => {
    try {
      const hName = getDomainHostname(targetUrl);
      const sess = syncSessionFromStorage(hName);

      const cacheKey = `bc_cache_v7_${encodeURIComponent(targetUrl.trim().toLowerCase())}`;
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

          if (!sess) {
            const newSess = initSiteSession(hName, new URL(targetUrl).origin, cached.artist || 'Artist', targetUrl, cached.releases);
            setCurrentSession(newSess);
          }
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
      const cacheKey = `bc_cache_v7_${encodeURIComponent(targetUrl.trim().toLowerCase())}`;
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          scannedAt: new Date().toISOString(),
          artist,
          releases: items,
        })
      );

      const hName = getDomainHostname(targetUrl);
      const origin = targetUrl.startsWith('http') ? new URL(targetUrl).origin : `https://${hName}`;
      const sess = initSiteSession(hName, origin, artist, targetUrl, items);
      setCurrentSession(sess);
    } catch (e) {
      console.warn('Failed to write to localStorage cache:', e);
    }
  };

  // Scan Bandcamp Discography
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
    setScanProgressText('Connecting to Bandcamp discography...');

    try {
      const streamUrl = `/api/bandcamp/scan-stream?url=${encodeURIComponent(
        targetUrl
      )}&skipTrackSubpages=${skipTrackSubpages}&forceRefresh=${forceRefresh}`;

      const es = new EventSource(streamUrl);
      activeEventSourceRef.current = es;

      let progressiveItems: ScannedRelease[] = [];
      let scanCompleted = false;

      es.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);

          if (packet.type === 'status' || packet.type === 'info') {
            setScanProgressText(packet.message || 'Scanning catalog...');
          } else if (packet.type === 'release_discovered' || packet.type === 'release') {
            if (packet.release) {
              const rel: ScannedRelease = {
                ...packet.release,
                selected: packet.release.isFree || packet.release.isNameYourPrice,
              };
              progressiveItems = [...progressiveItems, rel];
              setReleases([...progressiveItems]);
              setScanProgressText(
                `Found ${progressiveItems.length} releases... (${packet.release.title})`
              );
            }
          } else if (packet.type === 'complete' || packet.type === 'done') {
            scanCompleted = true;
            es.close();
            activeEventSourceRef.current = null;
            setIsScanning(false);

            const itemsToUse = (packet.releases && Array.isArray(packet.releases) && packet.releases.length > 0)
              ? packet.releases
              : progressiveItems;

            if (itemsToUse.length > 0) {
              const processed = itemsToUse.map((r: ScannedRelease) => ({
                ...r,
                selected: r.isFree || r.isNameYourPrice,
              }));
              setReleases(processed);
              setScanMeta({
                source: packet.source || 'live_crawl',
                timestamp: new Date().toLocaleTimeString(),
              });
              saveToLocalCache(targetUrl, packet.artist || 'Artist', processed);
              setScanProgressText(
                `Finished: ${processed.length} releases discovered (${processed.filter((r: ScannedRelease) => r.isFree || r.isNameYourPrice).length} free/NYP)`
              );
            }
          } else if (packet.type === 'error') {
            console.error('SSE Error Packet:', packet);
            scanCompleted = true;
            es.close();
            activeEventSourceRef.current = null;
            setIsScanning(false);
            setScanProgressText(packet.message || packet.error || 'Error scanning catalog.');
          }
        } catch (parseErr) {
          console.error('Error parsing SSE event:', parseErr);
        }
      };

      es.onerror = async () => {
        if (scanCompleted) return;
        es.close();
        activeEventSourceRef.current = null;

        // If we already accumulated items via SSE, mark complete rather than failing
        if (progressiveItems.length > 0) {
          setIsScanning(false);
          setScanMeta({
            source: 'live_crawl',
            timestamp: new Date().toLocaleTimeString(),
          });
          saveToLocalCache(targetUrl, progressiveItems[0]?.artist || 'Artist', progressiveItems);
          setScanProgressText(
            `Finished: ${progressiveItems.length} releases discovered (${progressiveItems.filter((r: ScannedRelease) => r.isFree || r.isNameYourPrice).length} free/NYP)`
          );
          return;
        }

        setScanProgressText('Resolving full catalog via batch endpoint...');

        try {
          const fallbackRes = await fetch(
            `/api/bandcamp/scan?url=${encodeURIComponent(
              targetUrl
            )}&skipTrackSubpages=${skipTrackSubpages}&forceRefresh=${forceRefresh}`
          );

          const contentType = fallbackRes.headers.get('content-type') || '';
          if (fallbackRes.ok && contentType.includes('application/json')) {
            const data = await fallbackRes.json();
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
              saveToLocalCache(targetUrl, data.artist || 'Artist', processed);
              setScanProgressText(
                `Discovered ${processed.length} releases (${processed.filter((r: ScannedRelease) => r.isFree || r.isNameYourPrice).length} free/NYP)`
              );
            }
          } else {
            console.warn('Batch scan fallback returned non-JSON or error status:', fallbackRes.status);
            setScanProgressText('Unable to reach artist catalog. Please verify URL or use extension.');
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

  // Initial load
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
        selected: r.badgeType !== 'paid' && (r.isFree || r.isNameYourPrice || r.requiresEmail || r.isPurchased || r.badgeType === 'free' || r.badgeType === 'email' || r.badgeType === 'own'),
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

  // Resume vs Start Session Computation
  const currentSessionItems = currentSession?.items || {};
  const selectedSessionItems = selectedReleases.map((r) => currentSessionItems[r.id]).filter(Boolean);

  const pendingItems = selectedSessionItems.filter(
    (item) => item.stage === 'pending' || item.stage === 'skipped'
  );
  const failedItems = selectedSessionItems.filter((item) => item.stage === 'failed');
  const completedItems = selectedSessionItems.filter((item) => item.stage === 'completed');

  // Can resume if some selected items were previously completed or failed, and unfinished items remain
  const canResume =
    completedItems.length > 0 &&
    (pendingItems.length > 0 || failedItems.length > 0);

  // 1-Click Retry an individual item
  const handleRetryItem = (releaseId: string) => {
    const rel = releases.find((r) => r.id === releaseId);
    const updated = resetItemForRetry(currentHostname, releaseId, {
      isPaid: Boolean((rel as any)?.isPaid || (rel && rel.minPrice > 0 && !rel.isPurchased && !rel.freeDownloadPageUrl)),
      minPrice: rel?.minPrice,
    });
    if (updated) {
      setCurrentSession({ ...updated });
    }
  };

  // Execute multi-stage pipeline for a list of queue items
  const runQueuePipeline = async (itemsToProcess: QueueItem[]) => {
    setIsDownloading(true);
    isCancelledRef.current = false;
    let successfulDownloadsCount = 0;

    for (let i = 0; i < itemsToProcess.length; i++) {
      if (isCancelledRef.current) {
        break;
      }

      const qItem = itemsToProcess[i];
      const rel = releases.find((r) => r.id === qItem.id) || (qItem as any);

      // Helper to update state and session storage
      const logAndSync = (stage: QueueItem['stage'], msg: string, err?: string) => {
        const updated = appendItemLog(currentHostname, qItem.id, stage, msg, err);
        if (updated) {
          setCurrentSession({ ...updated });
        }
      };

      try {
        let downloadPageUrl = qItem.freeDownloadPageUrl || rel.freeDownloadPageUrl;
        const isEmailEligible = Boolean(qItem.requiresEmail || rel.requiresEmail || qItem.isNameYourPrice || rel.isNameYourPrice || qItem.badgeType === 'email' || rel.badgeType === 'email');
        const isDirectFree = Boolean(downloadPageUrl || qItem.isPurchased || rel.isPurchased || qItem.badgeType === 'own' || rel.badgeType === 'own' || (!isEmailEligible && (qItem.isFree || rel.isFree || qItem.badgeType === 'free' || rel.badgeType === 'free')));
        const isPaidOnly = Boolean(
          (qItem.badgeType === 'paid' || rel.badgeType === 'paid') ||
          (!isDirectFree && !isEmailEligible && ((qItem.minPrice || 0) > 0 || (rel.minPrice || 0) > 0 || qItem.isPaid || rel.isPaid))
        );

        if (!isPaidOnly) {
          // Stage 1: Checking Mailbox via GAS watchdog if configured
          if (!downloadPageUrl && settings.gasWebhookUrl.trim()) {
            logAndSync('checking_mail', 'Searching Gmail via GAS watchdog for existing download link...');

            let searchSinceEpoch = 0;
            if (settings.gasSearchFilterType === 'start_date' && settings.gasSearchStartDate) {
              const d = new Date(settings.gasSearchStartDate);
              if (!isNaN(d.getTime())) searchSinceEpoch = Math.floor(d.getTime() / 1000);
            }
            if (!searchSinceEpoch) {
              const offsetHours = settings.gasSearchOffsetHours || 72;
              searchSinceEpoch = Math.floor(Date.now() / 1000) - (offsetHours * 3600);
            }

            try {
              const checkRes = await fetch('/api/bandcamp/check-gas-webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  webhookUrl: settings.gasWebhookUrl.trim(),
                  gasUrl: settings.gasWebhookUrl.trim(),
                  secret: settings.gasSecret.trim(),
                  releaseId: qItem.itemId,
                  title: qItem.title,
                  since: searchSinceEpoch,
                }),
              });

              const checkData = await checkRes.json();
              if (checkData.found && checkData.downloadPageUrl) {
                downloadPageUrl = checkData.downloadPageUrl;
                logAndSync('checking_mail', `Found existing signed download link in Gmail! Skipping new email dispatch.`);
              }
            } catch (gasErr: any) {
              console.warn('GAS check warning:', gasErr);
            }
          }

          // Stage 2: Trigger Email on Bandcamp if still needed
          const isEmailWalled = (qItem.requiresEmail || qItem.isNameYourPrice) && !downloadPageUrl;
          if (!downloadPageUrl && isEmailWalled) {
            logAndSync('triggering_email', `Triggering Bandcamp email dispatch to ${settings.fallbackEmail || 'listener'}...`);

            const triggerTime = Math.floor(Date.now() / 1000);
            let emailTriggerOk = false;
            try {
              const trigRes = await fetch('/api/bandcamp/resolve-download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  albumUrl: qItem.url,
                  releaseId: qItem.id,
                  format: selectedFormat,
                  email: settings.fallbackEmail || 'listener@example.com',
                  triggerEmailOnly: true,
                }),
              });
              const trigData = await trigRes.json();
              if (trigData.isPaid) {
                emailTriggerOk = false;
              } else {
                emailTriggerOk = true;
              }
            } catch (trigErr) {
              console.warn('Email trigger warning:', trigErr);
            }

            // Stage 3: Polling GAS watchdog every 5s up to 3 min
            if (emailTriggerOk && settings.gasWebhookUrl.trim()) {
              logAndSync('polling_gas', 'Polling Gmail watchdog every 5s for incoming signed download link...');

              let foundFromPoll = false;
              // Poll for up to 36 cycles (180s = 3 minutes)
              for (let cycle = 0; cycle < 36; cycle++) {
                if (isCancelledRef.current) break;

                await sleep(5000);
                logAndSync('polling_gas', `Polling mailbox for download link (attempt ${cycle + 1}/36)...`);

                try {
                  const pollRes = await fetch('/api/bandcamp/check-gas-webhook', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      webhookUrl: settings.gasWebhookUrl.trim(),
                      gasUrl: settings.gasWebhookUrl.trim(),
                      secret: settings.gasSecret.trim(),
                      releaseId: qItem.itemId,
                      title: qItem.title,
                      since: triggerTime - 15,
                    }),
                  });

                  const pollData = await pollRes.json();
                  if (pollData.found && pollData.downloadPageUrl) {
                    downloadPageUrl = pollData.downloadPageUrl;
                    foundFromPoll = true;
                    logAndSync('polling_gas', 'Received signed download link from Bandcamp email!');
                    break;
                  }
                } catch (e) {}
              }

              if (!foundFromPoll && !downloadPageUrl) {
                throw new Error('Watchdog timeout: Bandcamp email not detected within 3 minutes. Please verify Gmail or retry.');
              }
            }
          }
        }

        // Stage 4: Resolving download stream (resolves true studio format FLAC / MP3-320)
        logAndSync('resolving_stat', `Resolving studio master download URL for format: ${selectedFormat.toUpperCase()}...`);

        const resolveRes = await fetch('/api/bandcamp/resolve-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            albumUrl: qItem.url,
            releaseId: qItem.id,
            format: selectedFormat,
            email: settings.fallbackEmail,
            downloadPageUrl,
          }),
        });

        const resolveData = await resolveRes.json();

        // Stage 5: Downloading Studio Audio
        logAndSync('downloading_audio', 'Downloading studio audio files...');

        const effectiveArtist = resolveData.artist || qItem.artist;
        const effectiveAlbum = resolveData.title || qItem.title;
        const effectiveIsArchive = !!resolveData.isArchive || (qItem.itemType === 'album');

        // Target studio audio filename (auto-drops %title% for album archives)
        const audioFilename = formatFilenameBySchema(
          settings.namingSchema,
          {
            artist: effectiveArtist,
            album: effectiveAlbum,
            title: qItem.title,
            trackNum: 1,
            totalTracks: rel.trackCount || 1,
            date: qItem.isoDate || qItem.releaseDate,
            year: qItem.isoDate?.slice(0, 4) || qItem.releaseDate?.slice(-4),
            format: resolveData.format || selectedFormat,
            type: qItem.itemType,
            isArchive: effectiveIsArchive,
          },
          { allowSubfolders: false }
        );

        if (resolveData.isPaid && resolveData.skipAudio) {
          logAndSync('downloading_audio', `Paid release (${resolveData.message || 'audio skipped per policy'}). Packaging companion info ZIP...`);
        } else if (resolveData.success && resolveData.downloadUrl) {
          // Direct studio archive or FLAC track
          const audioRes = await fetch(
            `/api/bandcamp/proxy-audio?url=${encodeURIComponent(resolveData.downloadUrl)}&filename=${encodeURIComponent(audioFilename)}&format=${selectedFormat}`
          );

          if (audioRes.ok) {
            const blob = await audioRes.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = audioFilename;
            a.click();
            URL.revokeObjectURL(a.href);
            successfulDownloadsCount++;
          } else {
            throw new Error(`Audio download failed: HTTP ${audioRes.status}`);
          }
        } else if (selectedFormat === 'mp3-128' && resolveData.audioStreams && resolveData.audioStreams.length > 0) {
          // Explicit mp3-128 stream collection fallback
          for (const stream of resolveData.audioStreams) {
            const streamUrl = stream.streamUrl || stream.url;
            if (streamUrl) {
              const streamName = formatFilenameBySchema(
                settings.namingSchema,
                {
                  artist: effectiveArtist,
                  album: effectiveAlbum,
                  title: stream.title,
                  trackNum: stream.trackNum,
                  totalTracks: resolveData.audioStreams.length,
                  date: qItem.isoDate || qItem.releaseDate,
                  year: qItem.isoDate?.slice(0, 4) || qItem.releaseDate?.slice(-4),
                  format: selectedFormat,
                  type: 'track',
                },
                { allowSubfolders: false }
              );

              const sRes = await fetch(
                `/api/bandcamp/proxy-audio?url=${encodeURIComponent(streamUrl)}&albumUrl=${encodeURIComponent(qItem.url)}&filename=${encodeURIComponent(streamName)}&title=${encodeURIComponent(stream.title)}&artist=${encodeURIComponent(effectiveArtist)}&album=${encodeURIComponent(effectiveAlbum)}&format=${selectedFormat}`
              );
              if (sRes.ok) {
                const sBlob = await sRes.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(sBlob);
                a.download = streamName;
                a.click();
                URL.revokeObjectURL(a.href);
              }
              await sleep(600);
            }
          }
          successfulDownloadsCount++;
        } else {
          throw new Error(resolveData.error || resolveData.message || `Studio audio download URL could not be resolved for ${selectedFormat.toUpperCase()}`);
        }

        // Stage 6: Build and download companion (info).zip
        if (settings.createCompanionInfoZip) {
          logAndSync('packaging_info', 'Packaging companion (info).zip (untruncated info.txt, cover.jpg, artist.jpg, photos/, .lrc)...');

          const companionResult = await buildCompanionInfoZip({
            release: rel,
            infoText: resolveData.infoText || rel.infoText,
            artUrl: resolveData.artUrl || rel.artUrl,
            artistBioPicUrl: resolveData.artistBioPicUrl || rel.artistBioPicUrl,
            extraImages: resolveData.extraImages || rel.extraImages,
            audioStreams: resolveData.audioStreams || rel.audioStreams,
          });

          const companionName = getCompanionInfoZipName(audioFilename);
          const aInfo = document.createElement('a');
          aInfo.href = URL.createObjectURL(companionResult.blob);
          aInfo.download = companionName;
          aInfo.click();
          URL.revokeObjectURL(aInfo.href);

          logAndSync('packaging_info', `Created companion ZIP: ${companionName} (${companionResult.filesCount} files)`);
        }

        // Stage 7: Anti-Captcha Jitter Pacing & Cool-Down
        if (i < itemsToProcess.length - 1 && !isCancelledRef.current) {
          logAndSync('pacing', 'Applying anti-captcha pacing delay...');

          if (
            settings.cooldownBatchInterval > 0 &&
            successfulDownloadsCount % settings.cooldownBatchInterval === 0
          ) {
            setPacingNotice(`Batch interval reached: Cooling down for ${settings.cooldownDurationSeconds}s...`);
            await sleep(settings.cooldownDurationSeconds * 1000);
            setPacingNotice('');
          } else {
            const delayMs = calculatePacingDelayMs(
              settings.pacingBaseDelaySeconds,
              settings.pacingJitterPercent
            );
            setPacingNotice(`Pacing pause (${(delayMs / 1000).toFixed(1)}s)...`);
            await sleep(delayMs);
            setPacingNotice('');
          }
        }

        // Mark Completed
        const doneStatus = (resolveData.isPaid && resolveData.skipAudio)
          ? 'Packaging complete (Paid release - companion info ZIP created)'
          : 'Download completed successfully!';
        logAndSync('completed', doneStatus);
        updateQueueItem(currentHostname, qItem.id, {
          audioDownloaded: !resolveData.skipAudio,
          infoZipDownloaded: settings.createCompanionInfoZip,
          stageProgress: 100,
        });
      } catch (itemErr: any) {
        console.error(`Error processing ${qItem.title}:`, itemErr);
        logAndSync('failed', `Failed: ${itemErr.message || 'Unknown error'}`, itemErr.message);
      }
    }

    setIsDownloading(false);
    setPacingNotice('');
  };

  // Start Clean Bulk Download
  const handleStartBulkDownload = async () => {
    if (selectedReleases.length === 0) return;

    // Ensure session is initialized
    let sess = currentSession;
    if (!sess) {
      sess = initSiteSession(
        currentHostname,
        url.startsWith('http') ? new URL(url).origin : `https://${currentHostname}`,
        releases[0]?.artist || 'Artist',
        url,
        releases
      );
      setCurrentSession(sess);
    }

    // Reset selected items to pending
    selectedReleases.forEach((r) => {
      resetItemForRetry(currentHostname, r.id, {
        isPaid: Boolean((r as any).isPaid || (r.minPrice > 0 && !r.isPurchased && !r.freeDownloadPageUrl)),
        minPrice: r.minPrice,
      });
    });

    const refreshed = syncSessionFromStorage(currentHostname);
    const items = selectedReleases.map((r) => refreshed?.items[r.id]).filter(Boolean) as QueueItem[];
    await runQueuePipeline(items);
  };

  // Resume Download (unfinished items only: pending + failed)
  const handleResumeBulkDownload = async () => {
    const refreshed = syncSessionFromStorage(currentHostname);
    if (!refreshed) return;

    const itemsToResume = selectedReleases
      .map((r) => refreshed.items[r.id])
      .filter((item): item is QueueItem => !!item && item.stage !== 'completed');

    // Auto-retry failed items
    itemsToResume.forEach((item) => {
      if (item.stage === 'failed') {
        const rel = releases.find((r) => r.id === item.id);
        resetItemForRetry(currentHostname, item.id, {
          isPaid: Boolean((rel as any)?.isPaid || (rel && rel.minPrice > 0 && !rel.isPurchased && !rel.freeDownloadPageUrl)),
          minPrice: rel?.minPrice,
        });
      }
    });

    const finalSession = syncSessionFromStorage(currentHostname);
    const runnable = itemsToResume.map((i) => finalSession?.items[i.id]).filter(Boolean) as QueueItem[];
    await runQueuePipeline(runnable);
  };

  // Download Single Release
  const handleDownloadSingle = async (release: ScannedRelease) => {
    let sess = currentSession;
    if (!sess) {
      sess = initSiteSession(
        currentHostname,
        url.startsWith('http') ? new URL(url).origin : `https://${currentHostname}`,
        release.artist,
        url,
        releases.length > 0 ? releases : [release]
      );
      setCurrentSession(sess);
    }

    resetItemForRetry(currentHostname, release.id, {
      isPaid: Boolean((release as any).isPaid || (release.minPrice > 0 && !release.isPurchased && !release.freeDownloadPageUrl)),
      minPrice: release.minPrice,
    });
    const refreshed = syncSessionFromStorage(currentHostname);
    const item = refreshed?.items[release.id] || sess.items[release.id];
    if (item) {
      await runQueuePipeline([item]);
    }
  };

  // Convert QueueItems to DownloadTask format for DownloadManager modal display
  const downloadTasks: DownloadTask[] = selectedReleases.map((r) => {
    const q = currentSession?.items[r.id];
    let status: DownloadTask['status'] = 'queued';
    let progress = 0;

    if (q) {
      if (q.stage === 'completed') {
        status = 'completed';
        progress = 100;
      } else if (q.stage === 'failed') {
        status = 'error';
        progress = 0;
      } else if (q.stage === 'downloading_audio' || q.stage === 'packaging_info') {
        status = 'downloading';
        progress = 65;
      } else if (q.stage !== 'pending') {
        status = 'resolving';
        progress = 30;
      }
    }

    return {
      id: r.id,
      releaseId: r.id,
      releaseTitle: r.title,
      artist: r.artist,
      artUrl: r.artUrl,
      format: selectedFormat,
      status,
      progress,
      error: q?.error,
    };
  });

  const handleDownloadExtensionZip = async () => {
    setIsDownloadingZip(true);
    try {
      const blob = await createExtensionZip();
      const zipUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = zipUrl;
      a.download = 'bandcamp-bulk-downloader-extension.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(zipUrl);
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
              onUrlChange={(newUrl) => {
                setUrl(newUrl);
                syncSessionFromStorage(getDomainHostname(newUrl));
              }}
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

            {/* Scan & Queue Session Status Banner */}
            {scanMeta.source && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 px-4 py-3 bg-[#111827] border border-slate-800 rounded-xl text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      scanMeta.source === 'local_cache' ? 'bg-cyan-400' : 'bg-emerald-400 animate-pulse'
                    }`}
                  />
                  <span className="font-semibold text-slate-200">
                    Session: <span className="text-cyan-400 font-mono">{currentHostname}</span>
                  </span>
                  <span className="text-slate-400">
                    · {releases.length} releases ({completedItems.length} completed
                    {failedItems.length > 0 ? `, ${failedItems.length} failed` : ''})
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {scanMeta.timestamp && (
                    <span className="text-slate-400 font-mono text-[11px]">
                      Updated at {scanMeta.timestamp}
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
              queueItems={currentSession?.items}
              onToggleSelect={handleToggleSelect}
              onSelectAllFreeAndNyp={handleSelectAllFreeAndNyp}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onDownloadSingle={handleDownloadSingle}
              onRetryItem={handleRetryItem}
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
              setSkipTrackSubpages(!!newSettings.skipAlbumTrackSubpages);
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
          deliveryMode="companion"
          onDeliveryModeChange={() => {}}
          fallbackEmail={settings.fallbackEmail}
          onFallbackEmailChange={(email) =>
            setSettings((prev) => ({ ...prev, fallbackEmail: email }))
          }
          namingSchema={settings.namingSchema}
          onNamingSchemaChange={(schema) =>
            setSettings((prev) => ({ ...prev, namingSchema: schema }))
          }
          onStartBulkDownload={handleStartBulkDownload}
          onResumeBulkDownload={handleResumeBulkDownload}
          canResume={canResume}
          pendingCount={pendingItems.length}
          failedCount={failedItems.length}
          completedCount={completedItems.length}
          isDownloading={isDownloading}
          downloadTasks={downloadTasks}
          onCancelDownload={() => {
            isCancelledRef.current = true;
            setIsDownloading(false);
            setPacingNotice('');
          }}
          onRetryTask={handleRetryItem}
          activePacingNotice={pacingNotice}
          createCompanionInfoZip={settings.createCompanionInfoZip}
        />
      )}
    </div>
  );
}
