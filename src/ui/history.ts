import type { Annotation, Screen } from "../a2ui/types";
import type { Branches } from "../canvas/model";
import type { UxEvaluationReport } from "../lib/api";
import type { ChatMsg } from "./Chat";
import { loadJson, saveJson } from "./persist";

export interface CritiqueRecord {
  id: string;
  /** Exact screen id evaluated (e.g. `s-1` or `s-1@v2`). */
  screenId: string;
  /** Base slot screen id on the canvas (`s-1`). */
  baseScreenId: string;
  /** Version index (`0` = v1 original, `1` = v2, ...). */
  versionIndex: number;
  nodeId: string;
  nodeLabel: string;
  variant: string;
  report: UxEvaluationReport;
  /** `@Pin-N:v1` handles dropped onto the screen by this critique. */
  pinTokens: string[];
  createdAt: number;
}

export interface HistoryEvent {
  id: string;
  kind: "critique" | "edit" | "chat" | "branch" | "pin" | "mask" | "play";
  title: string;
  detail?: string;
  chips?: string[];
  chatKey?: string;
  baseScreenId?: string;
  versionIndex?: number;
  nodeId?: string;
  edgeKey?: string;
  traceId?: string;
  at: number;
}

export interface StudioHistoryPayload {
  updatedAt?: string;
  chats: Record<string, ChatMsg[]>;
  critiques: CritiqueRecord[];
  events: HistoryEvent[];
  annotations?: Record<string, Annotation[]>;
  versions?: Record<string, { list: Screen[]; active: number; finalized?: number; hidden?: number[] }>;
  branches?: Branches;
  tokenTotal?: number;
}

const CRITIQUES_KEY = "forkcast:history:critiques";
const EVENTS_KEY = "forkcast:history:events";
const CHAT_INDEX_KEY = "forkcast:history:chatKeys";

export function loadStoredCritiques(): CritiqueRecord[] {
  return loadJson<CritiqueRecord[]>(CRITIQUES_KEY, []);
}

export function saveStoredCritiques(list: CritiqueRecord[]): void {
  saveJson(CRITIQUES_KEY, list);
}

export function loadStoredEvents(): HistoryEvent[] {
  return loadJson<HistoryEvent[]>(EVENTS_KEY, []);
}

export function saveStoredEvents(list: HistoryEvent[]): void {
  saveJson(EVENTS_KEY, list);
}

/**
 * Discovers every `forkcast:chat:<key>` conversation ever saved in localStorage
 * so past conversations across all screens, steps, transitions, and runs stay visible.
 */
export function loadAllLocalChats(): Record<string, ChatMsg[]> {
  const out: Record<string, ChatMsg[]> = {};
  try {
    const known = new Set<string>(loadJson<string[]>(CHAT_INDEX_KEY, []));
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("forkcast:chat:")) {
        known.add(k.slice("forkcast:chat:".length));
      }
    }
    for (const chatKey of known) {
      const msgs = loadJson<ChatMsg[]>(`forkcast:chat:${chatKey}`, []);
      if (Array.isArray(msgs) && msgs.length > 0) {
        out[chatKey] = msgs;
      }
    }
  } catch {
    /* ignore storage restrictions */
  }
  return out;
}

export function rememberChatKey(chatKey: string): void {
  const list = loadJson<string[]>(CHAT_INDEX_KEY, []);
  if (!list.includes(chatKey)) {
    saveJson(CHAT_INDEX_KEY, [...list, chatKey]);
  }
}

export async function fetchServerHistory(): Promise<StudioHistoryPayload | null> {
  try {
    const res = await fetch("/api/history", { method: "GET" });
    if (!res.ok) return null;
    return (await res.json()) as StudioHistoryPayload;
  } catch {
    return null;
  }
}

export async function syncHistoryToServer(payload: StudioHistoryPayload): Promise<void> {
  try {
    await fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* offline or static preview: localStorage still holds full history */
  }
}

export function mergeChatMaps(
  a: Record<string, ChatMsg[]>,
  b: Record<string, ChatMsg[]>,
): Record<string, ChatMsg[]> {
  const out: Record<string, ChatMsg[]> = { ...a };
  for (const [key, list] of Object.entries(b)) {
    if (!Array.isArray(list) || !list.length) continue;
    const map = new Map<string, ChatMsg>();
    for (const m of out[key] ?? []) map.set(m.id, m);
    for (const m of list) map.set(m.id, m);
    const merged = [...map.values()].sort((x, y) => x.at - y.at);
    out[key] = merged;
    saveJson(`forkcast:chat:${key}`, merged);
    rememberChatKey(key);
  }
  return out;
}

export function mergeByIdSorted<T extends { id: string }>(
  a: T[],
  b: T[],
  getTime: (item: T) => number,
): T[] {
  const map = new Map<string, T>();
  for (const item of a) map.set(item.id, item);
  for (const item of b) map.set(item.id, item);
  return [...map.values()].sort((x, y) => getTime(y) - getTime(x));
}
