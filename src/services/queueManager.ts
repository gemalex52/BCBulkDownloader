declare const chrome: any;

import {
  QueueItem,
  QueueItemStage,
  ItemStageLog,
  SiteQueueSession,
  ScannedRelease,
  AppSettings,
  DEFAULT_APP_SETTINGS,
} from '../types/bandcamp';

const SETTINGS_KEY = 'bc_global_settings_v2';
const SESSIONS_INDEX_KEY = 'bc_sessions_index_v2';

const sessionMemoryCache = new Map<string, SiteQueueSession>();

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

// 1. Settings persistence
export function loadAppSettings(): AppSettings {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
      }
    }
  } catch (e) {
    console.warn('Failed to load app settings from localStorage:', e);
  }
  return { ...DEFAULT_APP_SETTINGS };
}

export async function loadAppSettingsAsync(): Promise<AppSettings> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return new Promise<AppSettings>((resolve) => {
      chrome.storage.local.get([SETTINGS_KEY], (res: any) => {
        if (res && res[SETTINGS_KEY]) {
          resolve({ ...DEFAULT_APP_SETTINGS, ...res[SETTINGS_KEY] });
        } else {
          resolve(loadAppSettings());
        }
      });
    });
  }
  return loadAppSettings();
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }
  } catch (e) {
    console.warn('Failed to save app settings:', e);
  }
}

// 2. Multi-site session tracking
export function getStoredSessionHostnames(): string[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SESSIONS_INDEX_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (e) {}
  return [];
}

export function registerSessionHostname(hostname: string): void {
  try {
    const current = getStoredSessionHostnames();
    if (!current.includes(hostname)) {
      current.unshift(hostname);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(current.slice(0, 30)));
      }
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [SESSIONS_INDEX_KEY]: current.slice(0, 30) });
      }
    }
  } catch (e) {}
}

export function loadSiteSession(hostname: string): SiteQueueSession | null {
  const norm = (hostname || '').toLowerCase();
  if (sessionMemoryCache.has(norm)) {
    return sessionMemoryCache.get(norm)!;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const key = getSessionKey(norm);
      const raw = localStorage.getItem(key);
      if (raw) {
        const sess = JSON.parse(raw);
        sessionMemoryCache.set(norm, sess);
        return sess;
      }
    }
  } catch (e) {
    console.warn(`Failed loading session for ${hostname}:`, e);
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
          resolve(loadSiteSession(hostname));
        }
      });
    });
  }
  return loadSiteSession(hostname);
}

export function saveSiteSession(session: SiteQueueSession): void {
  try {
    const norm = (session.hostname || '').toLowerCase();
    const key = getSessionKey(norm);
    session.updatedAt = new Date().toISOString();
    sessionMemoryCache.set(norm, session);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, JSON.stringify(session));
      } catch (e) {}
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [key]: session });
    }
    registerSessionHostname(session.hostname);
  } catch (e) {
    console.warn(`Failed saving session for ${session.hostname}:`, e);
  }
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
      isPaid: Boolean(rel.badgeType === 'paid' || (!rel.isPurchased && !rel.freeDownloadPageUrl && !rel.requiresEmail && !rel.isNameYourPrice && (rel.minPrice || 0) > 0)),
      badgeType: rel.badgeType || (rel.isPurchased ? 'own' : (rel.freeDownloadPageUrl || (!rel.requiresEmail && !rel.isNameYourPrice && (rel.minPrice === 0 || rel.isFree)) ? 'free' : ((rel.requiresEmail || rel.isNameYourPrice) ? 'email' : 'paid'))),
      minPrice: rel.minPrice,
      requiresEmail: rel.requiresEmail,
      stage: prev ? prev.stage : 'pending',
      stageProgress: prev ? prev.stageProgress : 0,
      statusText: prev ? prev.statusText : (rel.priceFormatted || 'Pending'),
      audioDownloaded: prev ? prev.audioDownloaded : false,
      infoZipDownloaded: prev ? prev.infoZipDownloaded : false,
      audioFilename: prev?.audioFilename,
      infoZipFilename: prev?.infoZipFilename,
      audioDownloadUrl: prev?.audioDownloadUrl,
      freeDownloadPageUrl: rel.freeDownloadPageUrl || prev?.freeDownloadPageUrl,
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

  saveSiteSession(session);
  return session;
}

export function updateQueueItem(
  hostname: string,
  itemId: string,
  updates: Partial<QueueItem>
): SiteQueueSession | null {
  const session = loadSiteSession(hostname);
  if (!session || !session.items[itemId]) return null;

  session.items[itemId] = {
    ...session.items[itemId],
    ...updates,
    lastUpdated: new Date().toISOString(),
  };

  saveSiteSession(session);
  return session;
}

export function appendItemLog(
  hostname: string,
  itemId: string,
  stage: QueueItemStage,
  message: string,
  error?: string
): SiteQueueSession | null {
  const session = loadSiteSession(hostname);
  if (!session || !session.items[itemId]) return null;

  const item = session.items[itemId];
  const newLog: ItemStageLog = {
    timestamp: new Date().toLocaleTimeString(),
    stage,
    message,
    error,
  };

  item.stage = stage;
  item.statusText = message;
  if (error) item.error = error;
  item.logs = [...(item.logs || []), newLog].slice(-25); // retain last 25 logs
  item.lastUpdated = new Date().toISOString();

  saveSiteSession(session);
  return session;
}

export function resetItemForRetry(
  hostname: string,
  itemId: string,
  updates?: Partial<QueueItem>
): SiteQueueSession | null {
  const session = loadSiteSession(hostname);
  if (!session || !session.items[itemId]) return null;

  const item = session.items[itemId];
  item.stage = 'pending';
  item.stageProgress = 0;
  item.statusText = 'Ready for retry';
  item.error = undefined;
  item.retryCount = (item.retryCount || 0) + 1;
  if (updates) {
    Object.assign(item, updates);
  }
  item.logs.push({
    timestamp: new Date().toLocaleTimeString(),
    stage: 'pending',
    message: `Manual retry requested (Attempt #${item.retryCount + 1})`,
  });

  saveSiteSession(session);
  return session;
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
