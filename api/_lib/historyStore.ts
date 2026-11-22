import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PersistedHistoryFile {
  updatedAt: string;
  chats: Record<string, unknown[]>;
  critiques: unknown[];
  events: unknown[];
  annotations: Record<string, unknown[]>;
  versions: Record<string, unknown>;
  branches?: unknown;
  tokenTotal?: number;
}

const MAX_CRITIQUES = 200;
const MAX_EVENTS = 500;
const MAX_MESSAGES_PER_CHAT = 120;

let resolvedCacheDir: string | null = null;

/**
 * Resolves a writable directory for `studio-history.json`.
 * Uses `<cwd>/.cache` in local development, and gracefully falls back to
 * `<os.tmpdir()>/forkcast-cache` on read-only serverless filesystems (e.g. Vercel / AWS Lambda).
 */
export function resolveHistoryCacheDir(preferredBase = process.cwd()): string {
  const explicit = process.env.FORKCAST_CACHE_DIR?.trim();
  if (explicit) {
    try {
      mkdirSync(explicit, { recursive: true });
      accessSync(explicit, constants.W_OK);
      return explicit;
    } catch {
      // Fall through to tmpdir if explicit dir is not writable
    }
  }

  if (preferredBase === process.cwd() && resolvedCacheDir) {
    return resolvedCacheDir;
  }

  if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const localDir = path.join(preferredBase, ".cache");
    try {
      mkdirSync(localDir, { recursive: true });
      accessSync(localDir, constants.W_OK);
      if (preferredBase === process.cwd()) resolvedCacheDir = localDir;
      return localDir;
    } catch {
      // Read-only filesystem: fall through to os.tmpdir()
    }
  }

  const tmpDir = path.join(os.tmpdir(), "forkcast-cache");
  mkdirSync(tmpDir, { recursive: true });
  if (preferredBase === process.cwd()) resolvedCacheDir = tmpDir;
  return tmpDir;
}

function historyFilePath(baseDir?: string): string {
  return path.join(resolveHistoryCacheDir(baseDir), "studio-history.json");
}

const emptyFile = (): PersistedHistoryFile => ({
  updatedAt: new Date().toISOString(),
  chats: {},
  critiques: [],
  events: [],
  annotations: {},
  versions: {},
  tokenTotal: 0,
});

export function readHistoryFile(baseDir?: string): PersistedHistoryFile {
  try {
    const file = historyFilePath(baseDir);
    if (!existsSync(file)) return emptyFile();
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedHistoryFile>;
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      chats:
        parsed.chats && typeof parsed.chats === "object" && !Array.isArray(parsed.chats)
          ? (parsed.chats as Record<string, unknown[]>)
          : {},
      critiques: Array.isArray(parsed.critiques) ? parsed.critiques : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      annotations:
        parsed.annotations && typeof parsed.annotations === "object" && !Array.isArray(parsed.annotations)
          ? (parsed.annotations as Record<string, unknown[]>)
          : {},
      versions:
        parsed.versions && typeof parsed.versions === "object" && !Array.isArray(parsed.versions)
          ? (parsed.versions as Record<string, unknown>)
          : {},
      branches: parsed.branches,
      tokenTotal: typeof parsed.tokenTotal === "number" && Number.isFinite(parsed.tokenTotal) ? parsed.tokenTotal : 0,
    };
  } catch {
    return emptyFile();
  }
}

function mergeById(existing: unknown[], incoming: unknown[], maxItems: number): unknown[] {
  const map = new Map<string, unknown>();
  for (const item of existing) {
    if (item && typeof item === "object" && "id" in item && typeof (item as { id: unknown }).id === "string") {
      map.set((item as { id: string }).id, item);
    }
  }
  for (const item of incoming) {
    if (item && typeof item === "object" && "id" in item && typeof (item as { id: unknown }).id === "string") {
      map.set((item as { id: string }).id, item);
    }
  }
  const all = [...map.values()];
  return all.length > maxItems ? all.slice(-maxItems) : all;
}

function sanitizeAnnotationsForDisk(raw: Record<string, unknown[]>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [screenId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    out[screenId] = list.slice(0, 64).map((ann) => {
      if (!ann || typeof ann !== "object") return ann;
      const rec = ann as Record<string, unknown>;
      // Cap oversized inline base64 PNGs (>350KB) when persisting to disk snapshot
      if (typeof rec.maskDataUrl === "string" && rec.maskDataUrl.length > 350_000) {
        const { maskDataUrl: _dropped, ...rest } = rec;
        return rest;
      }
      return rec;
    });
  }
  return out;
}

export function writeHistorySnapshot(incoming: Partial<PersistedHistoryFile>, baseDir?: string): PersistedHistoryFile {
  const prev = readHistoryFile(baseDir);

  const mergedChats: Record<string, unknown[]> = { ...prev.chats };
  if (incoming.chats && typeof incoming.chats === "object" && !Array.isArray(incoming.chats)) {
    for (const [k, list] of Object.entries(incoming.chats)) {
      if (Array.isArray(list)) {
        mergedChats[k] = mergeById(mergedChats[k] ?? [], list, MAX_MESSAGES_PER_CHAT);
      }
    }
  }

  const next: PersistedHistoryFile = {
    updatedAt: new Date().toISOString(),
    chats: mergedChats,
    critiques: Array.isArray(incoming.critiques)
      ? mergeById(prev.critiques, incoming.critiques, MAX_CRITIQUES)
      : prev.critiques,
    events: Array.isArray(incoming.events) ? mergeById(prev.events, incoming.events, MAX_EVENTS) : prev.events,
    annotations:
      incoming.annotations && typeof incoming.annotations === "object" && !Array.isArray(incoming.annotations)
        ? sanitizeAnnotationsForDisk(incoming.annotations)
        : prev.annotations,
    versions:
      incoming.versions && typeof incoming.versions === "object" && !Array.isArray(incoming.versions)
        ? incoming.versions
        : prev.versions,
    branches: incoming.branches !== undefined ? incoming.branches : prev.branches,
    tokenTotal:
      typeof incoming.tokenTotal === "number" && Number.isFinite(incoming.tokenTotal)
        ? Math.max(prev.tokenTotal ?? 0, incoming.tokenTotal)
        : prev.tokenTotal,
  };

  try {
    const target = historyFilePath(baseDir);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    renameSync(tmp, target);
  } catch (e) {
    console.warn("[historyStore] Could not persist history snapshot to disk:", e instanceof Error ? e.message : e);
  }
  return next;
}
