import React, { useState, useEffect, useRef } from 'react';
import {
  ScannedRelease,
  DownloadTask,
  AppSettings,
  DeliveryMode,
  AUDIO_FORMATS,
  DEFAULT_APP_SETTINGS,
  QueueItem,
  QueueItemStage,
  ItemStageLog,
  SiteQueueSession,
  formatFilenameBySchema,
  getCompanionInfoZipName,
  formatInfoZipFilenameBySchema,
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
  resetItemState,
  resetAllItemsState,
  calculatePacingDelayMs,
  sleep,
} from './services/queueManager';

import { storage, apiClient, isExtension } from './services/unifiedClient';
import { setDebugLogging, debugLog, cleanBandcampUrl } from './services/bandcampCore';

const DEFAULT_URL = 'https://esoctrilihum.bandcamp.com/music';
const SETTINGS_STORAGE_KEY = 'bc_app_settings_v2';

function getInitialTargetUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlParam = params.get('url');
      if (urlParam) {
        return cleanBandcampUrl(urlParam);
      }
    } catch (e) {}
  }
  return DEFAULT_URL;
}

export default function App() {
  const [currentTab, setCurrentTab] = useState<'scanner' | 'extension' | 'guide' | 'settings'>('scanner');

  useEffect(() => {
    if (isExtension && (currentTab === 'extension' || currentTab === 'guide')) {
      setCurrentTab('scanner');
    }
  }, [currentTab]);

  const initialUrlRef = useRef<string>(getInitialTargetUrl());
  const [url, setUrl] = useState<string>(initialUrlRef.current);
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

  // App Settings with storage adapter persistence (chrome.storage.local & localStorage)
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (saved) {
          const parsed = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(saved) };
          setDebugLogging(Boolean(parsed.debugLogging));
          return parsed;
        }
      }
    } catch (e) {}
    return { ...DEFAULT_APP_SETTINGS };
  });

  // Sync debug logging flag whenever settings change
  useEffect(() => {
    setDebugLogging(Boolean(settings.debugLogging));
    storage.set(SETTINGS_STORAGE_KEY, settings);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      }
    } catch (e) {}
  }, [settings]);

  // Load async settings from chrome.storage.local on mount
  useEffect(() => {
    (async () => {
      const asyncSettings = await storage.get<AppSettings>(SETTINGS_STORAGE_KEY);
      if (asyncSettings) {
        setSettings((prev) => ({ ...prev, ...asyncSettings }));
        setDebugLogging(Boolean(asyncSettings.debugLogging));
      }
    })();
  }, []);

  // Extension mode: Auto-detect active Bandcamp tab URL if opened from browser extension
  useEffect(() => {
    (async () => {
      const activeUrl = await apiClient.fetchActiveTabUrl();
      if (activeUrl) {
        const cleaned = cleanBandcampUrl(activeUrl);
        setUrl(cleaned);
        loadFromLocalCache(cleaned);
      }
    })();
  }, []);

  const activeEventSourceRef = useRef<EventSource | null>(null);

  // Synchronize or load session whenever URL or releases change
  const currentHostname = getDomainHostname(url);

  const syncSessionFromStorage = (hostname: string): SiteQueueSession | null => {
    const sess = loadSiteSession(hostname);
    if (sess) {
      setCurrentSession(sess);
      return sess;
    }
    if (isExtension) {
      const key = `bc_session_v2_${hostname.toLowerCase()}`;
      storage.get<SiteQueueSession>(key).then((extSess) => {
        if (extSess) {
          setCurrentSession(extSess);
        }
      });
    }
    return null;
  };

  // Helper to load cached catalog from localStorage or chrome.storage.local
  const loadFromLocalCache = async (targetUrl: string): Promise<boolean> => {
    try {
      const hName = getDomainHostname(targetUrl);
      const sess = syncSessionFromStorage(hName);

      const cacheKey = `bc_cache_v8_${encodeURIComponent(targetUrl.trim().toLowerCase())}`;
      let cached: any = await storage.get<any>(cacheKey);

      if (!cached && typeof localStorage !== 'undefined') {
        const cachedRaw = localStorage.getItem(cacheKey);
        if (cachedRaw) {
          try { cached = JSON.parse(cachedRaw); } catch (e) {}
        }
      }

      if (cached && cached.releases && Array.isArray(cached.releases) && cached.releases.length > 0) {
        const enriched = cached.releases.map((r: ScannedRelease) => {
          const q = sess?.items?.[r.id];
          return {
            ...r,
            audioDownloaded: Boolean(r.audioDownloaded || q?.audioDownloaded),
            infoZipDownloaded: Boolean(r.infoZipDownloaded || q?.infoZipDownloaded),
          };
        });
        setReleases(enriched);
        setScanMeta({
          source: 'local_cache',
          timestamp: new Date(cached.scannedAt).toLocaleTimeString(),
        });
        setScanProgressText(
          `Loaded ${enriched.length} releases from cache (${enriched.filter((r: ScannedRelease) => r.isFree || r.isNameYourPrice).length} free/NYP)`
        );

        if (!sess) {
          const newSess = initSiteSession(hName, new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`).origin, cached.artist || 'Artist', targetUrl, enriched);
          setCurrentSession(newSess);
        }
        return true;
      }
    } catch (e) {
      console.warn('Failed to read from cache:', e);
    }
    return false;
  };

  // Helper to save catalog to storage
  const saveToLocalCache = (targetUrl: string, artist: string, items: ScannedRelease[]) => {
    try {
      const cacheKey = `bc_cache_v8_${encodeURIComponent(targetUrl.trim().toLowerCase())}`;
      const cacheObj = {
        scannedAt: new Date().toISOString(),
        artist,
        releases: items,
      };
      storage.set(cacheKey, cacheObj);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(cacheKey, JSON.stringify(cacheObj));
      }

      const hName = getDomainHostname(targetUrl);
      const origin = targetUrl.startsWith('http') ? new URL(targetUrl).origin : `https://${hName}`;
      const sess = initSiteSession(hName, origin, artist, targetUrl, items);
      setCurrentSession(sess);
    } catch (e) {
      console.warn('Failed to write to cache:', e);
    }
  };

  // Scan Bandcamp Discography
  const runScan = async (targetUrl: string = url, forceRefresh: boolean = false) => {
    if (!forceRefresh) {
      const hasCached = await loadFromLocalCache(targetUrl);
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

    // Extension Mode: Scan directly through background worker (bypasses CORS and Fastly bot challenge)
    if (isExtension) {
      try {
        debugLog('scanner', 'Starting extension background scan for:', targetUrl);
        const catRes = await apiClient.discoverCatalog(targetUrl, skipTrackSubpages);
        if (!catRes || !catRes.success) {
          throw new Error(catRes?.error || 'Failed to fetch artist catalog');
        }

        const items = catRes.items || [];
        const origin = catRes.origin || (targetUrl.startsWith('http') ? new URL(targetUrl).origin : `https://${getDomainHostname(targetUrl)}`);
        const artistName = catRes.artistName || 'Artist';
        const artistBioPicUrl = catRes.artistBioPicUrl;

        setScanProgressText(`Discovered ${items.length} releases in catalog. Inspecting metadata...`);

        const inspected: ScannedRelease[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          setScanProgressText(`Inspecting release ${i + 1}/${items.length}: ${item.title}...`);
          try {
            const inspRes = await apiClient.inspectRelease(origin, artistName, item, artistBioPicUrl);
            if (inspRes && inspRes.success && inspRes.release) {
              const rel = {
                ...inspRes.release,
                selected: inspRes.release.badgeType !== 'paid',
              };
              inspected.push(rel);
              setReleases([...inspected]);
            }
          } catch (itemErr) {
            console.warn(`Failed inspecting subpage ${item.title}:`, itemErr);
          }
        }

        setReleases(inspected);
        setScanMeta({
          source: 'extension_live_crawl',
          timestamp: new Date().toLocaleTimeString(),
        });
        saveToLocalCache(targetUrl, artistName, inspected);
        setScanProgressText(
          `Finished: ${inspected.length} releases discovered (${inspected.filter((r) => r.badgeType !== 'paid').length} free/email)`
        );
      } catch (extErr: any) {
        console.error('Extension scan error:', extErr);
        setScanProgressText(`Scan failed: ${extErr.message || 'Unknown error'}`);
      } finally {
        setIsScanning(false);
      }
      return;
    }

    // Standalone Web Server Mode: Use SSE stream or batch fallback
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
                selected: packet.release.badgeType !== 'paid',
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
                selected: r.badgeType !== 'paid',
              }));
              setReleases(processed);
              setScanMeta({
                source: packet.source || 'live_crawl',
                timestamp: new Date().toLocaleTimeString(),
              });
              saveToLocalCache(targetUrl, packet.artist || 'Artist', processed);
              setScanProgressText(
                `Finished: ${processed.length} releases discovered (${processed.filter((r: ScannedRelease) => r.badgeType !== 'paid').length} free/email)`
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
            `Finished: ${progressiveItems.length} releases discovered (${progressiveItems.filter((r: ScannedRelease) => r.badgeType !== 'paid').length} free/email)`
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
                selected: r.badgeType !== 'paid',
              }));
              setReleases(processed);
              setScanMeta({
                source: data.source || 'live_crawl',
                timestamp: new Date().toLocaleTimeString(),
              });
              saveToLocalCache(targetUrl, data.artist || 'Artist', processed);
              setScanProgressText(
                `Discovered ${processed.length} releases (${processed.filter((r: ScannedRelease) => r.badgeType !== 'paid').length} free/email)`
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

  // Initial load: await local/extension cache before triggering network crawl
  useEffect(() => {
    let cancelled = false;
    const target = initialUrlRef.current;
    (async () => {
      const cached = await loadFromLocalCache(target);
      if (!cached && !cancelled) {
        await runScan(target, false);
      }
    })();
    return () => {
      cancelled = true;
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
        selected: r.badgeType !== 'paid' && r.badgeType !== 'preorder' && !r.isPreorder && (r.isFree || r.isNameYourPrice || r.requiresEmail || r.isPurchased || r.badgeType === 'free' || r.badgeType === 'email' || r.badgeType === 'own'),
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

  // Scope completion helper
  const isItemCompleteForScope = (item: QueueItem, relScope?: 'both' | 'audio' | 'info') => {
    const scope = relScope || item.downloadScope || settings.defaultDownloadScope || 'both';
    if (scope === 'audio') return Boolean(item.audioDownloaded);
    if (scope === 'info') return Boolean(item.infoZipDownloaded);
    return Boolean(item.audioDownloaded && item.infoZipDownloaded);
  };

  const pendingItems = selectedSessionItems.filter(
    (item) => item.stage === 'pending' || item.stage === 'skipped'
  );
  const failedItems = selectedSessionItems.filter((item) => item.stage === 'failed');
  const completedItems = selectedSessionItems.filter((item) => item.stage === 'completed');

  // Can resume if some selected items were previously completed or failed, and unfinished items remain
  const canResume =
    completedItems.length > 0 &&
    (pendingItems.length > 0 || failedItems.length > 0);

  // Helper to build QueueItems from selected releases reliably in any environment
  const buildQueueItemsForReleases = (releasesToRun: ScannedRelease[], session: SiteQueueSession | null): QueueItem[] => {
    const queueMap = session?.items || {};
    return releasesToRun.map((r) => {
      const existing = queueMap[r.id];
      if (existing) {
        const targetScope = r.downloadScope || existing.downloadScope || settings.defaultDownloadScope || 'both';
        const isComplete = isItemCompleteForScope(existing, targetScope);

        return {
          ...existing,
          downloadScope: targetScope,
          stage: isComplete ? 'completed' : 'pending',
          error: undefined,
        };
      }

      const isPreorder = Boolean(r.isPreorder || r.badgeType === 'preorder');
      const isEmailEligible = !isPreorder && Boolean(r.requiresEmail || r.isNameYourPrice || r.badgeType === 'email');
      const isPaid = isPreorder || (!isEmailEligible && !r.isPurchased && r.badgeType !== 'own' && Boolean(
        r.badgeType === 'paid' ||
        (!r.freeDownloadPageUrl && !r.isFree && (r.minPrice || 0) > 0)
      ));
      const isDirectFree = !isPaid && !isPreorder && Boolean(r.freeDownloadPageUrl || r.isPurchased || r.badgeType === 'own' || (!isEmailEligible && (r.isFree || r.badgeType === 'free')));

      return {
        id: r.id,
        itemId: r.itemId,
        itemType: r.itemType,
        title: r.title,
        artist: r.artist,
        url: r.url,
        artUrl: r.artUrl,
        artistBioPicUrl: r.artistBioPicUrl,
        extraImages: r.extraImages,
        extraPhotos: r.extraPhotos,
        downloadScope: r.downloadScope || (isPreorder ? 'info' : 'both'),
        releaseDate: r.releaseDate,
        isoDate: r.isoDate,
        isFree: r.isFree,
        isNameYourPrice: r.isNameYourPrice,
        isPurchased: r.isPurchased,
        isPaid,
        isPreorder,
        badgeType: r.badgeType || (isPreorder ? 'preorder' : (isPaid ? 'paid' : (isDirectFree ? 'free' : 'email'))),
        minPrice: r.minPrice,
        requiresEmail: r.requiresEmail,
        stage: 'pending',
        stageProgress: 0,
        statusText: r.priceFormatted || (isPreorder ? 'Pre-order' : 'Pending'),
        audioDownloaded: false,
        infoZipDownloaded: false,
        freeDownloadPageUrl: r.freeDownloadPageUrl,
        retryCount: 0,
        lastUpdated: new Date().toISOString(),
        logs: [],
      };
    });
  };

  // Change individual release download target scope
  const handleSetReleaseScope = (id: string, scope: 'both' | 'audio' | 'info') => {
    setReleases((prev) =>
      prev.map((r) => (r.id === id ? { ...r, downloadScope: scope } : r))
    );
    if (currentSession && currentSession.items[id]) {
      const updated = updateQueueItem(currentHostname, id, { downloadScope: scope });
      if (updated) setCurrentSession({ ...updated });
    }
  };

  // Batch change download target scope for all selected releases
  const handleSetBatchScope = (scope: 'both' | 'audio' | 'info') => {
    setReleases((prev) =>
      prev.map((r) => (r.selected ? { ...r, downloadScope: scope } : r))
    );
    if (currentSession) {
      let lastSess = currentSession;
      releases
        .filter((r) => r.selected)
        .forEach((r) => {
          const upd = updateQueueItem(currentHostname, r.id, { downloadScope: scope });
          if (upd) lastSess = upd;
        });
      setCurrentSession({ ...lastSess });
    }
  };

  // 1-Click Retry an individual item
  const handleRetryItem = (releaseId: string) => {
    const rel = releases.find((r) => r.id === releaseId);
    const isEmail = Boolean(rel?.badgeType === 'email' || rel?.requiresEmail || rel?.isNameYourPrice);
    const isPaid = !isEmail && !rel?.isPurchased && (rel?.badgeType === 'paid' || Boolean((rel?.minPrice || 0) > 0 && !rel?.isFree && !rel?.freeDownloadPageUrl));
    const updated = resetItemForRetry(currentHostname, releaseId, {
      isPaid,
      minPrice: rel?.minPrice,
    });
    if (updated) {
      setCurrentSession({ ...updated });
    }
  };

  // Execute multi-stage pipeline for a list of queue items
  const runQueuePipeline = async (itemsToProcess: QueueItem[]) => {
    debugLog('pipeline', `=== Starting queue pipeline: ${itemsToProcess.length} item(s) to process ===`);
    if (itemsToProcess.length === 0) {
      console.warn('[BandcampDL:pipeline] runQueuePipeline received 0 items to process.');
      return;
    }

    setIsDownloading(true);
    isCancelledRef.current = false;
    let successfulDownloadsCount = 0;

    for (let i = 0; i < itemsToProcess.length; i++) {
      if (isCancelledRef.current) {
        debugLog('pipeline', 'Download pipeline cancelled by user.');
        break;
      }

      const qItem = itemsToProcess[i];
      const rel = releases.find((r) => r.id === qItem.id) || (qItem as any);

      debugLog('pipeline', `[${i + 1}/${itemsToProcess.length}] Processing "${qItem.title}" (${qItem.itemType}, ID: ${qItem.itemId})...`);

      // Helper to update state and session storage
      const logAndSync = (stage: QueueItem['stage'], msg: string, err?: string) => {
        debugLog('pipeline', `[${qItem.title}] [${stage}] ${msg}`, err || '');
        const updated = appendItemLog(currentHostname, qItem.id, stage, msg, err);
        if (updated) {
          setCurrentSession({ ...updated });
        } else {
          setCurrentSession((prev) => {
            if (!prev) return prev;
            const prevItem = prev.items[qItem.id] || { ...qItem };
            const newLog: ItemStageLog = {
              timestamp: new Date().toLocaleTimeString(),
              stage,
              message: msg,
              error: err,
            };
            return {
              ...prev,
              updatedAt: new Date().toISOString(),
              items: {
                ...prev.items,
                [qItem.id]: {
                  ...prevItem,
                  stage,
                  statusText: msg,
                  error: err || prevItem.error,
                  lastUpdated: new Date().toISOString(),
                  logs: [...(prevItem.logs || []), newLog].slice(-25),
                },
              },
            };
          });
        }
      };

      try {
        let downloadPageUrl = qItem.freeDownloadPageUrl || rel.freeDownloadPageUrl;
        const isEmailEligible = Boolean(
          qItem.requiresEmail ||
          rel.requiresEmail ||
          qItem.isNameYourPrice ||
          rel.isNameYourPrice ||
          qItem.badgeType === 'email' ||
          rel.badgeType === 'email'
        );

        // If release requires email, never use a raw fsig download page as it is not a genuine signed email download page
        if (downloadPageUrl && isEmailEligible && !downloadPageUrl.includes('from=email') && !downloadPageUrl.includes('payment_id=')) {
          downloadPageUrl = undefined;
        }

        const isPreorder = Boolean(
          qItem.isPreorder ||
          rel.isPreorder ||
          qItem.badgeType === 'preorder' ||
          rel.badgeType === 'preorder'
        );

        const isPaidOnly = isPreorder || (!isEmailEligible && !qItem.isPurchased && !rel.isPurchased && Boolean(
          (qItem.badgeType === 'paid' || rel.badgeType === 'paid') ||
          (!downloadPageUrl && ((qItem.minPrice || 0) > 0 || (rel.minPrice || 0) > 0) && !qItem.isFree && !rel.isFree)
        ));
        const isDirectFree = !isPaidOnly && !isPreorder && Boolean(downloadPageUrl || qItem.isPurchased || rel.isPurchased || qItem.badgeType === 'own' || rel.badgeType === 'own' || (!isEmailEligible && (qItem.isFree || rel.isFree || qItem.badgeType === 'free' || rel.badgeType === 'free')));

        const hasGasWatchdog = Boolean(settings.gasWebhookUrl && settings.gasWebhookUrl.trim());

        const effectiveScope = qItem.downloadScope || rel.downloadScope || settings.defaultDownloadScope || 'both';
        const shouldDownloadAudio = effectiveScope !== 'info' && !qItem.audioDownloaded;
        const shouldDownloadInfo = effectiveScope !== 'audio' && settings.createCompanionInfoZip && !qItem.infoZipDownloaded;

        let audioSuccess = Boolean(qItem.audioDownloaded);
        let audioError: string | undefined = undefined;
        let infoSuccess = Boolean(qItem.infoZipDownloaded);
        let infoError: string | undefined = undefined;
        let resolveData: any = null;

        const effectiveArtist = rel.artist || qItem.artist;
        const effectiveAlbum = rel.title || qItem.title;
        const effectiveIsArchive = qItem.itemType === 'album';

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
            format: selectedFormat,
            type: qItem.itemType,
            isArchive: effectiveIsArchive,
          },
          { allowSubfolders: false }
        );

        // --- SECTION 1: Audio Resolution & Download ---
        if (shouldDownloadAudio) {
          if (isPreorder) {
            logAndSync('downloading_audio', 'Pre-order release: audio master is not yet available prior to official release date. Packaging companion info ZIP.');
          } else if (!isPaidOnly) {
            try {
              // Stage 1: Checking Mailbox via GAS watchdog if configured
              if (!downloadPageUrl && hasGasWatchdog) {
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
                  const checkData = await apiClient.checkGasWebhook({
                    webhookUrl: settings.gasWebhookUrl.trim(),
                    secret: settings.gasSecret.trim(),
                    releaseId: qItem.itemId,
                    title: qItem.title,
                    since: searchSinceEpoch,
                    timeoutSeconds: settings.gasMailCheckTimeoutSeconds || 90,
                  });
                  debugLog('gas', 'Initial GAS check response:', checkData);

                  if (checkData && checkData.found && checkData.downloadPageUrl) {
                    downloadPageUrl = checkData.downloadPageUrl;
                    logAndSync('checking_mail', `Found existing signed download link in Gmail! Skipping new email dispatch.`);
                  }
                } catch (gasErr: any) {
                  debugLog('gas', 'Initial GAS check error:', gasErr);
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
                  const itemOrigin = qItem.url.startsWith('http')
                    ? new URL(qItem.url).origin
                    : (url.startsWith('http') ? new URL(url).origin : `https://${currentHostname}`);

                  const trigData = await apiClient.triggerEmailDownload(
                    itemOrigin,
                    selectedFormat,
                    qItem.itemId,
                    qItem.itemType,
                    settings.fallbackEmail || 'listener@example.com',
                    qItem.url
                  );
                  debugLog('pipeline', 'triggerEmailDownload response:', trigData);
                  if (trigData && (trigData.ok || trigData.success)) {
                    emailTriggerOk = true;
                  }
                } catch (trigErr) {
                  debugLog('pipeline', 'triggerEmailDownload error:', trigErr);
                  console.warn('Email trigger warning:', trigErr);
                }

                // Stage 3: Polling GAS watchdog every 5s up to maxGasCycles
                if (emailTriggerOk && hasGasWatchdog) {
                  const timeoutSeconds = settings.gasMailCheckTimeoutSeconds || 90;
                  const maxGasCycles = settings.gasMaxPollCycles || Math.ceil(timeoutSeconds / 5);
                  logAndSync('polling_gas', `Polling Gmail watchdog every 5s for incoming signed download link (up to ${timeoutSeconds}s wait)...`);

                  let foundFromPoll = false;
                  for (let cycle = 0; cycle < maxGasCycles; cycle++) {
                    if (isCancelledRef.current) break;

                    await sleep(5000);
                    logAndSync('polling_gas', `Polling mailbox for download link (attempt ${cycle + 1}/${maxGasCycles})...`);

                    try {
                      const pollData = await apiClient.checkGasWebhook({
                        webhookUrl: settings.gasWebhookUrl.trim(),
                        secret: settings.gasSecret.trim(),
                        releaseId: qItem.itemId,
                        title: qItem.title,
                        since: triggerTime - 15,
                      });
                      debugLog('gas', `Polling attempt ${cycle + 1}/${maxGasCycles} response:`, pollData);

                      if (pollData && pollData.found && pollData.downloadPageUrl) {
                        downloadPageUrl = pollData.downloadPageUrl;
                        foundFromPoll = true;
                        logAndSync('polling_gas', 'Received signed download link from Bandcamp email!');
                        break;
                      }
                    } catch (pollErr: any) {
                      debugLog('gas', `Polling attempt ${cycle + 1}/${maxGasCycles} error:`, pollErr);
                    }
                  }

                  if (!foundFromPoll && !downloadPageUrl) {
                    logAndSync('polling_gas', 'Notice: Signed Bandcamp download link not detected in Gmail yet.');
                  }
                }
              }

              // Stage 4: Resolving download stream (resolves true studio format FLAC / MP3-320 with up to 60s+ wait)
              logAndSync('resolving_stat', `Resolving studio master download URL for format: ${selectedFormat.toUpperCase()}...`);

              resolveData = await apiClient.resolveDownload({
                albumUrl: qItem.url,
                releaseId: qItem.id,
                itemId: qItem.itemId,
                itemType: qItem.itemType,
                format: selectedFormat,
                email: settings.fallbackEmail,
                downloadPageUrl,
                release: qItem,
              });

              // Stage 5: Downloading Studio Audio
              logAndSync('downloading_audio', 'Downloading studio audio files...');

              if (resolveData?.isPaid && resolveData?.skipAudio) {
                logAndSync('downloading_audio', `Paid release (${resolveData.message || 'audio skipped per policy'}).`);
              } else if (resolveData?.success && resolveData?.downloadUrl) {
                debugLog('pipeline', 'Downloading resolved studio audio:', resolveData.downloadUrl, 'as', audioFilename);
                await apiClient.downloadAudioFile(resolveData.downloadUrl, audioFilename);
                audioSuccess = true;
                successfulDownloadsCount++;
              } else if (selectedFormat === 'mp3-128' && (resolveData?.audioStreams || rel.audioStreams) && (resolveData?.audioStreams || rel.audioStreams).length > 0) {
                const streamsToDl = resolveData?.audioStreams || rel.audioStreams;
                for (const stream of streamsToDl) {
                  const streamUrl = stream.streamUrl || stream.url;
                  if (streamUrl) {
                    const streamName = formatFilenameBySchema(
                      settings.namingSchema,
                      {
                        artist: effectiveArtist,
                        album: effectiveAlbum,
                        title: stream.title,
                        trackNum: stream.trackNum,
                        totalTracks: streamsToDl.length,
                        date: qItem.isoDate || qItem.releaseDate,
                        year: qItem.isoDate?.slice(0, 4) || qItem.releaseDate?.slice(-4),
                        format: selectedFormat,
                        type: 'track',
                      },
                      { allowSubfolders: false }
                    );

                    await apiClient.downloadAudioFile(streamUrl, streamName);
                    await sleep(600);
                  }
                }
                audioSuccess = true;
                successfulDownloadsCount++;
              } else {
                audioError = resolveData?.error || 'Studio audio download link required or timed out on server';
                logAndSync('downloading_audio', `Studio audio not resolved: ${audioError}`, audioError);
              }
            } catch (aErr: any) {
              audioError = aErr.message || 'Audio processing failed';
              debugLog('pipeline', `Audio error for "${qItem.title}":`, audioError);
              logAndSync('downloading_audio', `Audio download failed: ${audioError}`, audioError);
            }
          } else {
            logAndSync('downloading_audio', 'Paid release (audio skipped per policy). Packaging companion info ZIP.');
          }
        }

        // --- SECTION 2: Companion Info Archive Packaging ---
        // Runs whenever shouldDownloadInfo is enabled, REGARDLESS of whether audio failed or succeeded!
        if (shouldDownloadInfo) {
          try {
            logAndSync('packaging_info', 'Packaging companion (info).zip (untruncated info.txt, cover.jpg, artist.jpg, photos/, .lrc)...');

            const companionResult = await buildCompanionInfoZip({
              release: rel,
              infoText: resolveData?.infoText || rel.infoText,
              artUrl: resolveData?.artUrl || rel.artUrl,
              artistBioPicUrl: resolveData?.artistBioPicUrl || rel.artistBioPicUrl,
              extraImages: resolveData?.extraImages || rel.extraImages,
              extraPhotos: resolveData?.extraPhotos || rel.extraPhotos,
              audioStreams: resolveData?.audioStreams || rel.audioStreams,
            });

            const companionName = formatInfoZipFilenameBySchema(
              settings.infoZipNamingSchema,
              {
                artist: rel.artist,
                album: rel.title,
                title: rel.title,
                trackNum: rel.trackCount === 1 ? 1 : undefined,
                totalTracks: rel.trackCount || 1,
                date: rel.isoDate || rel.releaseDate,
                year: rel.releaseDate?.slice(0, 4),
                type: rel.itemType || 'album',
              },
              getCompanionInfoZipName(audioFilename)
            );
            await apiClient.downloadBlob(companionResult.blob, companionName);
            infoSuccess = true;
            logAndSync('packaging_info', `Created companion ZIP: ${companionName} (${companionResult.filesCount} files)`);
          } catch (iErr: any) {
            infoError = iErr.message || 'Failed packaging info archive';
            debugLog('pipeline', `Info archive error for "${qItem.title}":`, infoError);
            logAndSync('packaging_info', `Info ZIP failed: ${infoError}`, infoError);
          }
        }

        // --- SECTION 3: Anti-Captcha Jitter Pacing & Cool-Down ---
        if (i < itemsToProcess.length - 1 && !isCancelledRef.current) {
          logAndSync('pacing', 'Applying anti-captcha pacing delay...');

          if (
            settings.cooldownBatchInterval > 0 &&
            successfulDownloadsCount > 0 &&
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

        // --- SECTION 4: Composite Outcome & Status Reflection ---
        let finalStage: QueueItemStage = 'completed';
        let finalStatusText = '';

        if (shouldDownloadAudio && shouldDownloadInfo) {
          if (isPreorder) {
            finalStage = infoSuccess ? 'completed' : 'failed';
            finalStatusText = infoSuccess
              ? 'Packaging complete (Pre-order - companion info ZIP created)'
              : `Pre-order (Info ZIP failed: ${infoError || 'error'})`;
          } else if (isPaidOnly) {
            finalStage = infoSuccess ? 'completed' : 'failed';
            finalStatusText = infoSuccess
              ? 'Packaging complete (Paid release - companion info ZIP created)'
              : `Paid release (Info ZIP failed: ${infoError || 'error'})`;
          } else if (audioSuccess && infoSuccess) {
            finalStage = 'completed';
            finalStatusText = 'Download completed successfully!';
          } else if (!audioSuccess && infoSuccess) {
            finalStage = 'completed';
            finalStatusText = `Audio error (${audioError || 'preparation timeout'}) · Info archive complete`;
          } else if (audioSuccess && !infoSuccess) {
            finalStage = 'completed';
            finalStatusText = `Audio complete · Info archive failed (${infoError || 'error'})`;
          } else {
            finalStage = 'failed';
            finalStatusText = `Audio failed (${audioError || 'unknown'}) · Info failed (${infoError || 'unknown'})`;
          }
        } else if (shouldDownloadAudio && !shouldDownloadInfo) {
          if (isPreorder) {
            finalStage = 'completed';
            finalStatusText = 'Pre-order: Audio master unavailable until official release date.';
          } else if (audioSuccess) {
            finalStage = 'completed';
            finalStatusText = 'Audio download completed (Audio only)!';
          } else {
            finalStage = 'failed';
            finalStatusText = `Audio failed: ${audioError || 'download failed'}`;
          }
        } else if (!shouldDownloadAudio && shouldDownloadInfo) {
          if (infoSuccess) {
            finalStage = 'completed';
            finalStatusText = 'Companion info archive saved (Info only)!';
          } else {
            finalStage = 'failed';
            finalStatusText = `Info archive failed: ${infoError || 'packaging failed'}`;
          }
        }

        const finalAudioDl = Boolean(qItem.audioDownloaded || audioSuccess);
        const finalInfoDl = Boolean(qItem.infoZipDownloaded || infoSuccess);

        logAndSync(finalStage, finalStatusText, audioError || infoError || undefined);
        updateQueueItem(currentHostname, qItem.id, {
          audioDownloaded: finalAudioDl,
          infoZipDownloaded: finalInfoDl,
          stage: finalStage,
          statusText: finalStatusText,
          stageProgress: 100,
          error: audioError ? `Audio: ${audioError}` : (infoError ? `Info: ${infoError}` : undefined),
        });

        setReleases((prev) =>
          prev.map((r) =>
            r.id === qItem.id
              ? {
                  ...r,
                  audioDownloaded: finalAudioDl,
                  infoZipDownloaded: finalInfoDl,
                }
              : r
          )
        );
      } catch (itemErr: any) {
        console.error(`Error processing ${qItem.title}:`, itemErr);
        logAndSync('failed', `Failed: ${itemErr.message || 'Unknown error'}`, itemErr.message);
      }
    }

    setIsDownloading(false);
    setPacingNotice('');
    debugLog('pipeline', `=== Finished queue pipeline. Successful downloads: ${successfulDownloadsCount} ===`);
  };

  // Start Clean Bulk Download
  const handleStartBulkDownload = async () => {
    if (selectedReleases.length === 0) return;
    debugLog('pipeline', `handleStartBulkDownload: ${selectedReleases.length} release(s) selected.`);

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

    // For each selected release, if not yet complete for its scope, reset it to pending
    selectedReleases.forEach((r) => {
      const existing = sess?.items?.[r.id];
      const targetScope = r.downloadScope || settings.defaultDownloadScope || 'both';
      const complete = existing ? isItemCompleteForScope(existing, targetScope) : false;
      if (!complete) {
        const isEmail = Boolean(r.badgeType === 'email' || r.requiresEmail || r.isNameYourPrice);
        const isPaid = !isEmail && !r.isPurchased && (r.badgeType === 'paid' || Boolean((r.minPrice || 0) > 0 && !r.isFree && !r.freeDownloadPageUrl));
        resetItemForRetry(currentHostname, r.id, {
          isPaid,
          minPrice: r.minPrice,
          downloadScope: targetScope,
        });
      }
    });

    const refreshed = syncSessionFromStorage(currentHostname) || sess;
    const allItems = buildQueueItemsForReleases(selectedReleases, refreshed);
    const runnable = allItems.filter((item) => {
      const rel = selectedReleases.find((r) => r.id === item.id);
      return !isItemCompleteForScope(item, rel?.downloadScope || item.downloadScope);
    });

    debugLog('pipeline', `Prepared ${runnable.length} runnable items out of ${selectedReleases.length} selected.`);
    if (runnable.length > 0) {
      await runQueuePipeline(runnable);
    } else {
      // If all selected were already complete, re-run all selected
      selectedReleases.forEach((r) => {
        const isEmail = Boolean(r.badgeType === 'email' || r.requiresEmail || r.isNameYourPrice);
        const isPaid = !isEmail && !r.isPurchased && (r.badgeType === 'paid' || Boolean((r.minPrice || 0) > 0 && !r.isFree && !r.freeDownloadPageUrl));
        resetItemForRetry(currentHostname, r.id, {
          isPaid,
          minPrice: r.minPrice,
          downloadScope: r.downloadScope || settings.defaultDownloadScope || 'both',
        });
      });
      const forceRefreshed = syncSessionFromStorage(currentHostname) || sess;
      await runQueuePipeline(buildQueueItemsForReleases(selectedReleases, forceRefreshed));
    }
  };

  // Resume Download (unfinished items only: pending + failed + incomplete for scope)
  const handleResumeBulkDownload = async () => {
    debugLog('pipeline', 'handleResumeBulkDownload clicked.');
    const refreshed = syncSessionFromStorage(currentHostname) || currentSession;
    const allQueueItems = buildQueueItemsForReleases(selectedReleases, refreshed);
    const itemsToResume = allQueueItems.filter((item) => {
      const rel = selectedReleases.find((r) => r.id === item.id);
      return !isItemCompleteForScope(item, rel?.downloadScope || item.downloadScope);
    });

    debugLog('pipeline', `Found ${itemsToResume.length} uncompleted releases out of ${allQueueItems.length} selected.`);
    if (itemsToResume.length === 0) return;

    // Auto-retry failed items
    itemsToResume.forEach((item) => {
      if (item.stage === 'failed' || item.stage === 'completed') {
        const rel = releases.find((r) => r.id === item.id);
        const isEmail = Boolean(rel?.badgeType === 'email' || rel?.requiresEmail || rel?.isNameYourPrice);
        const isPaid = !isEmail && !rel?.isPurchased && (rel?.badgeType === 'paid' || Boolean((rel?.minPrice || 0) > 0 && !rel?.isFree && !rel?.freeDownloadPageUrl));
        resetItemForRetry(currentHostname, item.id, {
          isPaid,
          minPrice: rel?.minPrice,
          downloadScope: rel?.downloadScope || item.downloadScope || settings.defaultDownloadScope || 'both',
        });
      }
    });

    const finalSession = syncSessionFromStorage(currentHostname) || refreshed;
    const runnable = buildQueueItemsForReleases(
      selectedReleases.filter((r) => itemsToResume.some((i) => i.id === r.id)),
      finalSession
    );
    debugLog('pipeline', `Dispatching ${runnable.length} runnable items to pipeline.`);
    await runQueuePipeline(runnable);
  };

  // Stop active download queue
  const handleCancelDownload = () => {
    isCancelledRef.current = true;
    setIsDownloading(false);
    setPacingNotice('');
    debugLog('pipeline', 'Download queue cancelled by user.');
  };

  // Reset state for an individual release
  const handleResetReleaseState = (releaseId: string) => {
    resetItemState(currentHostname, releaseId);
    const refreshed = syncSessionFromStorage(currentHostname);
    if (refreshed) setCurrentSession({ ...refreshed });
    setReleases((prev) =>
      prev.map((r) =>
        r.id === releaseId
          ? {
              ...r,
              audioDownloaded: false,
              infoZipDownloaded: false,
            }
          : r
      )
    );
  };

  // Reset all items state and clear session progress (Start Over)
  const handleResetAllState = () => {
    resetAllItemsState(currentHostname);
    const refreshed = syncSessionFromStorage(currentHostname);
    if (refreshed) setCurrentSession({ ...refreshed });
    setReleases((prev) =>
      prev.map((r) => ({
        ...r,
        audioDownloaded: false,
        infoZipDownloaded: false,
      }))
    );
  };

  // State-based group selection toggle
  const handleToggleGroupSelect = (group: 'both' | 'audio' | 'info' | 'failed' | 'none') => {
    const isMember = (r: ScannedRelease) => {
      const q = currentSession?.items[r.id];
      const audioDl = Boolean(r.audioDownloaded || q?.audioDownloaded);
      const infoDl = Boolean(r.infoZipDownloaded || q?.infoZipDownloaded);
      if (group === 'failed') return Boolean(q && (q.stage === 'failed' || Boolean(q.error) || (q.logs && q.logs.some((l) => Boolean(l.error)))));
      if (group === 'both') return audioDl && infoDl;
      if (group === 'audio') return audioDl && !infoDl;
      if (group === 'info') return infoDl && !audioDl;
      if (group === 'none') return !audioDl && !infoDl;
      return false;
    };

    setReleases((prev) => {
      const groupItems = prev.filter(isMember);
      if (groupItems.length === 0) return prev;
      const allSelected = groupItems.every((r) => r.selected);
      return prev.map((r) => {
        if (isMember(r)) {
          return { ...r, selected: !allSelected };
        }
        return r;
      });
    });
  };

  // Download Single Release
  const handleDownloadSingle = async (release: ScannedRelease) => {
    debugLog('pipeline', `handleDownloadSingle clicked for "${release.title}".`);
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

    const isEmail = Boolean(release.badgeType === 'email' || release.requiresEmail || release.isNameYourPrice);
    const isPaid = !isEmail && !release.isPurchased && (release.badgeType === 'paid' || Boolean((release.minPrice || 0) > 0 && !release.isFree && !release.freeDownloadPageUrl));
    resetItemForRetry(currentHostname, release.id, {
      isPaid,
      minPrice: release.minPrice,
    });
    const refreshed = syncSessionFromStorage(currentHostname) || sess;
    const items = buildQueueItemsForReleases([release], refreshed);
    if (items.length > 0) {
      await runQueuePipeline(items);
    }
  };

  // Convert QueueItems to DownloadTask format for DownloadManager modal display
  const downloadTasks: DownloadTask[] = selectedReleases.map((r) => {
    const q = currentSession?.items[r.id];
    let status: DownloadTask['status'] = 'queued';
    let progress = 0;
    let stage: QueueItemStage | undefined = q?.stage;
    let stageName: string | undefined = undefined;

    if (q) {
      stage = q.stage;
      switch (q.stage) {
        case 'completed':
          status = 'completed';
          progress = 100;
          stageName = q.statusText || 'Completed';
          break;
        case 'failed':
          status = 'error';
          progress = 100;
          stageName = q.error || q.statusText || 'Failed';
          break;
        case 'pacing':
          status = 'downloading';
          progress = 95;
          stageName = 'Pacing Pause';
          break;
        case 'packaging_info':
          status = 'downloading';
          progress = 85;
          stageName = 'Building Info ZIP';
          break;
        case 'downloading_audio':
          status = 'downloading';
          progress = 70;
          stageName = 'Downloading Audio';
          break;
        case 'resolving_stat':
          status = 'resolving';
          progress = 55;
          stageName = 'Resolving Studio Link';
          break;
        case 'polling_gas':
          status = 'resolving';
          progress = 40;
          stageName = 'Awaiting Download Link';
          break;
        case 'triggering_email':
          status = 'resolving';
          progress = 25;
          stageName = 'Sending Email Request';
          break;
        case 'checking_mail':
          status = 'resolving';
          progress = 15;
          stageName = 'Checking Mailbox';
          break;
        case 'pending':
        default:
          status = 'queued';
          progress = 0;
          stageName = 'Queued';
          break;
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
      stage,
      stageName,
      statusText: q?.statusText || stageName || status,
      progress: q?.stageProgress || progress,
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
        debugLogging={Boolean(settings.debugLogging)}
        onToggleDebugLogging={() => {
          setSettings((prev) => ({
            ...prev,
            debugLogging: !prev.debugLogging,
          }));
        }}
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
              onResetInitialUrl={() => {
                const target = initialUrlRef.current || DEFAULT_URL;
                setUrl(target);
                runScan(target, false);
              }}
              onLoadEsoctrilihum={() => {
                const target = initialUrlRef.current || DEFAULT_URL;
                setUrl(target);
                runScan(target, false);
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
              onSetReleaseScope={handleSetReleaseScope}
              onSetBatchScope={handleSetBatchScope}
              onResetReleaseState={handleResetReleaseState}
              onToggleGroupSelect={handleToggleGroupSelect}
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
          infoZipNamingSchema={settings.infoZipNamingSchema}
          onInfoZipNamingSchemaChange={(schema) =>
            setSettings((prev) => ({ ...prev, infoZipNamingSchema: schema }))
          }
          onSetBatchScope={handleSetBatchScope}
          onStartBulkDownload={handleStartBulkDownload}
          onResumeBulkDownload={handleResumeBulkDownload}
          canResume={canResume}
          pendingCount={pendingItems.length}
          failedCount={failedItems.length}
          completedCount={completedItems.length}
          isDownloading={isDownloading}
          downloadTasks={downloadTasks}
          onCancelDownload={handleCancelDownload}
          onResetAllState={handleResetAllState}
          onRetryTask={handleRetryItem}
          activePacingNotice={pacingNotice}
          createCompanionInfoZip={settings.createCompanionInfoZip}
        />
      )}
    </div>
  );
}
