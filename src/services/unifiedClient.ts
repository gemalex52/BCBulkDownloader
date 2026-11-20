declare const chrome: any;

// Unified Client & Storage Adapter for both Web App and Chrome Extension
import { ScannedRelease, sanitizeDownloadFilenameStrict } from '../types/bandcamp';
import { debugLog } from './bandcampCore';
import {
  clearSavedDirectory,
  ensureDirectoryWritePermission,
  getSavedDirectoryHandle,
  isFileSystemAccessSupported,
  pickAndSaveDirectory,
  streamResponseToDirectory,
  writeBlobToDirectory,
} from './downloadDirectory';

export const isExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);

let activeDirectoryHandle: FileSystemDirectoryHandle | null = null;

// Serialized queue for Chrome Downloads Manager operations so concurrent blob copies never collide
let chromeDownloadChain: Promise<void> = Promise.resolve();
function enqueueChromeDownload<T>(fn: () => Promise<T>): Promise<T> {
  const next = chromeDownloadChain.then(fn, fn);
  chromeDownloadChain = next.then(() => {}, () => {});
  return next;
}

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

async function getWritableDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  if (!activeDirectoryHandle) {
    activeDirectoryHandle = await getSavedDirectoryHandle();
  }
  if (!activeDirectoryHandle) return null;
  const ok = await ensureDirectoryWritePermission(activeDirectoryHandle, false);
  return ok ? activeDirectoryHandle : null;
}

function buildContentDispositionHeader(filename: string): string {
  const safeName = String(filename || 'download.zip').replace(/[\r\n]+/g, ' ').trim() || 'download.zip';
  const asciiFallback =
    safeName
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\;]/g, '_')
      .trim() || 'download.zip';
  const utf8Encoded = encodeURIComponent(safeName).replace(/['()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

const VIRTUAL_DL_DB_NAME = 'bc-virtual-dl-db';
const VIRTUAL_DL_STORE_NAME = 'entries';

function openVirtualDlDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VIRTUAL_DL_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VIRTUAL_DL_STORE_NAME)) {
        db.createObjectStore(VIRTUAL_DL_STORE_NAME, { keyPath: 'path' });
      }
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
  });
}

async function putVirtualDlEntry(entry: {
  path: string;
  data: ArrayBuffer;
  contentType: string;
  contentDisposition: string;
  size: number;
  createdAt: number;
}): Promise<void> {
  const db = await openVirtualDlDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIRTUAL_DL_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VIRTUAL_DL_STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB put failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB put aborted'));
    });
  } finally {
    try { db.close(); } catch {}
  }
}

async function deleteVirtualDlEntry(pathKey: string): Promise<void> {
  const db = await openVirtualDlDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VIRTUAL_DL_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VIRTUAL_DL_STORE_NAME);
      store.delete(pathKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
    });
  } finally {
    try { db.close(); } catch {}
  }
}

async function ensureServiceWorkerControlled(): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  if (navigator.serviceWorker.controller) return true;
  try {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    return false;
  }
  return Boolean(navigator.serviceWorker.controller);
}

/**
 * Unqueued raw chrome.downloads.download helper for Blob fallback.
 * Must only be called directly inside `enqueueChromeDownload` or via `saveBlobViaChromeDownloads`.
 */
async function runChromeDownloadsBlobSave(blob: Blob, cleanFilename: string): Promise<string> {
  if (!chrome?.downloads?.download) {
    const fallbackUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = fallbackUrl;
    a.download = cleanFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(fallbackUrl), 30000);
    return cleanFilename;
  }

  const blobUrl = URL.createObjectURL(blob);
  try {
    const result = await new Promise<{ downloadId: number; savedPath: string }>((resolve, reject) => {
      let settled = false;
      let targetDownloadId: number | null = null;

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (chrome.downloads.onChanged?.removeListener) {
          chrome.downloads.onChanged.removeListener(onChangedListener);
        }
      };

      const finishSuccess = (id: number, savedPath: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ downloadId: id, savedPath });
      };

      const finishError = (msg: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(msg));
      };

      const timeoutTimer = setTimeout(() => {
        finishSuccess(targetDownloadId || 0, cleanFilename);
      }, 45000);

      const inspectDownloadState = (id: number) => {
        if (!chrome.downloads.search) return;
        chrome.downloads.search({ id }, (items: any[]) => {
          if (settled) return;
          const item = items && items[0];
          if (!item) return;
          if (item.state === 'complete') {
            finishSuccess(id, item.filename || cleanFilename);
          } else if (item.state === 'interrupted') {
            finishError(item.error ? `Download interrupted: ${item.error}` : 'Download interrupted');
          }
        });
      };

      const onChangedListener = (delta: any) => {
        if (settled || !delta || delta.id !== targetDownloadId) return;
        if (delta.state && delta.state.current === 'complete') {
          inspectDownloadState(delta.id);
        } else if (delta.state && delta.state.current === 'interrupted') {
          finishError(
            delta.error?.current ? `Download interrupted: ${delta.error.current}` : 'Download interrupted'
          );
        }
      };

      if (chrome.downloads.onChanged?.addListener) {
        chrome.downloads.onChanged.addListener(onChangedListener);
      }

      chrome.downloads.download(
        {
          url: blobUrl,
          filename: cleanFilename,
          conflictAction: 'uniquify',
          saveAs: false,
        },
        (downloadId: number | undefined) => {
          const err = chrome.runtime?.lastError;
          if (err || !downloadId) {
            finishError(err?.message || 'chrome.downloads.download failed to start');
            return;
          }
          targetDownloadId = downloadId;
          inspectDownloadState(downloadId);
        }
      );
    });

    const savedBasename = String(result.savedPath || cleanFilename).split(/[\\/]/).pop() || cleanFilename;
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.|$)/i.test(savedBasename);
    if (looksLikeUuid) {
      console.warn(
        '[BandcampDL:download] Chrome saved file with UUID name despite explicit filename. Another extension may be overriding filenames in Chrome Download Manager; select a Save Folder in the bottom bar to bypass Chrome Download Manager completely.',
        { requested: cleanFilename, saved: result.savedPath, downloadId: result.downloadId }
      );
    } else {
      debugLog('download', 'Saved via Chrome Downloads fallback:', {
        requested: cleanFilename,
        saved: savedBasename,
        downloadId: result.downloadId,
      });
    }
    return savedBasename;
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  }
}

/**
 * Serves a Blob through our MV3 Service Worker virtual route (`/__bc_dl__/...`)
 * with genuine HTTP 200 + `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`
 * headers and triggers a hidden `<iframe>` navigation so Chrome's default Download Manager
 * and third-party managers (e.g. Chrono) receive the exact suggested filename natively.
 */
async function saveBlobViaVirtualHttpHeader(blob: Blob, cleanFilename: string): Promise<string> {
  return enqueueChromeDownload(async () => {
    const swReady = await ensureServiceWorkerControlled();
    if (!swReady || !chrome?.downloads?.onCreated || !chrome?.runtime?.getURL) {
      debugLog('download', 'Service Worker virtual download unavailable; using chrome.downloads.download fallback:', {
        swReady,
        hasOnCreated: Boolean(chrome?.downloads?.onCreated),
      });
      return runChromeDownloadsBlobSave(blob, cleanFilename);
    }

    const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const virtualPath = `__bc_dl__/${token}/${encodeURIComponent(cleanFilename)}`;
    const virtualPathKey = `/${virtualPath}`;
    const virtualUrl = chrome.runtime.getURL(virtualPath);

    try {
      const dataBuffer = await blob.arrayBuffer();
      await putVirtualDlEntry({
        path: virtualPathKey,
        data: dataBuffer,
        contentType: blob.type || 'application/zip',
        contentDisposition: buildContentDispositionHeader(cleanFilename),
        size: blob.size,
        createdAt: Date.now(),
      });
    } catch (idbErr) {
      debugLog('download', 'IndexedDB virtual download store failed; using chrome.downloads.download fallback:', idbErr);
      return runChromeDownloadsBlobSave(blob, cleanFilename);
    }

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    try {
      const outcome = await new Promise<{ ok: true; downloadId: number; savedPath: string } | { ok: false; reason: string }>(
        (resolve, reject) => {
          let settled = false;
          let matchedDownloadId: number | null = null;
          let lastBytes = -1;
          let pollTimer: any = null;
          let stallTimer: any = null;

          const cleanup = () => {
            clearTimeout(creationTimer);
            clearTimeout(stallTimer);
            clearInterval(pollTimer);
            chrome.downloads?.onCreated?.removeListener?.(onCreated);
            chrome.downloads?.onChanged?.removeListener?.(onChanged);
          };

          const finishOk = (id: number, savedPath: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ ok: true, downloadId: id, savedPath });
          };

          const finishFallback = (reason: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ ok: false, reason });
          };

          const finishFatal = (msg: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error(msg));
          };

          const resetStallTimer = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
              finishOk(matchedDownloadId || 0, cleanFilename);
            }, 90000);
          };

          const inspectItem = (id: number) => {
            if (!chrome.downloads?.search) return;
            chrome.downloads.search({ id }, (items: any[]) => {
              if (settled) return;
              const item = items && items[0];
              if (!item) return;
              if (typeof item.bytesReceived === 'number' && item.bytesReceived > lastBytes) {
                lastBytes = item.bytesReceived;
                resetStallTimer();
              }
              if (item.state === 'complete') {
                finishOk(id, item.filename || cleanFilename);
              } else if (item.state === 'interrupted') {
                if (item.error === 'USER_CANCELED') {
                  finishFatal('Download canceled by user');
                } else {
                  finishFallback(item.error ? `Interrupted: ${item.error}` : 'Download interrupted');
                }
              }
            });
          };

          const creationTimer = setTimeout(() => {
            finishFallback('Virtual SW iframe download did not trigger chrome.downloads.onCreated within 4.5s');
          }, 4500);

          const onCreated = (item: any) => {
            if (settled || !item) return;
            const itemUrl = String(item.url || '');
            const finalUrl = String(item.finalUrl || '');
            if (
              itemUrl === virtualUrl ||
              finalUrl === virtualUrl ||
              itemUrl.includes(`/__bc_dl__/${token}/`)
            ) {
              matchedDownloadId = item.id;
              clearTimeout(creationTimer);
              resetStallTimer();
              inspectItem(item.id);
              pollTimer = setInterval(() => {
                if (matchedDownloadId !== null) inspectItem(matchedDownloadId);
              }, 400);
            }
          };

          const onChanged = (delta: any) => {
            if (settled || !delta || delta.id !== matchedDownloadId) return;
            if (delta.state?.current === 'complete') {
              inspectItem(delta.id);
            } else if (delta.state?.current === 'interrupted') {
              const errCode = delta.error?.current;
              if (errCode === 'USER_CANCELED') {
                finishFatal('Download canceled by user');
              } else {
                finishFallback(errCode ? `Interrupted: ${errCode}` : 'Download interrupted');
              }
            }
          };

          chrome.downloads.onCreated.addListener(onCreated);
          chrome.downloads?.onChanged?.addListener?.(onChanged);

          iframe.src = virtualUrl;
          document.body.appendChild(iframe);
        }
      );

      if (outcome.ok) {
        const savedBasename = String(outcome.savedPath || cleanFilename).split(/[\\/]/).pop() || cleanFilename;
        debugLog('download', 'Saved via SW Content-Disposition HTTP response:', {
          requested: cleanFilename,
          saved: savedBasename,
          downloadId: outcome.downloadId,
        });
        return savedBasename;
      }

      debugLog('download', 'Virtual HTTP Content-Disposition fell back to chrome.downloads.download:', {
        requested: cleanFilename,
        reason: outcome.reason,
      });
      return runChromeDownloadsBlobSave(blob, cleanFilename);
    } finally {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      deleteVirtualDlEntry(virtualPathKey).catch(() => {});
    }
  });
}

async function fetchWithRetryInExtension(url: string, maxRetries = 3): Promise<Response> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
        const delayMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : 1500 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr || new Error('Network download failed');
}

/**
 * Downloads a remote Bandcamp audio URL by installing a session declarativeNetRequest
 * `modifyHeaders` rule that sets `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`
 * and triggering a hidden `<iframe src>` (`sub_frame`) navigation.
 * Chrome's C++ network stack streams the file directly to disk with zero JS RAM overhead
 * and hands the injected Content-Disposition filename cleanly to Chrome & third-party managers.
 */
async function downloadHttpViaDnrContentDisposition(
  downloadUrl: string,
  cleanFilename: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<{ ok: true; savedName: string } | { ok: false; reason: string }> {
  return enqueueChromeDownload(async () => {
    if (!chrome?.downloads?.onCreated) {
      return { ok: false, reason: 'chrome.downloads.onCreated API unavailable' };
    }

    const dnrRes = await sendExtensionMessage<{ success: boolean; error?: string }>(
      {
        action: 'SET_DNR_DOWNLOAD_FILENAME',
        url: downloadUrl,
        filename: cleanFilename,
      },
      10000
    ).catch((err) => ({ success: false, error: err?.message || 'DNR setup failed' }));

    if (!dnrRes?.success) {
      return { ok: false, reason: dnrRes?.error || 'SET_DNR_DOWNLOAD_FILENAME failed' };
    }

    let parsedTarget: URL | null = null;
    try {
      parsedTarget = new URL(downloadUrl);
    } catch {}

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    try {
      const outcome = await new Promise<{ ok: true; downloadId: number; savedPath: string } | { ok: false; reason: string }>(
        (resolve, reject) => {
          let settled = false;
          let matchedDownloadId: number | null = null;
          let lastBytes = -1;
          let pollTimer: any = null;
          let stallTimer: any = null;
          const startedAt = Date.now() - 2000;

          const cleanup = () => {
            clearTimeout(creationTimer);
            clearTimeout(stallTimer);
            clearInterval(pollTimer);
            chrome.downloads?.onCreated?.removeListener?.(onCreated);
            chrome.downloads?.onChanged?.removeListener?.(onChanged);
          };

          const finishOk = (id: number, savedPath: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ ok: true, downloadId: id, savedPath });
          };

          const finishFallback = (reason: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ ok: false, reason });
          };

          const finishFatal = (msg: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error(msg));
          };

          const resetStallTimer = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
              finishFallback('HTTP iframe download stalled with no progress for 90s');
            }, 90000);
          };

          const inspectItem = (id: number) => {
            if (!chrome.downloads?.search) return;
            chrome.downloads.search({ id }, (items: any[]) => {
              if (settled) return;
              const item = items && items[0];
              if (!item) return;

              const received = Number(item.bytesReceived || 0);
              const total = Number(item.totalBytes || 0);
              if (received > lastBytes) {
                lastBytes = received;
                resetStallTimer();
                if (onProgress) {
                  onProgress(received, total);
                }
              }

              if (item.state === 'complete') {
                if (onProgress && (total > 0 || received > 0)) {
                  onProgress(total || received, total || received);
                }
                finishOk(id, item.filename || cleanFilename);
              } else if (item.state === 'interrupted') {
                if (item.error === 'USER_CANCELED') {
                  finishFatal('Download canceled by user');
                } else {
                  finishFallback(item.error ? `Interrupted: ${item.error}` : 'Download interrupted');
                }
              }
            });
          };

          const creationTimer = setTimeout(() => {
            finishFallback('DNR iframe download did not trigger chrome.downloads.onCreated within 8s');
          }, 8000);

          const onCreated = (item: any) => {
            if (settled || !item) return;
            const itemUrl = String(item.url || '');
            const finalUrl = String(item.finalUrl || '');
            const startTimeMs = item.startTime ? Date.parse(item.startTime) : Date.now();
            const matchesUrl =
              itemUrl === downloadUrl ||
              finalUrl === downloadUrl ||
              (parsedTarget !== null &&
                (itemUrl.includes(parsedTarget.host + parsedTarget.pathname) ||
                  finalUrl.includes(parsedTarget.host + parsedTarget.pathname)));

            if (startTimeMs >= startedAt && matchesUrl) {
              matchedDownloadId = item.id;
              clearTimeout(creationTimer);
              resetStallTimer();
              inspectItem(item.id);
              pollTimer = setInterval(() => {
                if (matchedDownloadId !== null) inspectItem(matchedDownloadId);
              }, 450);
            }
          };

          const onChanged = (delta: any) => {
            if (settled || !delta || delta.id !== matchedDownloadId) return;
            if (delta.state?.current === 'complete') {
              inspectItem(delta.id);
            } else if (delta.state?.current === 'interrupted') {
              const errCode = delta.error?.current;
              if (errCode === 'USER_CANCELED') {
                finishFatal('Download canceled by user');
              } else {
                finishFallback(errCode ? `Interrupted: ${errCode}` : 'Download interrupted');
              }
            }
          };

          chrome.downloads.onCreated.addListener(onCreated);
          chrome.downloads?.onChanged?.addListener?.(onChanged);

          iframe.src = downloadUrl;
          document.body.appendChild(iframe);
        }
      );

      if (outcome.ok) {
        const savedBasename = String(outcome.savedPath || cleanFilename).split(/[\\/]/).pop() || cleanFilename;
        debugLog('download', 'Audio saved via DNR Content-Disposition HTTP header:', {
          requested: cleanFilename,
          saved: savedBasename,
          downloadId: outcome.downloadId,
        });
        return { ok: true, savedName: savedBasename };
      }

      return { ok: false, reason: outcome.reason };
    } finally {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      await sendExtensionMessage({ action: 'CLEAR_DNR_DOWNLOAD_FILENAME' }, 5000).catch(() => {});
    }
  });
}

/**
 * Unified API Client for discovering catalog, resolving downloads, querying GAS, and downloading
 */
export const apiClient = {
  isExtension,

  isSaveDirectorySupported(): boolean {
    return isFileSystemAccessSupported();
  },

  async getSaveDirectoryInfo(): Promise<{
    supported: boolean;
    hasHandle: boolean;
    name: string;
    granted: boolean;
  }> {
    const supported = isFileSystemAccessSupported();
    if (!supported) {
      return { supported: false, hasHandle: false, name: '', granted: false };
    }
    if (!activeDirectoryHandle) {
      activeDirectoryHandle = await getSavedDirectoryHandle();
    }
    if (!activeDirectoryHandle) {
      return { supported: true, hasHandle: false, name: '', granted: false };
    }
    const granted = await ensureDirectoryWritePermission(activeDirectoryHandle, false);
    return {
      supported: true,
      hasHandle: true,
      name: activeDirectoryHandle.name || 'Selected Folder',
      granted,
    };
  },

  async pickSaveDirectory(): Promise<{ name: string } | null> {
    const handle = await pickAndSaveDirectory();
    if (!handle) return null;
    activeDirectoryHandle = handle;
    return { name: handle.name || 'Selected Folder' };
  },

  async clearSaveDirectory(): Promise<void> {
    activeDirectoryHandle = null;
    await clearSavedDirectory();
  },

  async prepareSaveDirectoryForRun(): Promise<{ active: boolean; name: string }> {
    if (!isFileSystemAccessSupported()) {
      return { active: false, name: '' };
    }
    if (!activeDirectoryHandle) {
      activeDirectoryHandle = await getSavedDirectoryHandle();
    }
    if (!activeDirectoryHandle) {
      return { active: false, name: '' };
    }
    const ok = await ensureDirectoryWritePermission(activeDirectoryHandle, true);
    if (!ok) {
      return { active: false, name: '' };
    }
    return { active: true, name: activeDirectoryHandle.name || 'Selected Folder' };
  },

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
    expectedItemId?: number | string;
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

  async downloadAudioFile(
    downloadUrl: string,
    filename: string,
    meta?: {
      itemId?: number | string;
      releaseId?: string;
      onProgress?: (loadedBytes: number, totalBytes: number) => void;
    }
  ): Promise<void> {
    const cleanFilename = sanitizeDownloadFilenameStrict(filename, { allowSubfolders: false });

    if (isExtension) {
      const dirHandle = await getWritableDirectoryHandle();

      // Path A: Direct Folder streaming via File System Access API (zero RAM overhead, 100% extension-isolated)
      if (dirHandle) {
        const res = await fetchWithRetryInExtension(downloadUrl, 3);
        if (!res.ok) {
          throw new Error(`Audio download HTTP ${res.status}`);
        }
        const contentType = (res.headers.get('content-type') || 'application/octet-stream').toLowerCase();
        const totalBytes = Number(res.headers.get('content-length') || '0') || 0;
        if (contentType.includes('text/html') && totalBytes > 0 && totalBytes < 512000) {
          throw new Error('Bandcamp returned an HTML page instead of audio archive (link may have expired)');
        }
        const savedName = await streamResponseToDirectory(dirHandle, res, cleanFilename, meta?.onProgress);
        debugLog('download', 'Audio streamed directly to chosen folder:', {
          folder: dirHandle.name,
          requested: cleanFilename,
          saved: savedName,
        });
        return;
      }

      // Path B1: Default Chrome Downloads / 3P Download Managers (e.g. Chrono)
      // Inject real HTTP Content-Disposition header via declarativeNetRequest on sub_frame navigation
      // so Chrome & third-party download managers receive our exact filename natively with zero JS RAM.
      const dnrOutcome = await downloadHttpViaDnrContentDisposition(downloadUrl, cleanFilename, meta?.onProgress);
      if (dnrOutcome.ok) {
        return;
      }

      debugLog('download', 'DNR iframe download fell back to fetch + virtual HTTP Content-Disposition:', {
        requested: cleanFilename,
        reason: dnrOutcome.reason,
      });

      // Path B2: Fetch with retry -> Blob -> SW virtual HTTP Content-Disposition responder
      const res = await fetchWithRetryInExtension(downloadUrl, 3);
      if (!res.ok) {
        throw new Error(`Audio download HTTP ${res.status}`);
      }

      const contentType = (res.headers.get('content-type') || 'application/octet-stream').toLowerCase();
      const totalBytes = Number(res.headers.get('content-length') || '0') || 0;
      if (contentType.includes('text/html') && totalBytes > 0 && totalBytes < 512000) {
        throw new Error('Bandcamp returned an HTML page instead of audio archive (link may have expired)');
      }

      const MAX_BLOB_BYTES = 1400 * 1024 * 1024;
      if (totalBytes >= MAX_BLOB_BYTES) {
        try {
          await res.body?.cancel();
        } catch {}
        if (chrome?.downloads?.download) {
          chrome.downloads.download({
            url: downloadUrl,
            filename: cleanFilename,
            conflictAction: 'uniquify',
            saveAs: false,
          });
          return;
        }
        throw new Error('Archive exceeds 1.4 GB browser Blob limit; please select a Save Folder in the bottom bar.');
      }

      let audioBlob: Blob;
      if (res.body && typeof TransformStream !== 'undefined') {
        let loaded = 0;
        const progressStream = res.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              loaded += chunk.byteLength;
              if (meta?.onProgress) {
                meta.onProgress(loaded, totalBytes);
              }
              controller.enqueue(chunk);
            },
          })
        );
        audioBlob = await new Response(progressStream, {
          headers: { 'Content-Type': contentType },
        }).blob();
      } else {
        audioBlob = await res.blob();
        if (meta?.onProgress) {
          meta.onProgress(audioBlob.size, totalBytes || audioBlob.size);
        }
      }

      if (audioBlob.type.toLowerCase().includes('text/html') && audioBlob.size < 512000) {
        throw new Error('Bandcamp returned an HTML page instead of audio archive (link may have expired)');
      }

      const savedName = await saveBlobViaVirtualHttpHeader(audioBlob, cleanFilename);
      debugLog('download', 'Audio file saved via virtual Content-Disposition fallback:', {
        requested: cleanFilename,
        saved: savedName,
        bytes: audioBlob.size,
      });
      return;
    }

    // Web app fallback: trigger through proxy-audio
    const proxyUrl = `/api/bandcamp/proxy-audio?url=${encodeURIComponent(downloadUrl)}&filename=${encodeURIComponent(cleanFilename)}`;
    const a = document.createElement('a');
    a.href = proxyUrl;
    a.download = cleanFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  async downloadBlob(
    blob: Blob,
    filename: string,
    _meta?: { itemId?: number | string; releaseId?: string }
  ): Promise<void> {
    const cleanFilename = sanitizeDownloadFilenameStrict(filename, { allowSubfolders: false });

    if (isExtension) {
      const dirHandle = await getWritableDirectoryHandle();
      if (dirHandle) {
        const savedName = await writeBlobToDirectory(dirHandle, blob, cleanFilename);
        debugLog('download', 'Companion info archive written directly to folder:', {
          folder: dirHandle.name,
          requested: cleanFilename,
          saved: savedName,
        });
        return;
      }

      const savedName = await saveBlobViaVirtualHttpHeader(blob, cleanFilename);
      debugLog('download', 'Companion info archive saved:', {
        requested: cleanFilename,
        saved: savedName,
        bytes: blob.size,
      });
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = cleanFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  },

  async fetchBinaryAsBlob(url: string): Promise<Blob | null> {
    if (isExtension) {
      try {
        const directRes = await fetch(url);
        if (directRes.ok) {
          return await directRes.blob();
        }
      } catch {
        // Fall through to background worker proxy if direct fetch fails
      }

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
