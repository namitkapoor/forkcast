// JSON values in localStorage, guarded: storage can be blocked (private mode, previews) or hit
// browser quota limits (~5MB), and the app must continue working cleanly without crashing.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadJson<T>(key: string, fallback: T, store: StorageLike | null = defaultStorage()): T {
  try {
    if (!store) return fallback;
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Evicts heavy inline `maskDataUrl` PNGs from older stored annotations if localStorage hits quota,
 * preserving every annotation's text, strokes, bounding boxes, and revision history.
 */
function compactStorageOnQuota(store: StorageLike): boolean {
  let freed = false;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith("forkcast:annotations:")) keys.push(k);
    }
    for (const k of keys) {
      const raw = store.getItem(k);
      if (!raw || !raw.includes("maskDataUrl")) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      const compacted = parsed.map((item) => {
        if (!item || typeof item !== "object") return item;
        const { maskDataUrl: _dropped, ...rest } = item as Record<string, unknown>;
        freed = true;
        return rest;
      });
      store.setItem(k, JSON.stringify(compacted));
    }
  } catch {
    /* ignore */
  }
  return freed;
}

export function saveJson(key: string, value: unknown, store: StorageLike | null = defaultStorage()): boolean {
  if (!store) return false;
  try {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) {
      store.removeItem(key);
      return true;
    }
    const serialized = JSON.stringify(value);
    try {
      store.setItem(key, serialized);
      return true;
    } catch {
      if (compactStorageOnQuota(store)) {
        store.setItem(key, serialized);
        return true;
      }
      return false;
    }
  } catch {
    /* storage unavailable or full: keep in memory only */
    return false;
  }
}
