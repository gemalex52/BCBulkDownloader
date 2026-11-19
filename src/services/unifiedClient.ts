declare const chrome: any;

// Unified Client & Storage Adapter for both Web App and Chrome Extension
import { ScannedRelease } from '../types/bandcamp';

export const isExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);

const memoryStorageFallback = new Map<string, any>();

/**
 * Storage adapter using chrome.storage.local (unlimitedStorage) with in-memory fallback outside extension
 */
export const storage = {
  async get<T = any>(key: string, defaultValue?: T): Promise<T> {
    if (isExtension && chrome.storage?.local) {
      return new Promise<T>((resolve) => {
        chrome.storage.local.get([key], (res: any) => {
          if (chrome.runtime.lastError || res[key] === undefined) {
            resolve(defaultValue as T);
          } else {
            resolve(res[key]);
          }
        });
      });
    }

    if (memoryStorageFallback.has(key)) {
      return memoryStorageFallback.get(key) as T;
    }
    return defaultValue as T;
  },

  async set(key: string, value: any): Promise<void> {
    if (isExtension && chrome.storage?.local) {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      });
    }

    memoryStorageFallback.set(key, value);
  },

  async remove(key: string): Promise<void> {
    if (isExtension && chrome.storage?.local) {
      return new Promise<void>((resolve) => {
        chrome.storage.local.remove([key], () => resolve());
      });
    }

    memoryStorageFallback.delete(key);
  }
};

/**
 * Background RPC helper for Chrome Extension with timeout safeguard
 */
function sendExtensionMessage<T = any>(message: any, timeoutMs = 25000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!chrome?.runtime?.sendMessage) {
      return reject(new Error('chrome.runtime.sendMessage is not available'));
    }

    let completed = false;
    const timer = setTimeout(() => {
      if (completed) return;
      completed = true;
      reject(new Error(`Extension background worker timed out after ${Math.round(timeoutMs / 1000)}s (action: ${message?.action})`));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, (response: any) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (chrome.runtime?.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(response);
      });
    } catch (err: any) {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        reject(err);
      }
    }
  });
}

/**
 * Unified API Client for discovering catalog, resolving downloads, querying GAS, and downloading
 */
export const apiClient = {
  isExtension,

  async fetchActiveTabUrl(): Promise<string | null> {
    if (isExtension && chrome.tabs?.query) {
      return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
          const tabUrl = tabs?.[0]?.url;
          if (
            tabUrl &&
            !tabUrl.startsWith('chrome-extension://') &&
            !tabUrl.startsWith('moz-extension://') &&
            !tabUrl.includes('dashboard.html') &&
            (tabUrl.includes('.bandcamp.com') || tabUrl.includes('bandcamp.com/'))
          ) {
            resolve(tabUrl);
          } else {
            resolve(null);
          }
        });
      });
    }
    return null;
  },

  async discoverCatalog(url: string, skipTrackSubpages: boolean = true): Promise<any> {
    if (isExtension) {
      return sendExtensionMessage({
        action: 'DISCOVER_CATALOG',
        url,
        skipTrackSubpages,
      });
    }

    const res = await fetch('/api/bandcamp/scan-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, skipTrackSubpages }),
    });
    if (!res.ok) throw new Error(`Scan catalog HTTP ${res.status}`);
    return res.json();
  },

  async inspectRelease(origin: string, artistName: string, item: any, globalBioUrl?: string): Promise<any> {
    if (isExtension) {
      return sendExtensionMessage({
        action: 'INSPECT_RELEASE',
        origin,
        artistName,
        item,
        globalBioUrl,
      });
    }

    const res = await fetch('/api/bandcamp/inspect-release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, artistName, item, globalBioUrl }),
    });
    if (!res.ok) throw new Error(`Inspect release HTTP ${res.status}`);
    return res.json();
  },

  async resolveDownload(params: {
    albumUrl?: string;
    releaseId?: string;
    itemId?: number;
    itemType?: string;
    format: string;
    email?: string;
    downloadPageUrl?: string;
    triggerEmailOnly?: boolean;
    release?: ScannedRelease | any;
  }): Promise<any> {
    if (isExtension) {
      return sendExtensionMessage({
        action: 'RESOLVE_DOWNLOAD',
        ...params,
      }, 120000);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch('/api/bandcamp/resolve-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Resolve download HTTP ${res.status}`);
      return res.json();
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Download resolution timed out after 90s on Bandcamp server');
      }
      throw err;
    }
  },

  async findCollectionDownload(params: {
    albumUrl?: string;
    itemId?: number;
    title?: string;
    artist?: string;
    collectionUrl?: string;
  }): Promise<{ found: boolean; downloadPageUrl?: string; collectionUrl?: string; source?: string; error?: string }> {
    if (isExtension) {
      return sendExtensionMessage({
        action: 'FIND_COLLECTION_DOWNLOAD',
        ...params,
      }, 30000);
    }
    return {
      found: false,
      error: 'Bandcamp collection lookup requires the Chrome Extension browser session.',
    };
  },

  async checkGasWebhook(params: {
    webhookUrl: string;
    secret: string;
    releaseId?: string | number;
    title?: string;
    since?: number;
    timeoutSeconds?: number;
  }): Promise<any> {
    const batchRes = await this.checkGasWebhookBatch({
      webhookUrl: params.webhookUrl,
      secret: params.secret,
      since: params.since,
      timeoutSeconds: params.timeoutSeconds,
      items: [
        {
          id: params.releaseId ?? '',
          title: params.title || '',
          ...(params.since !== undefined ? { since: params.since } : {}),
        },
      ],
    });
    if (Array.isArray(batchRes?.results) && batchRes.results.length > 0) {
      return batchRes.results[0];
    }
    return { found: false, error: batchRes?.error || 'No result returned from GAS batch lookup' };
  },

  async checkGasWebhookBatch(params: {
    webhookUrl: string;
    secret: string;
    since?: number;
    items: Array<{
      id: string | number;
      title: string;
      since?: number;
    }>;
    timeoutSeconds?: number;
  }): Promise<{ success: boolean; results: any[]; error?: string }> {
    const timeoutSec = params.timeoutSeconds || 90;
    const timeoutMs = timeoutSec * 1000;

    if (isExtension) {
      return sendExtensionMessage({
        action: 'CHECK_GAS_WEBHOOK_BATCH',
        ...params,
        timeoutMs,
      }, timeoutMs + 15000);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('/api/bandcamp/check-gas-webhook-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`GAS batch check HTTP ${res.status}`);
      return res.json();
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        return { success: false, results: [], error: `GAS batch check timed out after ${timeoutSec}s` };
      }
      return { success: false, results: [], error: err?.message || String(err) };
    }
  },

  async testGasWebhook(params: { webhookUrl: string; secret: string }): Promise<any> {
    if (isExtension) {
      return sendExtensionMessage({
        action: 'TEST_GAS_WEBHOOK',
        ...params,
      }, 15000);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch('/api/bandcamp/test-gas-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.json();
    } catch (err: any) {
      clearTimeout(timeout);
      return { ok: false, success: false, error: err.name === 'AbortError' ? 'Webhook test timed out after 12s' : err.message };
    }
  },

  async triggerEmailDownload(
    origin: string,
    formatId: string,
    itemId: number,
    itemType: string,
    email: string,
    itemUrl?: string
  ): Promise<any> {
    if (isExtension) {
      return sendExtensionMessage({
        action: 'TRIGGER_EMAIL',
        origin,
        formatId,
        itemId,
        itemType,
        email,
        itemUrl,
      });
    }

    const res = await fetch('/api/bandcamp/resolve-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: formatId,
        itemId,
        itemType,
        email,
        itemUrl,
        triggerEmailOnly: true,
      }),
    });
    if (!res.ok) throw new Error(`Email trigger HTTP ${res.status}`);
    return res.json();
  },

  async downloadAudioFile(downloadUrl: string, filename: string): Promise<void> {
    if (isExtension) {
      await sendExtensionMessage({
        action: 'DOWNLOAD_FILE',
        url: downloadUrl,
        filename,
      });
      return;
    }

    // Web app fallback: trigger through proxy-audio
    const proxyUrl = `/api/bandcamp/proxy-audio?url=${encodeURIComponent(downloadUrl)}&filename=${encodeURIComponent(filename)}`;
    const a = document.createElement('a');
    a.href = proxyUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  async downloadBlob(blob: Blob, filename: string): Promise<void> {
    if (isExtension) {
      if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
        const blobUrl = URL.createObjectURL(blob);
        try {
          await sendExtensionMessage({
            action: 'REGISTER_DOWNLOAD_FILENAME',
            url: blobUrl,
            filename,
          });
          await new Promise<void>((resolve, reject) => {
            chrome.downloads.download(
              {
                url: blobUrl,
                filename,
                conflictAction: 'uniquify',
              },
              (downloadId: any) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve();
                }
              }
            );
          });
          setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
          return;
        } catch (e) {
          console.warn('Direct blob chrome.downloads error, falling back to base64:', e);
        }
      }

      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      await sendExtensionMessage({
        action: 'DOWNLOAD_FILE',
        url: base64Data,
        filename,
      });
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  },

  async fetchBinaryAsBlob(url: string): Promise<Blob | null> {
    if (isExtension) {
      try {
        const res = await sendExtensionMessage<{ success: boolean; dataUrl?: string; error?: string }>({
          action: 'FETCH_BINARY_DATA_URL',
          url,
        });
        if (res?.success && res.dataUrl) {
          const fetched = await fetch(res.dataUrl);
          return fetched.blob();
        }
      } catch (e) {
        console.warn('Extension binary fetch failed:', e);
      }
      return null;
    }

    try {
      const res = await fetch(`/api/bandcamp/proxy-image?url=${encodeURIComponent(url)}`);
      if (res.ok) return res.blob();
    } catch (e) {}
    return null;
  }
};
