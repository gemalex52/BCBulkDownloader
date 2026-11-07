declare const chrome: any;

// Unified Client & Storage Adapter for both Web App and Chrome Extension
import { ScannedRelease } from '../types/bandcamp';

export const isExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);

/**
 * Storage adapter supporting chrome.storage.local (unlimited) and localStorage fallback
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

    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        return JSON.parse(raw);
      }
    } catch (e) {}
    return defaultValue as T;
  },

  async set(key: string, value: any): Promise<void> {
    if (isExtension && chrome.storage?.local) {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      });
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('localStorage.setItem error:', e);
    }
  },

  async remove(key: string): Promise<void> {
    if (isExtension && chrome.storage?.local) {
      return new Promise<void>((resolve) => {
        chrome.storage.local.remove([key], () => resolve());
      });
    }

    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }
};

/**
 * Background RPC helper for Chrome Extension
 */
function sendExtensionMessage<T = any>(message: any): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.sendMessage) {
      return reject(new Error('chrome.runtime.sendMessage is not available'));
    }
    chrome.runtime.sendMessage(message, (response: any) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(response);
    });
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
          if (tabUrl && tabUrl.includes('bandcamp.com')) {
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
      });
    }

    const res = await fetch('/api/bandcamp/resolve-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Resolve download HTTP ${res.status}`);
    return res.json();
  },

  async checkGasWebhook(params: {
    webhookUrl: string;
    secret: string;
    releaseId?: string | number;
    title?: string;
    since?: number;
    hours?: number;
    days?: number;
    startDate?: string;
  }): Promise<any> {
    if (isExtension) {
      return sendExtensionMessage({
        action: 'CHECK_GAS_WEBHOOK',
        ...params,
      });
    }

    const res = await fetch('/api/bandcamp/check-gas-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`GAS check HTTP ${res.status}`);
    return res.json();
  },

  async testGasWebhook(params: { webhookUrl: string; secret: string }): Promise<any> {
    if (isExtension) {
      return sendExtensionMessage({
        action: 'TEST_GAS_WEBHOOK',
        ...params,
      });
    }

    const res = await fetch('/api/bandcamp/test-gas-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  },

  async triggerEmailDownload(origin: string, formatId: string, itemId: number, itemType: string, email: string): Promise<any> {
    if (isExtension) {
      return sendExtensionMessage({
        action: 'TRIGGER_EMAIL',
        origin,
        formatId,
        itemId,
        itemType,
        email,
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
        filename: 'Bandcamp/' + filename,
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
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      await sendExtensionMessage({
        action: 'DOWNLOAD_FILE',
        url: base64Data,
        filename: 'Bandcamp/' + filename,
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
