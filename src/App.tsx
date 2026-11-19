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
  getStageDefaultProgress,
  getStageDisplayName,
} from './types/bandcamp';
import { Header } from './components/Header';
import { ScannerBar } from './components/ScannerBar';
import { ReleaseCatalog } from './components/ReleaseCatalog';
import { DownloadManager } from './components/DownloadManager';
import { ExtensionPackageCenter } from './components/ExtensionPackageCenter';
import { InstallGuide } from './components/InstallGuide';
import { SettingsView } from './components/SettingsView';
import { ScanListModal } from './components/ScanListModal';
import { createExtensionZip } from './services/extensionPackage';
import { buildCompanionInfoZip } from './services/companionZipBuilder';
import {
  getDomainHostname,
  loadSiteSession,
  loadSiteSessionAsync,
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
  const [isScanListOpen, setIsScanListOpen] = useState(false);
  const [scanMeta, setScanMeta] = useState<{ source: string; timestamp?: string }>({ source: '', timestamp: '' });

  // Persistent Queue Session State
  const [currentSession, setCurrentSession] = useState<SiteQueueSession | null>(null);
  const currentSessionRef = useRef<SiteQueueSession | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const isDownloadingRef = useRef(false);
  const [pacingNotice, setPacingNotice] = useState<string>('');
  const isCancelledRef = useRef(false);

  useEffect(() => {
    isDownloadingRef.current = isDownloading;
  }, [isDownloading]);

  const updateCurrentSession = (
    sessOrUpdater: SiteQueueSession | null | ((prev: SiteQueueSession | null) => SiteQueueSession | null)
  ) => {
    if (typeof sessOrUpdater === 'function') {
      setCurrentSession((prev) => {
        const next = sessOrUpdater(prev);
        currentSessionRef.current = next;
        return next;
      });
    } else {
      const sess = sessOrUpdater;
      if (sess && currentSessionRef.current && currentSessionRef.current.hostname === sess.hostname) {
        if (sess.updatedAt && currentSessionRef.current.updatedAt) {
          if (new Date(sess.updatedAt).getTime() < new Date(currentSessionRef.current.updatedAt).getTime()) {
            return;
          }
        }
      }
      const next = sess ? { ...sess, items: { ...sess.items } } : null;
      currentSessionRef.current = next;
      setCurrentSession(next);
    }
  };

  // App Settings persisted exclusively via chrome.storage.local (with in-memory fallback outside extension)
  const [settings, setSettings] = useState<AppSettings>(() => ({ ...DEFAULT_APP_SETTINGS }));
  const settingsLoadedRef = useRef(false);

  // Sync debug logging flag and persist settings whenever modified after initial load
  useEffect(() => {
    setDebugLogging(Boolean(settings.debugLogging));
    if (settingsLoadedRef.current) {
      storage.set(SETTINGS_STORAGE_KEY, settings);
    }
  }, [settings]);

  // Load persisted settings from chrome.storage.local on mount
  useEffect(() => {
    (async () => {
      try {
        const asyncSettings = await storage.get<AppSettings>(SETTINGS_STORAGE_KEY);
        if (asyncSettings) {
          const merged = { ...DEFAULT_APP_SETTINGS, ...asyncSettings };
          setSettings(merged);
          setSelectedFormat(merged.preferredFormat || 'flac');
          setSkipTrackSubpages(merged.skipAlbumTrackSubpages !== false);
          setDebugLogging(Boolean(merged.debugLogging));
        }
      } finally {
        settingsLoadedRef.current = true;
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
      if (!isDownloadingRef.current) {
        updateCurrentSession(sess);
      }
      return sess;
    }
    if (isExtension) {
      loadSiteSessionAsync(hostname).then((extSess) => {
        if (extSess && !isDownloadingRef.current) {
          updateCurrentSession(extSess);
        }
      });
    }
    return null;
  };

  // Helper to load cached catalog from chrome.storage.local (unlimitedStorage)
  const loadFromLocalCache = async (targetUrl: string): Promise<boolean> => {
    try {
      const hName = getDomainHostname(targetUrl);
      if (!hName) return false;
      const sess = loadSiteSession(hName) || (await loadSiteSessionAsync(hName));
      if (sess && !isDownloadingRef.current) {
        updateCurrentSession(sess);
      }

      const cleaned = cleanBandcampUrl(targetUrl).trim().toLowerCase();
      const hostKey = `bc_cache_v8_host_${hName.toLowerCase()}`;
      const cacheKey = `bc_cache_v8_${encodeURIComponent(cleaned)}`;
      const musicKey = `bc_cache_v8_${encodeURIComponent('https://' + hName.toLowerCase() + '/music')}`;

      let cached: any = await storage.get<any>(hostKey);
      if (!cached) cached = await storage.get<any>(cacheKey);
      if (!cached) cached = await storage.get<any>(musicKey);

      if (cached && cached.releases && Array.isArray(cached.releases) && cached.releases.length > 0) {
        const enriched = cached.releases.map((r: ScannedRelease) => {
          const q = sess?.items?.[r.id] || currentSessionRef.current?.items?.[r.id];
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

        if (!sess && !isDownloadingRef.current) {
          const newSess = initSiteSession(
            hName,
            new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`).origin,
            cached.artist || 'Artist',
            targetUrl,
            enriched
          );
          updateCurrentSession(newSess);
        }
        return true;
      }
    } catch (e) {
      console.warn('Failed to read from chrome.storage.local cache:', e);
    }
    return false;
  };

  // Helper to save catalog exclusively to chrome.storage.local (unlimitedStorage)
  const saveToLocalCache = (targetUrl: string, artist: string, items: ScannedRelease[]) => {
    try {
      const hName = getDomainHostname(targetUrl);
      const cleaned = cleanBandcampUrl(targetUrl).trim().toLowerCase();
      const hostKey = `bc_cache_v8_host_${hName.toLowerCase()}`;
      const cacheKey = `bc_cache_v8_${encodeURIComponent(cleaned)}`;
      const musicKey = `bc_cache_v8_${encodeURIComponent('https://' + hName.toLowerCase() + '/music')}`;

      const cacheObj = {
        scannedAt: new Date().toISOString(),
        artist,
        releases: items,
      };

      storage.set(hostKey, cacheObj);
      storage.set(cacheKey, cacheObj);
      storage.set(musicKey, cacheObj);

      const origin = targetUrl.startsWith('http') ? new URL(targetUrl).origin : `https://${hName}`;
      const sess = initSiteSession(hName, origin, artist, targetUrl, items);
      updateCurrentSession(sess);
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
    // If release is pre-order or paid, studio audio is not downloadable; info zip completion marks item complete
    if (item.isPaid || item.isPreorder) {
      return Boolean(item.infoZipDownloaded);
    }
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
          collectionUrl: r.collectionUrl || existing.collectionUrl,
          downloadScope: targetScope,
          stage: isComplete ? 'completed' : 'pending',
          stageProgress: isComplete ? 100 : 0,
          statusText: isComplete ? (existing.statusText || 'Completed') : (r.priceFormatted || 'Queued'),
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
        collectionUrl: r.collectionUrl,
        retryCount: 0,
        lastUpdated: new Date().toISOString(),
        logs: [],
      };
    });
  };

  // Change individual release download target scope (automatically selects the card if not yet selected)
  const handleSetReleaseScope = (id: string, scope: 'both' | 'audio' | 'info') => {
    setReleases((prev) =>
      prev.map((r) => (r.id === id ? { ...r, downloadScope: scope, selected: true } : r))
    );
    if (currentSession && currentSession.items[id]) {
      const updated = updateQueueItem(currentHostname, id, { downloadScope: scope });
      if (updated) updateCurrentSession(updated);
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

  // Execute streamlined asynchronous multi-stage pipeline for queue items
  const runQueuePipeline = async (itemsToProcess: QueueItem[]) => {
    debugLog('pipeline', `=== Starting async batch pipeline: ${itemsToProcess.length} item(s) to process ===`);
    if (itemsToProcess.length === 0) {
      console.warn('[BandcampDL:pipeline] runQueuePipeline received 0 items to process.');
      return;
    }

    setIsDownloading(true);
    isCancelledRef.current = false;
    let successfulDownloadsCount = 0;

    const hasGasWatchdog = Boolean(settings.gasWebhookUrl && settings.gasWebhookUrl.trim());
    const resolvedMailLinks = new Map<string, string>();

    const logAndSyncForItem = (
      targetId: string,
      stage: QueueItem['stage'],
      msg: string,
      err?: string,
      progressOverride?: number
    ) => {
      const targetItem = itemsToProcess.find((it) => it.id === targetId);
      debugLog('pipeline', `[${targetItem?.title || targetId}] [${stage}] ${msg}`, err || '');
      const updated = appendItemLog(currentHostname, targetId, stage, msg, err, progressOverride);
      if (updated) {
        updateCurrentSession(updated);
      } else {
        const fallbackProgress =
          typeof progressOverride === 'number'
            ? Math.max(0, Math.min(100, Math.round(progressOverride)))
            : getStageDefaultProgress(stage);
        updateCurrentSession((prev) => {
          if (!prev) return prev;
          const prevItem = prev.items[targetId] || targetItem;
          if (!prevItem) return prev;
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
              [targetId]: {
                ...prevItem,
                stage,
                stageProgress: fallbackProgress,
                statusText: msg,
                error: err !== undefined ? err : prevItem.error,
                lastUpdated: new Date().toISOString(),
                logs: [...(prevItem.logs || []), newLog].slice(-25),
              },
            },
          };
        });
      }
    };

    const getItemDescriptor = (qItem: QueueItem) => {
      const rel = releases.find((r) => r.id === qItem.id) || (qItem as any);
      let downloadPageUrl = resolvedMailLinks.get(qItem.id) || qItem.freeDownloadPageUrl || rel.freeDownloadPageUrl;
      const isOwned = Boolean(
        qItem.isPurchased ||
        rel.isPurchased ||
        qItem.badgeType === 'own' ||
        rel.badgeType === 'own'
      );
      const isEmailEligible = !isOwned && Boolean(
        qItem.requiresEmail ||
        rel.requiresEmail ||
        qItem.isNameYourPrice ||
        rel.isNameYourPrice ||
        qItem.badgeType === 'email' ||
        rel.badgeType === 'email'
      );
      if (downloadPageUrl && isEmailEligible && !downloadPageUrl.includes('from=email') && !downloadPageUrl.includes('payment_id=')) {
        downloadPageUrl = undefined;
      }
      const isPreorder = Boolean(
        qItem.isPreorder ||
        rel.isPreorder ||
        qItem.badgeType === 'preorder' ||
        rel.badgeType === 'preorder'
      );
      const isPaidOnly = isPreorder || (!isEmailEligible && !isOwned && Boolean(
        (qItem.badgeType === 'paid' || rel.badgeType === 'paid') ||
        (!downloadPageUrl && ((qItem.minPrice || 0) > 0 || (rel.minPrice || 0) > 0) && !qItem.isFree && !rel.isFree)
      ));
      const effectiveScope = qItem.downloadScope || rel.downloadScope || settings.defaultDownloadScope || 'both';
      const shouldDownloadAudio = effectiveScope !== 'info' && !qItem.audioDownloaded;
      const shouldDownloadInfo = effectiveScope !== 'audio' && settings.createCompanionInfoZip && !qItem.infoZipDownloaded;
      return {
        rel,
        downloadPageUrl,
        isOwned,
        isEmailEligible,
        isPreorder,
        isPaidOnly,
        effectiveScope,
        shouldDownloadAudio,
        shouldDownloadInfo,
      };
    };

    const matchBatchResultForItem = (
      results: any[],
      batchItem: QueueItem,
      fallbackIdx: number
    ) => {
      const idStr = String(batchItem.id || '');
      const numericId = String(batchItem.itemId || '').replace(/^(album|track)-/, '');
      const byId = results.find((res) => {
        if (!res || res.id === undefined || res.id === null) return false;
        const rId = String(res.id).replace(/^(album|track)-/, '');
        return String(res.id) === idStr || (numericId && rId === numericId);
      });
      if (byId) return byId;
      return results[fallbackIdx];
    };

    const finalizeItemOutcome = (params: {
      qItem: QueueItem;
      shouldDownloadAudio: boolean;
      shouldDownloadInfo: boolean;
      isPreorder: boolean;
      isPaidOnly: boolean;
      audioSuccess: boolean;
      audioError?: string;
      infoSuccess: boolean;
      infoError?: string;
      downloadPageUrl?: string;
    }) => {
      const {
        qItem,
        shouldDownloadAudio,
        shouldDownloadInfo,
        isPreorder,
        isPaidOnly,
        audioSuccess,
        audioError,
        infoSuccess,
        infoError,
        downloadPageUrl,
      } = params;

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

      qItem.audioDownloaded = finalAudioDl;
      qItem.infoZipDownloaded = finalInfoDl;
      qItem.stage = finalStage;
      qItem.stageProgress = 100;
      qItem.statusText = finalStatusText;

      logAndSyncForItem(qItem.id, finalStage, finalStatusText, audioError || infoError || undefined, 100);
      const updatedSess = updateQueueItem(currentHostname, qItem.id, {
        audioDownloaded: finalAudioDl,
        infoZipDownloaded: finalInfoDl,
        stage: finalStage,
        statusText: finalStatusText,
        stageProgress: 100,
        freeDownloadPageUrl: downloadPageUrl || qItem.freeDownloadPageUrl,
        error: audioError ? `Audio: ${audioError}` : (infoError ? `Info: ${infoError}` : undefined),
      });
      if (updatedSess) {
        updateCurrentSession(updatedSess);
      }

      setReleases((prev) =>
        prev.map((r) =>
          r.id === qItem.id
            ? {
                ...r,
                audioDownloaded: finalAudioDl,
                infoZipDownloaded: finalInfoDl,
                freeDownloadPageUrl: downloadPageUrl || r.freeDownloadPageUrl,
              }
            : r
        )
      );
    };

    const runCompanionInfoForItem = async (
      qItem: QueueItem,
      rel: any,
      audioFilename: string,
      resolveData?: any
    ): Promise<{ infoSuccess: boolean; infoError?: string }> => {
      try {
        logAndSyncForItem(
          qItem.id,
          'packaging_info',
          'Packaging companion (info).zip (info.txt, cover.jpg, artist.jpg, photos/, .lrc)...',
          undefined,
          86
        );

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
        logAndSyncForItem(
          qItem.id,
          'packaging_info',
          `Created companion ZIP: ${companionName} (${companionResult.filesCount} files)`,
          undefined,
          92
        );
        return { infoSuccess: true };
      } catch (iErr: any) {
        const infoError = iErr.message || 'Failed packaging info archive';
        debugLog('pipeline', `Info archive error for "${qItem.title}":`, infoError);
        logAndSyncForItem(qItem.id, 'packaging_info', `Info ZIP failed: ${infoError}`, infoError, 92);
        return { infoSuccess: false, infoError };
      }
    };

    const resolveAndDownloadAudioForItem = async (params: {
      qItem: QueueItem;
      rel: any;
      audioFilename: string;
      downloadPageUrl?: string;
    }): Promise<{ audioSuccess: boolean; audioError?: string; resolveData?: any }> => {
      const { qItem, rel, audioFilename, downloadPageUrl } = params;
      const effectiveArtist = rel.artist || qItem.artist;
      const effectiveAlbum = rel.title || qItem.title;

      try {
        logAndSyncForItem(
          qItem.id,
          'resolving_stat',
          `Resolving studio master download URL for format: ${selectedFormat.toUpperCase()}...`,
          undefined,
          60
        );

        const resolveData = await apiClient.resolveDownload({
          albumUrl: qItem.url,
          releaseId: qItem.id,
          itemId: qItem.itemId,
          itemType: qItem.itemType,
          format: selectedFormat,
          email: settings.fallbackEmail,
          downloadPageUrl,
          release: qItem,
        });

        logAndSyncForItem(
          qItem.id,
          'downloading_audio',
          `Downloading studio audio (${selectedFormat.toUpperCase()})...`,
          undefined,
          72
        );

        if (resolveData?.isPaid && resolveData?.skipAudio) {
          logAndSyncForItem(
            qItem.id,
            'downloading_audio',
            `Paid release (${resolveData.message || 'audio skipped per policy'}).`,
            undefined,
            78
          );
          return { audioSuccess: false, resolveData };
        }

        if (resolveData?.success && resolveData?.downloadUrl) {
          debugLog('pipeline', 'Downloading resolved studio audio:', resolveData.downloadUrl, 'as', audioFilename);
          await apiClient.downloadAudioFile(resolveData.downloadUrl, audioFilename);
          successfulDownloadsCount++;
          logAndSyncForItem(qItem.id, 'downloading_audio', `Studio audio saved: ${audioFilename}`, undefined, 82);
          return { audioSuccess: true, resolveData };
        }

        if (
          selectedFormat === 'mp3-128' &&
          (resolveData?.audioStreams || rel.audioStreams) &&
          (resolveData?.audioStreams || rel.audioStreams).length > 0
        ) {
          const streamsToDl = resolveData?.audioStreams || rel.audioStreams;
          for (let sIdx = 0; sIdx < streamsToDl.length; sIdx++) {
            const stream = streamsToDl[sIdx];
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

              logAndSyncForItem(
                qItem.id,
                'downloading_audio',
                `Downloading track ${sIdx + 1}/${streamsToDl.length}: ${stream.title}...`,
                undefined,
                70 + Math.round(((sIdx + 1) / streamsToDl.length) * 12)
              );
              await apiClient.downloadAudioFile(streamUrl, streamName);
              await sleep(600);
            }
          }
          successfulDownloadsCount++;
          return { audioSuccess: true, resolveData };
        }

        const audioError = resolveData?.error || 'Studio audio download link required or timed out on server';
        logAndSyncForItem(qItem.id, 'downloading_audio', `Studio audio not resolved: ${audioError}`, audioError, 80);
        return { audioSuccess: false, audioError, resolveData };
      } catch (aErr: any) {
        const audioError = aErr.message || 'Audio processing failed';
        debugLog('pipeline', `Audio error for "${qItem.title}":`, audioError);
        logAndSyncForItem(qItem.id, 'downloading_audio', `Audio download failed: ${audioError}`, audioError, 80);
        return { audioSuccess: false, audioError };
      }
    };

    // =========================================================================
    // PHASE 1: Optional initial full-batch mail lookup (ignores gasBatchSize)
    // Only executes if GAS webhook is configured AND Mail Offset is NOT "No offset"
    // =========================================================================
    if (hasGasWatchdog && settings.gasSearchFilterType !== 'no_offset' && !isCancelledRef.current) {
      const initialCandidates: Array<{ qItem: QueueItem; desc: ReturnType<typeof getItemDescriptor> }> = [];
      for (const cand of itemsToProcess) {
        const desc = getItemDescriptor(cand);
        if (
          desc.shouldDownloadAudio &&
          !desc.isPreorder &&
          !desc.isPaidOnly &&
          !desc.downloadPageUrl &&
          (desc.isEmailEligible || desc.isOwned)
        ) {
          initialCandidates.push({ qItem: cand, desc });
        }
      }

      if (initialCandidates.length > 0) {
        let initialSinceEpoch = 0;
        if (settings.gasSearchFilterType === 'start_date' && settings.gasSearchStartDate) {
          const d = new Date(settings.gasSearchStartDate);
          if (!isNaN(d.getTime())) {
            initialSinceEpoch = Math.floor(d.getTime() / 1000);
          }
        }
        if (!initialSinceEpoch) {
          const offsetHours = settings.gasSearchOffsetHours || 72;
          initialSinceEpoch = Math.floor(Date.now() / 1000) - Math.round(offsetHours * 3600);
        }

        setPacingNotice(
          `Pre-checking Gmail for all ${initialCandidates.length} email/owned release${initialCandidates.length === 1 ? '' : 's'}...`
        );
        initialCandidates.forEach(({ qItem }) => {
          logAndSyncForItem(
            qItem.id,
            'checking_mail',
            `Checking Gmail in initial batch lookup (${initialCandidates.length} items)...`,
            undefined,
            14
          );
        });

        try {
          const preResp = await apiClient.checkGasWebhookBatch({
            webhookUrl: settings.gasWebhookUrl.trim(),
            secret: settings.gasSecret.trim(),
            since: initialSinceEpoch,
            timeoutSeconds: settings.gasMailCheckTimeoutSeconds || 90,
            items: initialCandidates.map(({ qItem }) => ({
              title: qItem.title,
              id: qItem.itemId || qItem.id,
            })),
          });
          debugLog('gas', 'Phase 1 initial full-batch GAS check response:', preResp);

          const results = Array.isArray(preResp?.results) ? preResp.results : [];
          let foundCount = 0;
          initialCandidates.forEach(({ qItem }, idx) => {
            const hit = matchBatchResultForItem(results, qItem, idx);
            if (hit && hit.found && hit.downloadPageUrl) {
              foundCount++;
              resolvedMailLinks.set(qItem.id, hit.downloadPageUrl);
              logAndSyncForItem(
                qItem.id,
                'checking_mail',
                'Found existing signed download link in Gmail! Skipping new email dispatch.',
                undefined,
                52
              );
            } else {
              logAndSyncForItem(
                qItem.id,
                'checking_mail',
                'No pre-existing email link found; queued for email dispatch.',
                undefined,
                20
              );
            }
          });
          debugLog('gas', `Phase 1 pre-lookup matched ${foundCount}/${initialCandidates.length} item(s).`);
        } catch (gasErr: any) {
          debugLog('gas', 'Phase 1 initial batch GAS check error:', gasErr);
          console.warn('Initial GAS batch check warning:', gasErr);
        } finally {
          setPacingNotice('');
        }
      }
    }

    // =========================================================================
    // Async batch mail queue & bounded-concurrency audio download worker helpers
    // =========================================================================
    interface PendingMailEntry {
      qItem: QueueItem;
      rel: any;
      desc: ReturnType<typeof getItemDescriptor>;
      since: number;
      audioFilename: string;
      infoSuccess: boolean;
      infoError?: string;
    }

    let pendingMailQueue: PendingMailEntry[] = [];
    const activeAudioTasks: Promise<void>[] = [];
    const maxAudioConcurrency = Math.max(1, settings.concurrentDownloads || 3);
    let inFlightAudioCount = 0;
    const slotWaiters: Array<() => void> = [];

    const acquireAudioSlot = async () => {
      while (inFlightAudioCount >= maxAudioConcurrency) {
        await new Promise<void>((resolve) => slotWaiters.push(resolve));
      }
      inFlightAudioCount++;
    };

    const releaseAudioSlot = () => {
      inFlightAudioCount = Math.max(0, inFlightAudioCount - 1);
      const next = slotWaiters.shift();
      if (next) next();
    };

    const enqueueAsyncAudioDownload = (entry: PendingMailEntry, mailLink: string) => {
      const taskPromise = (async () => {
        await acquireAudioSlot();
        try {
          if (isCancelledRef.current) {
            finalizeItemOutcome({
              qItem: entry.qItem,
              shouldDownloadAudio: true,
              shouldDownloadInfo: entry.desc.shouldDownloadInfo,
              isPreorder: false,
              isPaidOnly: false,
              audioSuccess: false,
              audioError: 'Cancelled by user',
              infoSuccess: entry.infoSuccess,
              infoError: entry.infoError,
              downloadPageUrl: mailLink,
            });
            return;
          }

          const { audioSuccess, audioError } = await resolveAndDownloadAudioForItem({
            qItem: entry.qItem,
            rel: entry.rel,
            audioFilename: entry.audioFilename,
            downloadPageUrl: mailLink,
          });

          finalizeItemOutcome({
            qItem: entry.qItem,
            shouldDownloadAudio: true,
            shouldDownloadInfo: entry.desc.shouldDownloadInfo,
            isPreorder: false,
            isPaidOnly: false,
            audioSuccess,
            audioError,
            infoSuccess: entry.infoSuccess,
            infoError: entry.infoError,
            downloadPageUrl: mailLink,
          });
        } finally {
          releaseAudioSlot();
        }
      })();
      activeAudioTasks.push(taskPromise);
    };

    // Single batch mail lookup for all currently pending items (NEVER uses mail offset, ONLY per-item trigger since)
    const runPendingMailLookupOnce = async (cycleNum?: number, maxCycles?: number) => {
      if (!hasGasWatchdog || pendingMailQueue.length === 0 || isCancelledRef.current) return;

      const snapshot = [...pendingMailQueue];
      const label = cycleNum
        ? `Batch mail retry ${cycleNum}/${maxCycles} (${snapshot.length} pending)...`
        : `Checking Gmail for ${snapshot.length} triggered release${snapshot.length === 1 ? '' : 's'}...`;
      setPacingNotice(label);

      snapshot.forEach((entry) => {
        logAndSyncForItem(
          entry.qItem.id,
          'polling_gas',
          cycleNum
            ? `Batch polling Gmail (attempt ${cycleNum}/${maxCycles} · ${snapshot.length} pending)...`
            : `Running batch mail check (${snapshot.length} pending)...`,
          undefined,
          cycleNum ? Math.min(54, 42 + Math.round((cycleNum / Math.max(1, maxCycles || 1)) * 12)) : 44
        );
      });

      try {
        const resp = await apiClient.checkGasWebhookBatch({
          webhookUrl: settings.gasWebhookUrl.trim(),
          secret: settings.gasSecret.trim(),
          timeoutSeconds: settings.gasMailCheckTimeoutSeconds || 90,
          items: snapshot.map((entry) => ({
            title: entry.qItem.title,
            id: entry.qItem.itemId || entry.qItem.id,
            since: entry.since,
          })),
        });
        debugLog('gas', 'In-process / end batch lookup response:', resp);

        const results = Array.isArray(resp?.results) ? resp.results : [];
        const stillPending: PendingMailEntry[] = [];

        snapshot.forEach((entry, idx) => {
          const hit = matchBatchResultForItem(results, entry.qItem, idx);
          if (hit && hit.found && hit.downloadPageUrl) {
            resolvedMailLinks.set(entry.qItem.id, hit.downloadPageUrl);
            logAndSyncForItem(
              entry.qItem.id,
              'polling_gas',
              'Received signed download link! Starting audio download...',
              undefined,
              56
            );
            enqueueAsyncAudioDownload(entry, hit.downloadPageUrl);
          } else {
            logAndSyncForItem(
              entry.qItem.id,
              'polling_gas',
              cycleNum
                ? `Email link not in Gmail yet (attempt ${cycleNum}/${maxCycles})...`
                : 'Email not received yet; remaining pending until next check.',
              undefined,
              46
            );
            stillPending.push(entry);
          }
        });

        pendingMailQueue = stillPending;
      } catch (err: any) {
        debugLog('gas', 'Batch mail lookup error:', err);
      } finally {
        setPacingNotice('');
      }
    };

    // =========================================================================
    // PHASE 2: Main Item Processing Loop (asynchronous mailing)
    // =========================================================================
    const configuredBatch = settings.gasBatchSize ?? 10;
    const batchLimit = configuredBatch <= 0 ? 0 : Math.max(1, configuredBatch);

    for (let i = 0; i < itemsToProcess.length; i++) {
      if (isCancelledRef.current) {
        debugLog('pipeline', 'Download pipeline cancelled by user.');
        break;
      }

      const qItem = itemsToProcess[i];
      const rel = releases.find((r) => r.id === qItem.id) || (qItem as any);

      debugLog('pipeline', `[${i + 1}/${itemsToProcess.length}] Processing "${qItem.title}" (${qItem.itemType}, ID: ${qItem.itemId})...`);

      try {
        const desc = getItemDescriptor(qItem);
        let downloadPageUrl = desc.downloadPageUrl;
        const {
          isOwned,
          isEmailEligible,
          isPreorder,
          isPaidOnly,
          shouldDownloadAudio,
          shouldDownloadInfo,
        } = desc;

        const effectiveArtist = rel.artist || qItem.artist;
        const effectiveAlbum = rel.title || qItem.title;
        const effectiveIsArchive = qItem.itemType === 'album';

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

        let audioSuccess = Boolean(qItem.audioDownloaded);
        let audioError: string | undefined = undefined;
        let infoSuccess = Boolean(qItem.infoZipDownloaded);
        let infoError: string | undefined = undefined;
        let resolveData: any = null;
        let queuedForAsyncMail = false;
        let triggeredSinceEpoch = 0;

        // Stage 3b: If release is "Own" (purchased) and no email download link was found, check logged-in Bandcamp user collection
        if (shouldDownloadAudio && !isPreorder && !isPaidOnly && isOwned && !downloadPageUrl && apiClient.isExtension) {
          logAndSyncForItem(
            qItem.id,
            'resolving_stat',
            `Searching your Bandcamp collection for purchased download link ("${qItem.title}")...`,
            undefined,
            55
          );
          try {
            const colData = await apiClient.findCollectionDownload({
              albumUrl: qItem.url,
              itemId: qItem.itemId,
              title: qItem.title,
              artist: effectiveArtist,
              collectionUrl: qItem.collectionUrl || rel.collectionUrl,
            });
            debugLog('pipeline', 'Collection search response:', colData);
            if (colData && colData.found && colData.downloadPageUrl) {
              downloadPageUrl = colData.downloadPageUrl;
              logAndSyncForItem(qItem.id, 'resolving_stat', 'Found download link in your Bandcamp collection!', undefined, 58);
            } else if (colData?.error) {
              logAndSyncForItem(qItem.id, 'resolving_stat', `Collection lookup note: ${colData.error}`, undefined, 56);
            }
          } catch (colErr: any) {
            debugLog('pipeline', 'Collection search warning:', colErr);
          }
        }

        // --- SECTION 1: Audio Dispatch (Async Email vs Synchronous Direct Download) ---
        if (shouldDownloadAudio) {
          if (isPreorder) {
            logAndSyncForItem(
              qItem.id,
              'downloading_audio',
              'Pre-order release: audio master is not yet available prior to official release date. Packaging companion info ZIP.',
              undefined,
              74
            );
          } else if (isPaidOnly) {
            logAndSyncForItem(
              qItem.id,
              'downloading_audio',
              'Paid release (audio skipped per policy). Packaging companion info ZIP.',
              undefined,
              78
            );
          } else if (!downloadPageUrl && isEmailEligible) {
            // Trigger Bandcamp email dispatch asynchronously and mark item as pending mail lookup!
            triggeredSinceEpoch = Math.floor(Date.now() / 1000);
            logAndSyncForItem(
              qItem.id,
              'triggering_email',
              `Triggering Bandcamp email dispatch to ${settings.fallbackEmail || 'listener'}...`,
              undefined,
              28
            );
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
              debugLog('pipeline', `triggerEmailDownload response for ${qItem.title}:`, trigData);
              if (hasGasWatchdog) {
                if (trigData && (trigData.ok || trigData.success)) {
                  queuedForAsyncMail = true;
                  logAndSyncForItem(
                    qItem.id,
                    'polling_gas',
                    'Email triggered; queued for asynchronous batch mail lookup.',
                    undefined,
                    38
                  );
                } else {
                  audioError = trigData?.error || 'Bandcamp did not confirm email dispatch';
                  logAndSyncForItem(qItem.id, 'triggering_email', `Email request failed: ${audioError}`, audioError, 32);
                }
              } else {
                audioError = 'Email triggered; configure GAS webhook in Settings to retrieve links automatically.';
                logAndSyncForItem(qItem.id, 'triggering_email', audioError, audioError, 32);
              }
            } catch (trigErr: any) {
              audioError = trigErr?.message || 'Failed triggering email download';
              logAndSyncForItem(qItem.id, 'triggering_email', `Email trigger error: ${audioError}`, audioError, 32);
            }
          } else {
            // Synchronous audio resolution (Free / Own / Pre-resolved email link)
            const audioRes = await resolveAndDownloadAudioForItem({
              qItem,
              rel,
              audioFilename,
              downloadPageUrl,
            });
            audioSuccess = audioRes.audioSuccess;
            audioError = audioRes.audioError;
            resolveData = audioRes.resolveData;
          }
        }

        // --- SECTION 2: Companion Info Archive Packaging ---
        if (shouldDownloadInfo) {
          const infoRes = await runCompanionInfoForItem(qItem, rel, audioFilename, resolveData);
          infoSuccess = infoRes.infoSuccess;
          infoError = infoRes.infoError;
        }

        // --- SECTION 3: Finalize non-pending items OR enqueue pending mail entry ---
        if (queuedForAsyncMail) {
          const updatedSess = updateQueueItem(currentHostname, qItem.id, {
            infoZipDownloaded: Boolean(qItem.infoZipDownloaded || infoSuccess),
            stage: 'polling_gas',
            stageProgress: 42,
            statusText: infoSuccess
              ? 'Info ZIP saved · Pending batch mail lookup...'
              : 'Email triggered · Pending batch mail lookup...',
            ...(infoError ? { error: `Info: ${infoError}` } : {}),
          });
          if (updatedSess) updateCurrentSession(updatedSess);

          if (infoSuccess) {
            setReleases((prev) =>
              prev.map((r) => (r.id === qItem.id ? { ...r, infoZipDownloaded: true } : r))
            );
          }

          pendingMailQueue.push({
            qItem,
            rel,
            desc,
            since: triggeredSinceEpoch,
            audioFilename,
            infoSuccess,
            infoError,
          });
        } else {
          finalizeItemOutcome({
            qItem,
            shouldDownloadAudio,
            shouldDownloadInfo,
            isPreorder,
            isPaidOnly,
            audioSuccess,
            audioError,
            infoSuccess,
            infoError,
            downloadPageUrl,
          });
        }

        // --- SECTION 4: Anti-Captcha Jitter Pacing & Cool-Down ---
        if (i < itemsToProcess.length - 1 && !isCancelledRef.current) {
          if (!queuedForAsyncMail) {
            logAndSyncForItem(qItem.id, 'pacing', 'Applying anti-captcha pacing delay...', undefined, 95);
          }

          if (
            settings.cooldownBatchInterval > 0 &&
            successfulDownloadsCount > 0 &&
            successfulDownloadsCount % settings.cooldownBatchInterval === 0
          ) {
            const msg = `Batch interval reached: Cooling down for ${settings.cooldownDurationSeconds}s...`;
            setPacingNotice(msg);
            await sleep(settings.cooldownDurationSeconds * 1000);
            setPacingNotice('');
          } else {
            const delayMs = calculatePacingDelayMs(
              settings.pacingBaseDelaySeconds,
              settings.pacingJitterPercent
            );
            const msg = `Pacing pause (${(delayMs / 1000).toFixed(1)}s)...`;
            setPacingNotice(msg);
            await sleep(delayMs);
            setPacingNotice('');
          }
        }

        // --- SECTION 5: Batch Mail Lookup Trigger (when batch limit OR end of list is hit; NO retries here) ---
        const hitBatchLimit = batchLimit > 0 && pendingMailQueue.length >= batchLimit;
        const hitEndOfList = i === itemsToProcess.length - 1;
        if (hasGasWatchdog && pendingMailQueue.length > 0 && (hitBatchLimit || hitEndOfList) && !isCancelledRef.current) {
          await runPendingMailLookupOnce();
        }
      } catch (itemErr: any) {
        console.error(`Error processing ${qItem.title}:`, itemErr);
        logAndSyncForItem(qItem.id, 'failed', `Failed: ${itemErr.message || 'Unknown error'}`, itemErr.message, 100);
      }
    }

    // =========================================================================
    // PHASE 3: End-of-Pipeline Pending Mail Retries (if pending items remain)
    // Never uses mail offset; uses per-item trigger since only.
    // =========================================================================
    if (hasGasWatchdog && pendingMailQueue.length > 0 && !isCancelledRef.current) {
      const timeoutSeconds = settings.gasMailCheckTimeoutSeconds || 90;
      const maxGasCycles = settings.gasMaxPollCycles || Math.ceil(timeoutSeconds / 5);

      for (let cycle = 0; cycle < maxGasCycles && pendingMailQueue.length > 0; cycle++) {
        if (isCancelledRef.current) break;

        setPacingNotice(
          `Waiting for ${pendingMailQueue.length} pending email link${pendingMailQueue.length === 1 ? '' : 's'} (retry ${cycle + 1}/${maxGasCycles})...`
        );
        await sleep(5000);
        if (isCancelledRef.current) break;

        await runPendingMailLookupOnce(cycle + 1, maxGasCycles);
      }
    }

    // Finalize any items that remained unresolved in pendingMailQueue after timeout or cancellation
    if (pendingMailQueue.length > 0) {
      const remainingErr = isCancelledRef.current
        ? 'Cancelled while waiting for Bandcamp email link'
        : 'Signed Bandcamp download link not received in Gmail before timeout';
      pendingMailQueue.forEach((entry) => {
        finalizeItemOutcome({
          qItem: entry.qItem,
          shouldDownloadAudio: true,
          shouldDownloadInfo: entry.desc.shouldDownloadInfo,
          isPreorder: false,
          isPaidOnly: false,
          audioSuccess: false,
          audioError: remainingErr,
          infoSuccess: entry.infoSuccess,
          infoError: entry.infoError,
        });
      });
      pendingMailQueue = [];
    }

    // Wait for all parallel email audio downloads to finish cleanly
    if (activeAudioTasks.length > 0) {
      setPacingNotice('Finishing parallel audio downloads...');
      await Promise.all(activeAudioTasks);
    }

    setIsDownloading(false);
    setPacingNotice('');
    debugLog('pipeline', `=== Finished async batch pipeline. Successful downloads: ${successfulDownloadsCount} ===`);
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

  // Toggle selection state for currently displayed/filtered items
  const handleToggleDisplayed = (displayedIds: string[]) => {
    if (!displayedIds || displayedIds.length === 0) return;
    const idSet = new Set(displayedIds);
    setReleases((prev) => {
      const displayed = prev.filter((r) => idSet.has(r.id));
      if (displayed.length === 0) return prev;
      const allSelected = displayed.every((r) => Boolean(r.selected));
      return prev.map((r) => (idSet.has(r.id) ? { ...r, selected: !allSelected } : r));
    });
  };

  // Apply matched list items: de-select from queue and mark as Audio Downloaded
  const handleApplyScanList = (matchedReleaseIds: string[], alsoMarkInfoZip?: boolean) => {
    if (!matchedReleaseIds || matchedReleaseIds.length === 0) return;
    const matchSet = new Set(matchedReleaseIds);

    const updated = releases.map((r) => {
      if (matchSet.has(r.id)) {
        return {
          ...r,
          selected: false,
          audioDownloaded: true,
          ...(alsoMarkInfoZip ? { infoZipDownloaded: true } : {}),
        };
      }
      return r;
    });

    setReleases(updated);

    // Update persistent queue session items
    matchedReleaseIds.forEach((id) => {
      updateQueueItem(currentHostname, id, {
        audioDownloaded: true,
        ...(alsoMarkInfoZip ? { infoZipDownloaded: true } : {}),
      });
    });

    const refreshed = syncSessionFromStorage(currentHostname);
    if (refreshed) updateCurrentSession(refreshed);

    // Persist to local & extension storage cache
    saveToLocalCache(url, releases[0]?.artist || 'Artist', updated);

    setScanProgressText(
      `List Scan: De-selected & marked ${matchedReleaseIds.length} release${matchedReleaseIds.length === 1 ? '' : 's'} as Audio Downloaded.`
    );
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
    const stage: QueueItemStage = q?.stage || 'pending';
    let status: DownloadTask['status'] = 'queued';

    if (q) {
      switch (q.stage) {
        case 'completed':
        case 'skipped':
          status = 'completed';
          break;
        case 'failed':
          status = 'error';
          break;
        case 'pacing':
        case 'packaging_info':
        case 'downloading_audio':
          status = 'downloading';
          break;
        case 'resolving_stat':
        case 'polling_gas':
        case 'triggering_email':
        case 'checking_mail':
          status = 'resolving';
          break;
        case 'pending':
        default:
          status = 'queued';
          break;
      }
    }

    const stageName = getStageDisplayName(stage);
    const defaultProg = getStageDefaultProgress(stage);
    const progress =
      typeof q?.stageProgress === 'number'
        ? q.stageProgress
        : defaultProg;

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
      statusText: q?.statusText || stageName,
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
              onToggleDisplayed={handleToggleDisplayed}
              onOpenScanList={() => setIsScanListOpen(true)}
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
          mailFilterType={settings.gasSearchFilterType}
          mailOffsetHours={settings.gasSearchOffsetHours}
          mailStartDate={settings.gasSearchStartDate}
          onMailOffsetChange={(updates) =>
            setSettings((prev) => ({
              ...prev,
              ...updates,
            }))
          }
        />
      )}

      {/* Scan List Modal */}
      <ScanListModal
        isOpen={isScanListOpen}
        onClose={() => setIsScanListOpen(false)}
        releases={releases}
        onApplyMatches={handleApplyScanList}
      />
    </div>
  );
}
