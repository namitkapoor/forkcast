import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const HISTORY_FILE = path.join(CACHE_DIR, "studio-history.json");

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

const emptyFile = (): PersistedHistoryFile => ({
  updatedAt: new Date().toISOString(),
  chats: {},
  critiques: [],
  events: [],
  annotations: {},
  versions: {},
});

export function readHistoryFile(): PersistedHistoryFile {
  try {
    if (!existsSync(HISTORY_FILE)) return emptyFile();
    const raw = readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedHistoryFile>;
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      chats: parsed.chats && typeof parsed.chats === "object" ? (parsed.chats as Record<string, unknown[]>) : {},
      critiques: Array.isArray(parsed.critiques) ? parsed.critiques : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      annotations:
        parsed.annotations && typeof parsed.annotations === "object"
          ? (parsed.annotations as Record<string, unknown[]>)
          : {},
      versions:
        parsed.versions && typeof parsed.versions === "object" ? (parsed.versions as Record<string, unknown>) : {},
      branches: parsed.branches,
      tokenTotal: typeof parsed.tokenTotal === "number" ? parsed.tokenTotal : 0,
    };
  } catch {
    return emptyFile();
  }
}

function mergeById(existing: unknown[], incoming: unknown[]): unknown[] {
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
  return [...map.values()];
}

export function writeHistorySnapshot(incoming: Partial<PersistedHistoryFile>): PersistedHistoryFile {
  const prev = readHistoryFile();

  // Merge chat threads by message id so no earlier messages are ever lost
  const mergedChats: Record<string, unknown[]> = { ...prev.chats };
  if (incoming.chats && typeof incoming.chats === "object") {
    for (const [k, list] of Object.entries(incoming.chats)) {
      if (Array.isArray(list)) {
        mergedChats[k] = mergeById(mergedChats[k] ?? [], list);
      }
    }
  }

  const next: PersistedHistoryFile = {
    updatedAt: new Date().toISOString(),
    chats: mergedChats,
    critiques: Array.isArray(incoming.critiques) ? mergeById(prev.critiques, incoming.critiques) : prev.critiques,
    events: Array.isArray(incoming.events) ? mergeById(prev.events, incoming.events) : prev.events,
    annotations:
      incoming.annotations && typeof incoming.annotations === "object" ? incoming.annotations : prev.annotations,
    versions: incoming.versions && typeof incoming.versions === "object" ? incoming.versions : prev.versions,
    branches: incoming.branches !== undefined ? incoming.branches : prev.branches,
    tokenTotal:
      typeof incoming.tokenTotal === "number"
        ? Math.max(prev.tokenTotal ?? 0, incoming.tokenTotal)
        : prev.tokenTotal,
  };

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(HISTORY_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}
