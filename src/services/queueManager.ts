declare const chrome: any;

import {
  QueueItem,
  QueueItemStage,
  ItemStageLog,
  SiteQueueSession,
  ScannedRelease,
  AppSettings,
  DEFAULT_APP_SETTINGS,
  getStageDefaultProgress,
} from '../types/bandcamp';

const SETTINGS_KEY = 'bc_global_settings_v2';
const SESSIONS_INDEX_KEY = 'bc_sessions_index_v2';

const sessionMemoryCache = new Map<string, SiteQueueSession>();
let settingsMemoryCache: AppSettings = { ...DEFAULT_APP_SETTINGS };
let sessionIndexMemoryCache: string[] = [];

function cloneSession(session: SiteQueueSession): SiteQueueSession {
  return {
    ...session,
    items: { ...session.items },
  };
}

export function getDomainHostname(urlOrOrigin: string): string {
  try {
    if (!urlOrOrigin) return '';
    let target = urlOrOrigin.trim();
    if (target.includes('url=')) {
      const match = target.match(/url=([^&]+)/);
      if (match) {
        try {
          target = decodeURIComponent(match[1]);
        } catch (e) {
          target = match[1];
        }
      }
    }
    const u = new URL(target.startsWith('http') ? target : `https://${target}`);
    return u.hostname.toLowerCase();
  } catch (e) {
    return urlOrOrigin.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase();
  }
}

export function getSessionKey(hostname: string): string {
  return `bc_session_v2_${hostname.toLowerCase()}`;
}

// 1. Settings persistence (chrome.storage.local + memory cache)
export function loadAppSettings(): AppSettings {
  return { ...settingsMemoryCache };
}

export async function loadAppSettingsAsync(): Promise<AppSettings> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return new Promise<AppSettings>((resolve) => {
      chrome.storage.local.get([SETTINGS_KEY], (res: any) => {
        if (res && res[SETTINGS_KEY]) {
          settingsMemoryCache = { ...DEFAULT_APP_SETTINGS, ...res[SETTINGS_KEY] };
          resolve({ ...settingsMemoryCache });
        } else {
          resolve({ ...settingsMemoryCache });
        }
      });
    });
  }
  return { ...settingsMemoryCache };
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    settingsMemoryCache = { ...DEFAULT_APP_SETTINGS, ...settings };
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [SETTINGS_KEY]: settingsMemoryCache });
    }
  } catch (e) {
    console.warn('Failed to save app settings:', e);
  }
}

// 2. Multi-site session tracking (chrome.storage.local + memory cache)
export function getStoredSessionHostnames(): string[] {
  return [...sessionIndexMemoryCache];
}

export function registerSessionHostname(hostname: string): void {
  try {
    if (!hostname) return;
    if (!sessionIndexMemoryCache.includes(hostname)) {
      sessionIndexMemoryCache = [hostname, ...sessionIndexMemoryCache].slice(0, 30);
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [SESSIONS_INDEX_KEY]: sessionIndexMemoryCache });
      }
    }
  } catch (e) {}
}

export function loadSiteSession(hostname: string): SiteQueueSession | null {
  const norm = (hostname || '').toLowerCase();
  if (sessionMemoryCache.has(norm)) {
    return sessionMemoryCache.get(norm)!;
  }
  return null;
}

export async function loadSiteSessionAsync(hostname: string): Promise<SiteQueueSession | null> {
  const norm = (hostname || '').toLowerCase();
  if (sessionMemoryCache.has(norm)) {
    return sessionMemoryCache.get(norm)!;
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const key = getSessionKey(norm);
    return new Promise<SiteQueueSession | null>((resolve) => {
      chrome.storage.local.get([key], (res: any) => {
        if (res && res[key]) {
          sessionMemoryCache.set(norm, res[key]);
          resolve(res[key]);
        } else {
          resolve(null);
        }
      });
    });
  }
  return null;
}

export function saveSiteSession(session: SiteQueueSession): SiteQueueSession {
  const cloned = cloneSession({
    ...session,
    updatedAt: new Date().toISOString(),
  });
  try {
    const norm = (cloned.hostname || '').toLowerCase();
    const key = getSessionKey(norm);
    sessionMemoryCache.set(norm, cloned);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [key]: cloned });
    }
    registerSessionHostname(cloned.hostname);
  } catch (e) {
    console.warn(`Failed saving session for ${session.hostname}:`, e);
  }
  return cloned;
}

export function initSiteSession(
  hostname: string,
  origin: string,
  artistName: string,
  catalogUrl: string,
  releases: ScannedRelease[]
): SiteQueueSession {
  const existing = loadSiteSession(hostname);
  const itemsMap: Record<string, QueueItem> = {};
  const order: string[] = [];

  releases.forEach((rel) => {
    order.push(rel.id);
    const prev = existing?.items?.[rel.id];

    itemsMap[rel.id] = {
      id: rel.id,
      itemId: rel.itemId,
      itemType: rel.itemType,
      title: rel.title,
      artist: rel.artist || artistName,
      url: rel.url,
      artUrl: rel.artUrl,
      artistBioPicUrl: rel.artistBioPicUrl,
      extraImages: rel.extraImages,
      extraPhotos: rel.extraPhotos,
      downloadScope: rel.downloadScope || prev?.downloadScope || 'both',
      releaseDate: rel.releaseDate,
      isoDate: rel.isoDate,
      isFree: rel.isFree,
      isNameYourPrice: rel.isNameYourPrice,
      isPurchased: rel.isPurchased,
      isPaid: Boolean(
        rel.badgeType !== 'email' &&
        rel.badgeType !== 'no_digital' &&
        !rel.isNoDigital &&
        !rel.requiresEmail &&
        !rel.isNameYourPrice &&
        !rel.isPurchased &&
        (rel.badgeType === 'paid' || (!rel.freeDownloadPageUrl && !rel.isFree && (rel.minPrice || 0) > 0))
      ),
      isNoDigital: Boolean(rel.isNoDigital || rel.badgeType === 'no_digital'),
      badgeType: rel.badgeType || (rel.isPurchased ? 'own' : ((rel.isNoDigital) ? 'no_digital' : ((rel.requiresEmail || rel.isNameYourPrice) ? 'email' : ((rel.minPrice || 0) > 0 && !rel.isFree && !rel.freeDownloadPageUrl ? 'paid' : 'free')))),
      minPrice: rel.minPrice,
      requiresEmail: rel.requiresEmail,
      stage: prev ? prev.stage : 'pending',
      stageProgress: prev ? (prev.stageProgress ?? getStageDefaultProgress(prev.stage)) : 0,
      statusText: prev ? prev.statusText : (rel.priceFormatted || 'Pending'),
      audioDownloaded: prev ? prev.audioDownloaded : false,
      infoZipDownloaded: prev ? prev.infoZipDownloaded : false,
      audioFilename: prev?.audioFilename,
      infoZipFilename: prev?.infoZipFilename,
      audioDownloadUrl: prev?.audioDownloadUrl,
      freeDownloadPageUrl: rel.freeDownloadPageUrl || prev?.freeDownloadPageUrl,
      collectionUrl: rel.collectionUrl || prev?.collectionUrl,
      retryCount: prev ? prev.retryCount : 0,
      lastUpdated: new Date().toISOString(),
      error: prev?.error,
      logs: prev?.logs || [],
    };
  });

  const session: SiteQueueSession = {
    origin,
    hostname,
    artistName,
    catalogUrl,
    scannedAt: existing?.scannedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: itemsMap,
    itemOrder: order,
    inProgress: false,
  };

  return saveSiteSession(session);
}

export function updateQueueItem(
  hostname: string,
  itemId: string,
  updates: Partial<QueueItem>
): SiteQueueSession | null {
  const session = loadSiteSession(hostname);
  if (!session || !session.items[itemId]) return null;

  const prevItem = session.items[itemId];
  let nextStageProgress = updates.stageProgress;
  if (
    typeof nextStageProgress === 'number' &&
    prevItem.stage !== 'pending' &&
    updates.stage !== 'pending'
  ) {
    nextStageProgress = Math.max(prevItem.stageProgress || 0, Math.min(100, Math.round(nextStageProgress)));
  }

  const updatedItem: QueueItem = {
    ...prevItem,
    ...updates,
    ...(typeof nextStageProgress === 'number' ? { stageProgress: nextStageProgress } : {}),
    lastUpdated: new Date().toISOString(),
  };

  const nextSession: SiteQueueSession = {
    ...session,
    items: {
      ...session.items,
      [itemId]: updatedItem,
    },
  };

  return saveSiteSession(nextSession);
}

export function appendItemLog(
  hostname: string,
  itemId: string,
  stage: QueueItemStage,
  message: string,
  error?: string,
  progressOverride?: number
): SiteQueueSession | null {
  const session = loadSiteSession(hostname);
  if (!session || !session.items[itemId]) return null;

  const prevItem = session.items[itemId];
  const newLog: ItemStageLog = {
    timestamp: new Date().toLocaleTimeString(),
    stage,
    message,
    error,
  };

  const candidateProgress =
    typeof progressOverride === 'number'
      ? Math.max(0, Math.min(100, Math.round(progressOverride)))
      : getStageDefaultProgress(stage);

  const nextProgress =
    stage !== 'pending' && prevItem.stage !== 'pending'
      ? Math.max(prevItem.stageProgress || 0, candidateProgress)
      : candidateProgress;

  const updatedItem: QueueItem = {
    ...prevItem,
    stage,
    stageProgress: nextProgress,
    statusText: message,
    error: error !== undefined ? error : prevItem.error,
    logs: [...(prevItem.logs || []), newLog].slice(-25),
    lastUpdated: new Date().toISOString(),
  };

  const nextSession: SiteQueueSession = {
    ...session,
    items: {
      ...session.items,
      [itemId]: updatedItem,
    },
  };

  return saveSiteSession(nextSession);
}

export function resetItemForRetry(
  hostname: string,
  itemId: string,
  updates?: Partial<QueueItem>
): SiteQueueSession | null {
  const session = loadSiteSession(hostname);
  if (!session || !session.items[itemId]) return null;

  const prevItem = session.items[itemId];
  const nextRetry = (prevItem.retryCount || 0) + 1;
  const updatedItem: QueueItem = {
    ...prevItem,
    ...(updates || {}),
    stage: 'pending',
    stageProgress: 0,
    statusText: 'Ready for retry',
    error: undefined,
    retryCount: nextRetry,
    lastUpdated: new Date().toISOString(),
    logs: [
      ...(prevItem.logs || []),
      {
        timestamp: new Date().toLocaleTimeString(),
        stage: 'pending' as QueueItemStage,
        message: `Manual retry requested (Attempt #${nextRetry + 1})`,
      },
    ].slice(-25),
  };

  const nextSession: SiteQueueSession = {
    ...session,
    items: {
      ...session.items,
      [itemId]: updatedItem,
    },
  };

  return saveSiteSession(nextSession);
}

/**
 * Resets download state flags (audioDownloaded, infoZipDownloaded) and stage for a specific release
 */
export function resetItemState(
  hostname: string,
  itemId: string
): SiteQueueSession | null {
  const session = loadSiteSession(hostname);
  if (!session || !session.items[itemId]) return null;

  const prevItem = session.items[itemId];
  const updatedItem: QueueItem = {
    ...prevItem,
    audioDownloaded: false,
    infoZipDownloaded: false,
    stage: 'pending',
    stageProgress: 0,
    statusText: 'State reset',
    error: undefined,
    retryCount: 0,
    logs: [],
    lastUpdated: new Date().toISOString(),
  };

  const nextSession: SiteQueueSession = {
    ...session,
    items: {
      ...session.items,
      [itemId]: updatedItem,
    },
  };

  return saveSiteSession(nextSession);
}

/**
 * Resets download state flags and queue stages for all releases in the session
 */
export function resetAllItemsState(
  hostname: string
): SiteQueueSession | null {
  const session = loadSiteSession(hostname);
  if (!session) return null;

  const nextItems: Record<string, QueueItem> = {};
  const now = new Date().toISOString();
  Object.entries(session.items).forEach(([id, item]) => {
    nextItems[id] = {
      ...item,
      audioDownloaded: false,
      infoZipDownloaded: false,
      stage: 'pending',
      stageProgress: 0,
      statusText: 'State reset',
      error: undefined,
      retryCount: 0,
      logs: [],
      lastUpdated: now,
    };
  });

  return saveSiteSession({
    ...session,
    items: nextItems,
  });
}

// 3. Anti-captcha jitter & pacing calculations
export function calculatePacingDelayMs(baseDelaySeconds: number, jitterPercent: number): number {
  const baseMs = Math.max(500, baseDelaySeconds * 1000);
  const jitterFraction = Math.max(0, Math.min(100, jitterPercent)) / 100;
  const variation = (Math.random() * 2 - 1) * (baseMs * jitterFraction);
  return Math.max(300, Math.round(baseMs + variation));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
