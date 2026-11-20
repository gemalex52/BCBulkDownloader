// File System Access API & IndexedDB directory handle manager
// Allows direct streaming of audio ZIPs and companion info ZIPs to a user-selected folder,
// completely bypassing Chrome's Download Manager and third-party extension filename conflicts.

const IDB_DB_NAME = 'bandcamp_dl_fs';
const IDB_STORE_NAME = 'handles';
const IDB_DIR_KEY = 'downloadDir';

export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).showDirectoryPicker === 'function'
  );
}

function openFsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed opening IndexedDB'));
  });
}

export async function getSavedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!isFileSystemAccessSupported()) return null;
    const db = await openFsDb();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.get(IDB_DIR_KEY);
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openFsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.put(handle, IDB_DIR_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Failed saving directory handle'));
  });
}

export async function clearSavedDirectory(): Promise<void> {
  try {
    const db = await openFsDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.delete(IDB_DIR_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {}
}

export async function pickAndSaveDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('Folder picker API (showDirectoryPicker) is not supported in this browser context.');
  }
  try {
    const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
      id: 'bandcamp-downloads',
      mode: 'readwrite',
    });
    await saveDirectoryHandle(handle);
    return handle;
  } catch (err: any) {
    if (err && (err.name === 'AbortError' || err.code === 20)) {
      return null;
    }
    throw err;
  }
}

export async function ensureDirectoryWritePermission(
  handle: FileSystemDirectoryHandle | null | undefined,
  allowPrompt: boolean
): Promise<boolean> {
  if (!handle) return false;
  try {
    const anyHandle = handle as any;
    const opts = { mode: 'readwrite' };
    if (typeof anyHandle.queryPermission === 'function') {
      const status = await anyHandle.queryPermission(opts);
      if (status === 'granted') return true;
    }
    if (allowPrompt && typeof anyHandle.requestPermission === 'function') {
      const res = await anyHandle.requestPermission(opts);
      return res === 'granted';
    }
    return false;
  } catch {
    return false;
  }
}

async function resolveUniqueFilename(
  dirHandle: FileSystemDirectoryHandle,
  filename: string
): Promise<string> {
  const dotIdx = filename.lastIndexOf('.');
  const stem = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';

  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0 ? filename : `${stem} (${attempt})${ext}`;
    try {
      await dirHandle.getFileHandle(candidate, { create: false });
      // File already exists -> increment suffix
    } catch (err: any) {
      if (err && err.name === 'NotFoundError') {
        return candidate;
      }
      // On unexpected error, return candidate directly
      return candidate;
    }
  }
  return `${stem} (${Date.now()})${ext}`;
}

export async function writeBlobToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  blob: Blob,
  filename: string
): Promise<string> {
  const uniqueName = await resolveUniqueFilename(dirHandle, filename);
  const fileHandle = await dirHandle.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {}
    throw err;
  }
  return uniqueName;
}

export async function streamResponseToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  response: Response,
  filename: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<string> {
  const uniqueName = await resolveUniqueFilename(dirHandle, filename);
  const totalBytes = Number(response.headers.get('content-length') || '0') || 0;
  const fileHandle = await dirHandle.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    if (response.body) {
      const reader = response.body.getReader();
      let loadedBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          await writable.write(value);
          loadedBytes += value.byteLength;
          if (onProgress) {
            onProgress(loadedBytes, totalBytes);
          }
        }
      }
    } else {
      const blob = await response.blob();
      await writable.write(blob);
      if (onProgress) {
        onProgress(blob.size, totalBytes || blob.size);
      }
    }
    await writable.close();
    return uniqueName;
  } catch (err) {
    try {
      await writable.abort();
    } catch {}
    try {
      await dirHandle.removeEntry(uniqueName);
    } catch {}
    throw err;
  }
}
