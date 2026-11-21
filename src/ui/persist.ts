// JSON values in localStorage, guarded: storage can be blocked (private mode, previews) and the
// app must work without it.

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full: keep in memory only */
  }
}
