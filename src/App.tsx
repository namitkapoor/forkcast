import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Canvas } from "./canvas/Canvas";
import { CanvasContext, type ActiveCritiqueOverlay, type CanvasApi, type Draft, type MaskCommitPayload, type Picks, type Selection, type Tool } from "./canvas/context";
import { LIVE_ZOOM, type SectionFlowNode } from "./canvas/SectionNode";
import type { NoodleFlowEdge } from "./canvas/NoodleEdge";
import { layoutGraph, sectionSize, slotOffset, THUMB_H, THUMB_W, visibleScreens, type SectionSize } from "./canvas/geometry";
import { emptyBranches, groupScreens, isRunFile, projectFromRun, simulatedProject, withBranches, type Branches, type Source } from "./canvas/model";
import { foldTraces } from "./graph/fold";
import { runChecks } from "./checks/run";
import { coverage } from "./checks/coverage";
import { edgeKey, type Trace } from "./graph/types";
import type { Annotation, AnnotationKind, Screen, ScreenAction } from "./a2ui/types";
import { centroid, componentRects } from "./a2ui/componentRects";
import type { TreeNode } from "./a2ui/tree";
import { loadRun, type RunFile } from "./data/run";
import {
  askForkcast,
  assessDisambiguation,
  branchFromScreen,
  critiqueScreen,
  editScreen,
  generateScreen,
  type BranchResponse,
  type DisambiguationControl,
  type EditAnnotationContext,
  type TokenUsage,
  type UxEvaluationReport,
} from "./lib/api";
import {
  DEFAULT_CRITIC_CONFIG,
  EFFORT_LABELS,
  getCriticModelSpec,
  normalizeCriticConfig,
  type CriticConfig,
} from "./lib/criticModels";
import { Properties, RightPanel, type PropertiesProps, type ReplayState } from "./ui/Inspector";
import { Chat, type ChatMsg, type PendingDisambiguationState } from "./ui/Chat";
import { Layers } from "./ui/Layers";
import { CompareModal } from "./ui/CompareModal";
import { PlayModal } from "./ui/PlayModal";
import { TestsPage } from "./ui/pages/TestsPage";
import { JourneysPage } from "./ui/journeys/JourneysPage";
import { PersonaFlow, drillFromHash, drillHash, type Drill } from "./ui/flows/PersonaFlow";
import { loadJourneys, suiteStats } from "./ui/journeys/data";
import { Dock, HelpOverlay, Toolbar, TopBar, Toasts, type Page, type Toast } from "./ui/Chrome";
import { IconChat, IconHistory, IconLayers, IconPanel } from "./ui/icons";
import { HistoryPanel } from "./ui/HistoryPanel";
import {
  ensureCritiqueVersionedPins,
  fetchServerHistory,
  loadAllLocalChats,
  loadStoredCritiques,
  loadStoredEvents,
  mergeByIdSorted,
  mergeChatMaps,
  rememberChatKey,
  saveStoredCritiques,
  saveStoredEvents,
  syncHistoryToServer,
  type CritiqueRecord,
  type HistoryEvent,
} from "./ui/history";
import {
  appendAnnotationRevision,
  createVersionedAnnotation,
  formatVersionedRef,
  normalizeAnnotationMap,
} from "./ui/annotations";
import {
  buildReferenceCatalog,
  resolvePromptReferences,
  stripReferenceTokenFromText,
  type CatalogReferenceItem,
} from "./ui/references";
import { loadAnnotations, mergeAnnotations, prefersReducedMotion, saveAnnotations } from "./ui/storage";
import { loadJson, saveJson } from "./ui/persist";

export function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

const NONE: Selection = { kind: "none" };

/** Versions of a base screen produced by AI edits. `active` 0 = the original. */
interface VersionState {
  list: Screen[];
  active: number;
  finalized?: number;
  hidden?: number[];
}

interface Snapshot {
  branches: Branches;
  annotations: Record<string, Annotation[]>;
  versions: Record<string, VersionState>;
}

// Journeys is the default page (no hash); Flow and Tests keep their own hash.
const pageFromHash = (): Page => {
  const h = typeof window !== "undefined" ? window.location.hash : "";
  return h.startsWith("#tests") ? "tests" : h.startsWith("#flow") ? "flow" : "journeys";
};
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

function Shell() {
  const rf = useReactFlow();
  const [run, setRun] = useState<RunFile | null>(null);
  const [source, setSource] = useState<Source | "loading">("loading");
  const [bug, setBug] = useState(true);
  const [seed, setSeed] = useState(42);
  const [branches, setBranches] = useState<Branches>(emptyBranches);
  const [selection, setSelection] = useState<Selection>(NONE);
  const [tool, setTool] = useState<Tool>("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [annotations, setAnnotations] = useState<Record<string, Annotation[]>>({});
  const [versions, setVersions] = useState<Record<string, VersionState>>({});
  const [uxReports, setUxReports] = useState<Record<string, UxEvaluationReport>>(() =>
    loadJson<Record<string, UxEvaluationReport>>("forkcast:uxReports", {}),
  );
  const [critiqueHistory, setCritiqueHistory] = useState<CritiqueRecord[]>(() => loadStoredCritiques());
  const [activeCritiqueId, setActiveCritiqueId] = useState<string | null>(null);
  const [criticConfig, setCriticConfigState] = useState<CriticConfig>(() => {
    const saved = loadJson< Partial<CriticConfig> | null >("forkcast:criticConfig", null);
    return saved ? normalizeCriticConfig(saved.model, saved.effort) : DEFAULT_CRITIC_CONFIG;
  });
  const [events, setEvents] = useState<HistoryEvent[]>(() => loadStoredEvents());
  const [tokenTotal, setTokenTotal] = useState<number>(() => loadJson<number>("forkcast:tokens:total", 0));
  const [picks, setPicksState] = useState<Picks | null>(null);
  const [changed, setChanged] = useState<{ versionId: string; ids: string[] } | null>(null);
  const [playTraffic, setPlayTraffic] = useState(false);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [page, setPageState] = useState<Page>(pageFromHash);
  // Tests matrix → Flows: the persona flow view (hash #flow/<generic|persona>/<personaId>/<intent>).
  const [drill, setDrill] = useState<Drill | null>(() => (typeof window !== "undefined" ? drillFromHash(window.location.hash) : null));
  const [flowView, setFlowView] = useState<"persona" | "canvas">("persona");
  const [leftTab, setLeftTab] = useState<"chat" | "layers" | "history" | "props">("chat");
  const [chats, setChats] = useState<Record<string, ChatMsg[]>>(() => loadAllLocalChats());
  const [chatDraft, setChatDraft] = useState("");
  const [detachedKeys, setDetachedKeys] = useState<string[]>([]);
  const [disambiguation, setDisambiguation] = useState<{ key: string; screen: Screen; state: PendingDisambiguationState } | null>(null);
  const [busy, setBusy] = useState<{ key: string; label: string; startedAt: number } | null>(null);
  const [runNonce, setRunNonce] = useState(0);
  const [lastRun, setLastRun] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const [help, setHelp] = useState(false);
  const [compareScreenId, setCompareScreenId] = useState<string | null>(null);
  const [playOpen, setPlayOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [branching, setBranching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [critiquing, setCritiquing] = useState(false);
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const [suite, setSuite] = useState<{ stats: string; date: string; sample: boolean } | null>(null);
  const toastId = useRef(0);
  const chatInput = useRef<HTMLTextAreaElement>(null);
  const activeAbort = useRef<AbortController | null>(null);

  const setCriticConfig = useCallback((next: CriticConfig) => {
    const valid = normalizeCriticConfig(next.model, next.effort);
    setCriticConfigState(valid);
    saveJson("forkcast:criticConfig", valid);
  }, []);

  const recordUsage = useCallback((u?: TokenUsage) => {
    if (!u || !u.totalTokens) return;
    setTokenTotal((prev) => {
      const next = prev + u.totalTokens;
      saveJson("forkcast:tokens:total", next);
      return next;
    });
  }, []);

  const resetTokens = useCallback(() => {
    setTokenTotal(0);
    saveJson("forkcast:tokens:total", null);
  }, []);

  const cancelBusy = useCallback(() => {
    activeAbort.current?.abort();
    activeAbort.current = null;
    setBusy(null);
  }, []);

  const pushEvent = useCallback((ev: Omit<HistoryEvent, "id" | "at">) => {
    setEvents((prev) => {
      const next = [{ ...ev, id: uid("ev"), at: Date.now() }, ...prev].slice(0, 500);
      saveStoredEvents(next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.style.colorScheme = "dark";
    if (prefersReducedMotion()) document.documentElement.classList.add("reduce-motion");
  }, []);

  // Load & merge persisted disk history (.cache/studio-history.json) on mount, and migrate any earlier uxReports
  const serverLoadedRef = useRef(false);
  useEffect(() => {
    let live = true;
    fetchServerHistory().then((srv) => {
      if (!live) return;
      if (srv) {
        if (srv.chats && Object.keys(srv.chats).length > 0) {
          setChats((prev) => mergeChatMaps(prev, srv.chats));
        }
        if (Array.isArray(srv.critiques) && srv.critiques.length > 0) {
          setCritiqueHistory((prev) => {
            const merged = mergeByIdSorted(prev, srv.critiques, (x) => x.createdAt);
            saveStoredCritiques(merged);
            return merged;
          });
        }
        if (Array.isArray(srv.events) && srv.events.length > 0) {
          setEvents((prev) => {
            const merged = mergeByIdSorted(prev, srv.events, (x) => x.at);
            saveStoredEvents(merged);
            return merged;
          });
        }
        if (typeof srv.tokenTotal === "number" && srv.tokenTotal > 0) {
          setTokenTotal((prev) => Math.max(prev, srv.tokenTotal!));
        }
      }
      serverLoadedRef.current = true;
    });
    return () => {
      live = false;
    };
  }, []);

  // Debounced durable sync of all chats, critiques, events, annotations, versions & branches to disk (/api/history)
  useEffect(() => {
    if (!serverLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      void syncHistoryToServer({
        chats,
        critiques: critiqueHistory,
        events,
        annotations,
        versions,
        branches,
        tokenTotal,
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [chats, critiqueHistory, events, annotations, versions, branches, tokenTotal]);

  useEffect(() => {
    let live = true;
    loadRun().then((r) => {
      if (!live) return;
      const ok = isRunFile(r) ? r : null;
      setRun(ok);
      setSource(ok ? "run" : "sim");
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    loadJourneys().then((d) => {
      if (live && d) setSuite({ stats: suiteStats(d.file), date: new Date(d.file.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }), sample: d.sample });
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const on = () => {
      setPageState(pageFromHash());
      const d = drillFromHash(window.location.hash);
      if (d) {
        setDrill(d);
        setFlowView("persona");
      }
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const setPage = useCallback((p: Page) => {
    setPageState(p);
    try {
      const h = window.location.hash;
      const keep = (p === "tests" && h.startsWith("#tests/")) || (p === "flow" && h.startsWith("#flow/"));
      if (!keep) window.history.replaceState(null, "", p === "journeys" ? window.location.pathname + window.location.search : `#${p}`);
    } catch {
      /* ignore */
    }
  }, []);

  const openDrill = useCallback((d: Drill) => {
    setDrill(d);
    setFlowView("persona");
    setPageState("flow");
    try {
      window.history.replaceState(null, "", drillHash(d));
    } catch {
      /* ignore */
    }
  }, []);
  const personaView = page === "flow" && !!drill && flowView === "persona";
  const canvasOn = page === "flow" && !personaView;

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === "error" ? 8000 : 4000);
  }, []);

  // ---- data ----
  const base = useMemo(() => {
    if (source === "loading") return null;
    return source === "run" && run ? projectFromRun(run) : simulatedProject(seed, bug);
  }, [source, run, seed, bug]);

  const derived = useMemo(() => {
    if (!base) return null;
    void runNonce;
    const project = withBranches(base, branches);
    const { graph, traces } = project;
    const folded = foldTraces(graph, traces);
    const report = runChecks(graph, project.invariants, traces);
    const cov = coverage(graph, folded);
    const screensByNode = groupScreens(graph, project.screens);
    const screenById = new Map(project.screens.map((s) => [s.id, s]));
    const sizes = new Map<string, SectionSize>(graph.nodes.map((n) => [n.id, sectionSize(screensByNode.get(n.id)!.length)]));
    const placed = layoutGraph(graph, sizes);
    const branchIds = new Set(branches.nodes.map((n) => n.id));
    const failingByNode = new Set<string>(report.failingNodes);
    for (const k of report.failingEdges) k.split("->").forEach((id) => failingByNode.add(id));
    const order = [...graph.nodes].sort((a, b) => placed.get(a.id)!.depth - placed.get(b.id)!.depth || placed.get(a.id)!.y - placed.get(b.id)!.y);
    return { project, graph, traces, folded, report, cov, screensByNode, screenById, sizes, placed, branchIds, failingByNode, order };
  }, [base, branches, runNonce]);

  // Migrate any existing `uxReports` entries into `critiqueHistory`
  useEffect(() => {
    if (!derived) return;
    const entries = Object.entries(uxReports);
    if (!entries.length) return;
    setCritiqueHistory((prev) => {
      const seenScreens = new Set(prev.map((c) => `${c.screenId}:${c.report.evaluatedAt}`));
      const migrated: CritiqueRecord[] = [];
      for (const [sid, rep] of entries) {
        const key = `${sid}:${rep.evaluatedAt}`;
        if (seenScreens.has(key)) continue;
        const baseId = sid.split("@")[0];
        const verMatch = sid.match(/@v(\d+)$/);
        const verIdx = verMatch ? Math.max(0, Number(verMatch[1]) - 1) : 0;
        const baseScr = derived.screenById.get(baseId);
        const node = baseScr ? derived.graph.nodes.find((n) => n.id === baseScr.nodeId) : undefined;
        migrated.push({
          id: `crit-mig-${sid}-${Date.parse(rep.evaluatedAt) || Date.now()}`,
          screenId: sid,
          baseScreenId: baseId,
          versionIndex: verIdx,
          nodeId: baseScr?.nodeId ?? "",
          nodeLabel: node?.label ?? baseScr?.nodeId ?? baseId,
          variant: baseScr?.variant ?? sid,
          report: rep,
          pinTokens: [],
          createdAt: Date.parse(rep.evaluatedAt) || Date.now(),
        });
      }
      if (!migrated.length) return prev;
      const merged = [...migrated, ...prev].sort((a, b) => b.createdAt - a.createdAt);
      saveStoredCritiques(merged);
      return merged;
    });
  }, [derived, uxReports]);

  // Stored versions and normalized @Pin/@Mask annotations.
  useEffect(() => {
    if (!derived) return;
    setVersions((prev) => {
      let next = prev;
      for (const s of derived.project.screens) {
        if (prev[s.id]) continue;
        const v = loadJson<VersionState | null>(`forkcast:versions:${s.id}`, null);
        if (v && Array.isArray(v.list) && v.list.length) {
          next = {
            ...next,
            [s.id]: {
              list: v.list,
              active: Math.min(v.active ?? 0, v.list.length),
              finalized: v.finalized,
              hidden: Array.isArray(v.hidden) ? v.hidden : [],
            },
          };
        }
      }
      return next;
    });
  }, [derived]);

  useEffect(() => {
    if (!derived) return;
    setAnnotations((prev) => {
      let changedAny = false;
      const draftMap: Record<string, Annotation[]> = { ...prev };
      const ids = [...derived.project.screens.map((s) => s.id), ...Object.values(versions).flatMap((v) => v.list.map((x) => x.id))];
      for (const id of ids) {
        if (draftMap[id]) continue;
        const s = derived.screenById.get(id);
        const rawLoaded = loadAnnotations(id);
        // Clean out any legacy persistent ai-evaluator pins from localStorage so Critic pins never stay stuck
        const cleanedLoaded = rawLoaded.filter((a) => a.author !== "ai-evaluator");
        if (cleanedLoaded.length !== rawLoaded.length) {
          saveAnnotations(id, cleanedLoaded);
        }
        const merged = mergeAnnotations(cleanedLoaded, (s?.annotations ?? []).filter((a) => a.author !== "ai-evaluator"));
        if (merged.length) {
          draftMap[id] = merged;
          changedAny = true;
        }
      }
      return changedAny ? normalizeAnnotationMap(draftMap) : prev;
    });
  }, [derived, versions]);

  const shown = useCallback(
    (screen: Screen): Screen => {
      const v = versions[screen.id];
      return v && v.active > 0 ? (v.list[v.active - 1] ?? screen) : screen;
    },
    [versions],
  );

  const isFinalized = useCallback(
    (baseId: string): boolean => {
      const v = versions[baseId];
      if (!v || v.finalized === undefined) return false;
      return v.finalized === v.active;
    },
    [versions],
  );

  const versionsOf = useCallback(
    (baseId: string) => {
      const s = derived?.screenById.get(baseId);
      const v = versions[baseId];
      return {
        list: s ? [s, ...(v?.list ?? [])] : [],
        active: v?.active ?? 0,
        finalized: v?.finalized,
        hidden: v?.hidden ?? [],
      };
    },
    [derived, versions],
  );

  const persistVersions = (baseId: string, v: VersionState | undefined) =>
    saveJson(
      `forkcast:versions:${baseId}`,
      v && (v.list.length || v.finalized !== undefined || (v.hidden?.length ?? 0) > 0) ? v : null,
    );

  // ---- undo / redo (branches, annotations, versions) ----
  const latestState = useRef<Snapshot>({ branches, annotations, versions });
  latestState.current = { branches, annotations, versions };
  const remember = useCallback(() => {
    setUndoStack((u) => [...u.slice(-29), latestState.current]);
    setRedoStack([]);
  }, []);
  const restore = (snap: Snapshot) => {
    const cur = latestState.current;
    setBranches(snap.branches);
    setAnnotations(snap.annotations);
    setVersions(snap.versions);
    for (const id of new Set([...Object.keys(cur.annotations), ...Object.keys(snap.annotations)])) saveAnnotations(id, snap.annotations[id] ?? []);
    for (const id of new Set([...Object.keys(cur.versions), ...Object.keys(snap.versions)])) persistVersions(id, snap.versions[id]);
    setDraft(null);
    setPicksState(null);
  };
  const undo = useCallback(() => {
    setUndoStack((u) => {
      if (!u.length) return u;
      const snap = u[u.length - 1];
      setRedoStack((r) => [...r, latestState.current]);
      restore(snap);
      return u.slice(0, -1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r;
      const snap = r[r.length - 1];
      setUndoStack((u) => [...u, latestState.current]);
      restore(snap);
      return r.slice(0, -1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- viewport helpers ----
  const latest = useRef(derived);
  latest.current = derived;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const rightOpen = useRef(false);

  const viewArea = useCallback(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const mobile = W < 760;
    const left = !mobile && !collapsedRef.current ? 364 : 16;
    const right = !mobile && rightOpen.current ? 324 : 16;
    const top = mobile ? 148 : 76;
    const bottom = mobile ? (collapsedRef.current ? 64 : H * 0.46 + 16) : 70;
    return { x: left, y: top, w: Math.max(80, W - left - right), h: Math.max(80, H - top - bottom) };
  }, []);

  const frame = useCallback(
    (r: { x: number; y: number; w: number; h: number }, opts: { pad?: number; maxZoom?: number; minZoom?: number } = {}) => {
      const a = viewArea();
      const pad = opts.pad ?? 0.1;
      const zoom = Math.min(opts.maxZoom ?? 1.2, Math.max(opts.minZoom ?? 0.08, Math.min(a.w / (r.w * (1 + pad * 2)), a.h / (r.h * (1 + pad * 2)))));
      const x = a.x + a.w / 2 - (r.x + r.w / 2) * zoom;
      const y = a.y + a.h / 2 - (r.y + r.h / 2) * zoom;
      void rf.setViewport({ x, y, zoom }, { duration: 0 });
    },
    [rf, viewArea],
  );

  const boundsOf = (ids: string[]) => {
    const d = latest.current;
    if (!d) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const p = d.placed.get(id);
      const s = d.sizes.get(id);
      if (!p || !s) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y - 30);
      x1 = Math.max(x1, p.x + s.w);
      y1 = Math.max(y1, p.y + s.h);
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  };

  const focusNodes = useCallback(
    (ids: string[], maxZoom = 1.1) => {
      const b = boundsOf(ids);
      if (b) frame(b, { pad: 0.06, maxZoom });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame],
  );

  const screenBox = useCallback(
    (screenId: string, nodeId: string) => {
      const d = latest.current;
      if (!d) return null;
      const pos = d.placed.get(nodeId);
      const size = d.sizes.get(nodeId);
      const screens = d.screensByNode.get(nodeId) ?? [];
      if (!pos || !size) return null;
      const { shown: vis } = visibleScreens(screens, screenId);
      const i = Math.max(0, vis.findIndex((s) => s.id === screenId));
      const o = slotOffset(size, i);
      return { x: pos.x + o.x, y: pos.y + o.y, w: THUMB_W, h: THUMB_H };
    },
    [],
  );

  const focusScreen = useCallback(
    (screenId: string, nodeId: string) => {
      const b = screenBox(screenId, nodeId);
      if (b) frame({ x: b.x - 10, y: b.y - 30, w: b.w + 20, h: b.h + 40 }, { pad: 0.04, maxZoom: 2.2, minZoom: window.innerWidth < 760 ? 0.7 : 1.2 });
    },
    [frame, screenBox],
  );

  const fit = useCallback(() => {
    const d = latest.current;
    const b = d && boundsOf(d.graph.nodes.map((n) => n.id));
    if (b) frame(b, { pad: 0.03, maxZoom: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  const fitted = useRef(false);
  useEffect(() => {
    if (!derived || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => {
      const d = latest.current;
      const b = d && boundsOf(d.graph.nodes.map((n) => n.id));
      if (!d || !b) return;
      const a = viewArea();
      const fitZoom = Math.min(1, a.w / (b.w * 1.04), a.h / (b.h * 1.04));
      const zoom = Math.max(fitZoom, window.innerWidth < 760 ? 0.32 : 0.42);
      const x = a.x + 24 - b.x * zoom;
      const y = a.y + 36 - b.y * zoom;
      void rf.setViewport({ x, y, zoom });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived]);

  // ---- selection ----
  const setPicks = useCallback((p: Picks | null) => {
    setPicksState(p);
    if (p) setChanged(null);
  }, []);
  const selectNode = useCallback((id: string) => {
    setDraft(null);
    setReplay(null);
    setPicksState(null);
    setDetachedKeys([]);
    setActiveCritiqueId(null);
    setSelection({ kind: "node", id });
  }, []);
  const focusNode = useCallback(
    (id: string) => {
      selectNode(id);
      focusNodes([id]);
    },
    [selectNode, focusNodes],
  );
  const selectEdge = useCallback((key: string) => {
    setDraft(null);
    setReplay(null);
    setPicksState(null);
    setDetachedKeys([]);
    setActiveCritiqueId(null);
    setSelection({ kind: "edge", key });
  }, []);
  const focusEdge = useCallback(
    (key: string) => {
      selectEdge(key);
      const [a, b] = key.split("->");
      focusNodes([a, b], 0.8);
    },
    [selectEdge, focusNodes],
  );
  const selectScreen = useCallback(
    (id: string, nodeId: string, opts?: { focus?: boolean; keepCritiqueId?: string | null }) => {
      setDraft((d) => (d && !d.screenId.startsWith(id) ? null : d));
      setPicksState((p) => (p && p.screenId !== id ? null : p));
      setDetachedKeys([]);
      if (opts?.keepCritiqueId !== undefined) {
        setActiveCritiqueId(opts.keepCritiqueId);
      } else {
        setActiveCritiqueId((cur) => (selection.kind === "screen" && selection.id === id ? cur : null));
      }
      setSelection({ kind: "screen", id, nodeId });
      if (opts?.focus) focusScreen(id, nodeId);
    },
    [focusScreen, selection],
  );
  const clear = useCallback(() => {
    setDraft(null);
    setPicksState(null);
    setReplay(null);
    setDetachedKeys([]);
    setActiveCritiqueId(null);
    setSelection(NONE);
  }, []);

  // ---- versioned annotations (@Pin-N:vK & @Mask-N:vK) ----
  const addAnnotation = useCallback(
    (screenId: string, a: Annotation) => {
      remember();
      setAnnotations((prev) => {
        const list = [...(prev[screenId] ?? []), a];
        saveAnnotations(screenId, list);
        return { ...prev, [screenId]: list };
      });
    },
    [remember],
  );

  const saveDraft = useCallback(
    (text: string, kind: AnnotationKind, includeInAi = true) => {
      if (!draft) return;
      const created = createVersionedAnnotation(latestState.current.annotations, {
        x: draft.x,
        y: draft.y,
        text,
        kind,
        componentId: draft.componentId,
        includeInAiFeedback: includeInAi,
      });
      addAnnotation(draft.screenId, created);
      const refTok = formatVersionedRef(created);
      const baseId = draft.screenId.split("@")[0];
      const owner = latest.current?.screenById.get(baseId);
      pushEvent({
        kind: "pin",
        title: `Pinned ${refTok} (${kind})`,
        detail: text,
        chips: [refTok, ...(draft.componentId ? [draft.componentId] : [])],
        baseScreenId: baseId,
        nodeId: owner?.nodeId,
      });
      setDraft(null);
      toast({
        tone: "ok",
        title: `${refTok} pinned`,
        body: draft.componentId ? `on ${draft.componentId}` : undefined,
      });
    },
    [draft, toast, addAnnotation, pushEvent],
  );

  const updateAnnotationInScreen = useCallback(
    (screenId: string, id: string, updater: (a: Annotation) => Annotation) => {
      remember();
      setAnnotations((prev) => {
        const list = (prev[screenId] ?? []).map((a) => (a.id === id ? updater(a) : a));
        saveAnnotations(screenId, list);
        return { ...prev, [screenId]: list };
      });
    },
    [remember],
  );

  const editAnnotation = useCallback(
    (screenId: string, id: string, nextText: string) => {
      updateAnnotationInScreen(screenId, id, (a) => appendAnnotationRevision(a, { text: nextText, author: "designer" }));
      toast({ tone: "ok", title: "Saved new annotation revision" });
    },
    [updateAnnotationInScreen, toast],
  );

  const toggleAnnotationStatus = useCallback(
    (screenId: string, id: string) => {
      updateAnnotationInScreen(screenId, id, (a) =>
        appendAnnotationRevision(a, { status: a.status === "resolved" ? "open" : "resolved", author: "designer" }),
      );
    },
    [updateAnnotationInScreen],
  );

  const toggleAnnotationAi = useCallback(
    (screenId: string, id: string) => {
      setAnnotations((prev) => {
        const list = (prev[screenId] ?? []).map((a) =>
          a.id === id ? { ...a, includeInAiFeedback: a.includeInAiFeedback === false } : a,
        );
        saveAnnotations(screenId, list);
        return { ...prev, [screenId]: list };
      });
    },
    [],
  );

  const setAllAnnotationsAi = useCallback((screenId: string, include: boolean) => {
    setAnnotations((prev) => {
      const list = (prev[screenId] ?? []).map((a) => ({ ...a, includeInAiFeedback: include }));
      saveAnnotations(screenId, list);
      return { ...prev, [screenId]: list };
    });
  }, []);

  const restoreAnnotationRevision = useCallback(
    (screenId: string, id: string, revId: string) => {
      updateAnnotationInScreen(screenId, id, (a) => {
        const target = a.revisions?.find((r) => r.id === revId);
        if (!target) return a;
        return appendAnnotationRevision(a, {
          text: target.text,
          kind: target.kind,
          status: target.status,
          author: "designer",
        });
      });
      toast({ tone: "ok", title: "Revision restored" });
    },
    [updateAnnotationInScreen, toast],
  );

  const deleteAnnotation = useCallback(
    (screenId: string, id: string) => {
      remember();
      setAnnotations((prev) => {
        const list = (prev[screenId] ?? []).filter((a) => a.id !== id);
        saveAnnotations(screenId, list);
        return { ...prev, [screenId]: list };
      });
    },
    [remember],
  );

  const clearNotes = useCallback(() => {
    remember();
    setAnnotations((prev) => {
      for (const id of Object.keys(prev)) saveAnnotations(id, []);
      return {};
    });
    toast({ tone: "info", title: "Annotations cleared" });
  }, [toast, remember]);

  const onScreenAction = useCallback(
    (_screenId: string, action: ScreenAction) => {
      toast({ tone: "info", title: `Action “${action.name}”`, body: action.sourceComponentId ? `from ${action.sourceComponentId}` : undefined });
    },
    [toast],
  );

  // ---- API: branch / generate / critique ----
  const apiError = (e: unknown, what: string) => {
    if ((e as Error)?.name === "AbortError") return;
    const msg = e instanceof Error ? e.message : String(e);
    const missing = /404|405|Failed to fetch|NetworkError|Unexpected|not available/i.test(msg);
    toast({
      tone: "error",
      title: missing ? `${what} needs the API` : `${what} failed`,
      body: missing ? `The API didn't answer (${msg}). Make sure the dev server's /api routes are running, then try again.` : msg,
    });
  };

  const branch = useCallback(
    async (screen: Screen, utterance: string) => {
      if (!derived) return;
      const fromNode = derived.graph.nodes.find((n) => n.id === screen.nodeId);
      if (!fromNode) return;
      setBranching(true);
      try {
        const res: BranchResponse = await branchFromScreen({ fromScreen: screen, fromNode, utterance });
        recordUsage(res.usage);
        if (!res?.node?.id || !res.screen?.id) throw new Error("Unexpected response from /api/branch");
        const taken = new Set(derived.graph.nodes.map((n) => n.id));
        let id = res.node.id;
        for (let i = 2; taken.has(id); i++) id = `${res.node.id}-${i}`;
        const node = { ...res.node, id };
        const transition = { ...res.transition, id: edgeKey(fromNode.id, id), from: fromNode.id, to: id, kind: res.transition?.kind ?? "digress" };
        const newScreen: Screen = { ...res.screen, nodeId: id, annotations: res.screen.annotations ?? [] };
        remember();
        setBranches((b) => ({ ...b, nodes: [...b.nodes, node], transitions: [...b.transitions, transition], screens: [...b.screens, newScreen] }));
        setSelection({ kind: "screen", id: newScreen.id, nodeId: id });
        pushEvent({
          kind: "branch",
          title: `Branched → ${node.label}`,
          detail: `“${utterance}” from ${fromNode.label}`,
          baseScreenId: newScreen.id,
          nodeId: id,
        });
        toast({ tone: "ok", title: `Branched: ${node.label}`, body: `“${utterance}” from ${fromNode.label}` });
        window.setTimeout(() => focusNodes([id], 1), 60);
      } catch (e) {
        apiError(e, "Branching");
      } finally {
        setBranching(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derived, toast, focusNodes, remember, recordUsage],
  );

  const generate = useCallback(
    async (nodeId: string) => {
      if (!derived) return;
      const node = derived.graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const trace = derived.traces.find((t) => t.steps.some((s) => s.node === nodeId));
      setGenerating(true);
      try {
        const screen = await generateScreen({ nodeId, node, context: trace?.context ?? {} });
        if (!screen?.id) throw new Error("Unexpected response from /api/generate-screen");
        const s: Screen = { ...screen, nodeId, annotations: screen.annotations ?? [] };
        remember();
        setBranches((b) => ({ ...b, screens: [...b.screens, s] }));
        setSelection({ kind: "screen", id: s.id, nodeId });
        toast({ tone: "ok", title: "Screen generated", body: s.variant });
      } catch (e) {
        apiError(e, "Generating");
      } finally {
        setGenerating(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derived, toast, remember],
  );

  const runCritique = useCallback(
    async (targetScreen: Screen) => {
      if (!derived) return;
      const node = derived.graph.nodes.find((n) => n.id === targetScreen.nodeId);
      const contracts = derived.graph.transitions
        .filter((t) => (t.from === targetScreen.nodeId || t.to === targetScreen.nodeId) && t.contract?.carries.length)
        .map((t) => `${t.from}->${t.to} carries [${t.contract!.carries.join(", ")}]`);
      const baseId = targetScreen.id.split("@")[0];
      activeAbort.current?.abort();
      const ctrl = new AbortController();
      activeAbort.current = ctrl;
      const chosen = normalizeCriticConfig(criticConfig.model, criticConfig.effort);
      const spec = getCriticModelSpec(chosen.model);
      setCritiquing(true);
      setBusy({ key: baseId, label: `Critiquing UX · ${spec.shortLabel} (${EFFORT_LABELS[chosen.effort]})`, startedAt: Date.now() });
      try {
        const res = await critiqueScreen(
          {
            screen: targetScreen,
            nodeLabel: node?.label ?? targetScreen.nodeId,
            stage: node?.stage ?? "unknown",
            contracts,
            model: chosen.model,
            thinkingLevel: chosen.effort,
          },
          { signal: ctrl.signal },
        );
        recordUsage(res.usage);
        setUxReports((prev) => {
          const next = { ...prev, [targetScreen.id]: res.report };
          saveJson("forkcast:uxReports", next);
          return next;
        });

        // Build non-persistent, versioned Critic pins stored ONLY inside the CritiqueRecord!
        const verMatch = targetScreen.id.match(/@v(\d+)$/);
        const verIndex = verMatch ? Math.max(0, Number(verMatch[1]) - 1) : 0;
        const phoneEl = document.querySelector(`[data-screen="${CSS.escape(baseId)}"] .fc-phone`);
        const rects = phoneEl ? componentRects(phoneEl) : [];

        // Ensure globally unique @Critic-N handles across all saved critiques
        const existingCriticMap: Record<string, Annotation[]> = {};
        critiqueHistory.forEach((c) => {
          if (c.versionedPins?.length) existingCriticMap[c.id] = c.versionedPins;
        });

        const versionedPins: Annotation[] = [];
        const createdTokens: string[] = [];
        res.report.pins.forEach((pin, idx) => {
          const r = pin.componentId ? rects.find((x) => x.id === pin.componentId) : undefined;
          const x = r ? r.x + r.w / 2 : 0.78;
          const y = r ? r.y + r.h / 2 : Math.min(0.88, 0.2 + idx * 0.16);
          const created = createVersionedAnnotation(existingCriticMap, {
            x,
            y,
            text: pin.text,
            kind: pin.kind,
            componentId: pin.componentId,
            author: "ai-evaluator",
            prefixOverride: "Critic",
            includeInAiFeedback: true,
          });
          versionedPins.push(created);
          createdTokens.push(formatVersionedRef(created));
          existingCriticMap[`__new_${idx}`] = [created];
        });

        const critRec: CritiqueRecord = {
          id: uid("crit"),
          screenId: targetScreen.id,
          baseScreenId: baseId,
          versionIndex: verIndex,
          nodeId: targetScreen.nodeId,
          nodeLabel: node?.label ?? targetScreen.nodeId,
          variant: targetScreen.variant,
          report: res.report,
          pinTokens: createdTokens,
          versionedPins,
          createdAt: Date.now(),
        };
        setCritiqueHistory((prev) => {
          const next = [critRec, ...prev];
          saveStoredCritiques(next);
          return next;
        });

        // Show this critique's ephemeral pins on the freeform canvas immediately (until dismissed)
        setActiveCritiqueId(critRec.id);
        if (rf.getZoom() < LIVE_ZOOM) {
          focusScreen(baseId, targetScreen.nodeId);
        }

        // Also post the full UX Critique report directly into this screen's Chat conversation & Activity Log
        const d = res.report.dimensions;
        const modelTag = `${res.report.model}${res.report.thinkingLevel ? ` · ${res.report.thinkingLevel.toLowerCase()}` : ""}`;
        pushMsg(baseId, {
          role: "system",
          tone: "critique",
          text: `UX Critique · ${res.report.overallScore}/100 (v${verIndex + 1} · ${modelTag})\nUsability ${d.usability} · Hierarchy ${d.hierarchy} · Access. ${d.accessibility} · Continuity ${d.continuity}\n${res.report.summary}`,
          chips: createdTokens,
          versionIndex: verIndex,
        });
        pushEvent({
          kind: "critique",
          title: `UX Critique ${res.report.overallScore}/100 · ${node?.label ?? targetScreen.nodeId} (v${verIndex + 1})`,
          detail: res.report.summary,
          chips: createdTokens,
          critiqueId: critRec.id,
          baseScreenId: baseId,
          versionIndex: verIndex,
          nodeId: targetScreen.nodeId,
          chatKey: baseId,
        });
        setCollapsed(false);
        toast({
          tone: "ok",
          title: `UX Critique: ${res.report.overallScore}/100`,
          body: createdTokens.length ? `Showing ${createdTokens.length} non-persistent Critic pins on canvas (saved to History)` : "Saved to History",
        });
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          pushMsg(baseId, {
            role: "system",
            tone: "error",
            text: `UX Critique failed\n${e instanceof Error ? e.message : String(e)}`,
          });
          apiError(e, "UX Critique");
        }
      } finally {
        setCritiquing(false);
        if (activeAbort.current === ctrl) {
          activeAbort.current = null;
          setBusy(null);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derived, criticConfig, critiqueHistory, rf, focusScreen, recordUsage, remember, toast],
  );

  const rerun = useCallback(() => {
    setSource("sim");
    setSeed((s) => s + 1);
    setLastRun(Date.now());
    toast({ tone: "info", title: "Simulation re-run", body: `500 sessions · seed ${seed + 1}` });
  }, [seed, toast]);

  const runTests = useCallback(() => {
    setRunNonce((n) => n + 1);
    setLastRun(Date.now());
    const d = latest.current;
    if (d) {
      const checks = d.project.invariants.length + d.graph.transitions.filter((t) => t.contract?.carries.length).length;
      const failing = d.report.failingNodes.size + d.report.failingEdges.size;
      toast({ tone: failing ? "error" : "ok", title: `Ran ${checks} checks over ${d.folded.traceCount} sessions`, body: failing ? `${d.report.failures.length} failures in ${failing} places` : "Everything passed" });
    }
  }, [toast]);

  const exportRun = useCallback(() => {
    if (!derived) return;
    const { graph, report, cov, folded, project } = derived;
    const payload = {
      exportedAt: new Date().toISOString(),
      title: project.title,
      source: project.source,
      sessions: folded.traceCount,
      coverage: cov,
      graph,
      failures: report.failures,
      failingTraces: derived.traces.filter((t) => report.failures.some((f) => f.traceId === t.id)),
      annotations,
      versions,
      uxReports,
    };
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `forkcast-${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ tone: "ok", title: "Exported", body: `${report.failures.length} failures, ${payload.failingTraces.length} failing traces` });
    } catch (e) {
      apiError(e, "Export");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived, annotations, versions, uxReports, toast]);

  // ---- chat, @mentions & context chips ----
  const selScreen = selection.kind === "screen" ? derived?.screenById.get(selection.id) : undefined;
  const shownSelScreen = selScreen ? shown(selScreen) : undefined;
  const chatKey = selection.kind === "screen" ? selection.id : selection.kind === "node" ? `node:${selection.id}` : selection.kind === "edge" ? `edge:${selection.key}` : "run";
  const messages = useMemo(() => chats[chatKey] ?? loadJson<ChatMsg[]>(`forkcast:chat:${chatKey}`, []), [chats, chatKey]);
  const pushMsg = useCallback((key: string, m: Omit<ChatMsg, "id" | "at">) => {
    rememberChatKey(key);
    setChats((prev) => {
      const list = [...(prev[key] ?? loadJson<ChatMsg[]>(`forkcast:chat:${key}`, [])), { ...m, id: uid("m"), at: Date.now() }];
      saveJson(`forkcast:chat:${key}`, list);
      return { ...prev, [key]: list };
    });
  }, []);

  const allScreensMap = useMemo(() => {
    const m = new Map<string, Screen>();
    if (!derived) return m;
    for (const [k, v] of derived.screenById) m.set(k, v);
    for (const v of Object.values(versions)) {
      for (const s of v.list) m.set(s.id, s);
    }
    return m;
  }, [derived, versions]);

  const detachedSet = useMemo(() => new Set(detachedKeys), [detachedKeys]);
  const screenAttached = Boolean(selScreen && !detachedSet.has(`screen:${selScreen.id}`));

  const activeCritiqueRecord = useMemo(() => {
    if (!activeCritiqueId) return null;
    const found = critiqueHistory.find((c) => c.id === activeCritiqueId);
    return found ? ensureCritiqueVersionedPins(found) : null;
  }, [activeCritiqueId, critiqueHistory]);

  const activeCritiqueOverlay = useMemo<ActiveCritiqueOverlay | null>(() => {
    if (!activeCritiqueRecord) return null;
    return {
      critiqueId: activeCritiqueRecord.id,
      screenId: activeCritiqueRecord.screenId,
      label: `Critic ${activeCritiqueRecord.report.overallScore}/100`,
      pins: activeCritiqueRecord.versionedPins ?? [],
    };
  }, [activeCritiqueRecord]);

  const activeCritiquePinsForRefs = useMemo(
    () =>
      activeCritiqueOverlay
        ? { screenId: activeCritiqueOverlay.screenId, pins: activeCritiqueOverlay.pins }
        : null,
    [activeCritiqueOverlay],
  );

  const catalog = useMemo(
    () => (derived ? buildReferenceCatalog(derived.graph, allScreensMap, annotations, activeCritiquePinsForRefs) : []),
    [derived, allScreensMap, annotations, activeCritiquePinsForRefs],
  );

  const liveResolved = useMemo(
    () =>
      derived
        ? resolvePromptReferences({
            prompt: chatDraft,
            graph: derived.graph,
            screensById: allScreensMap,
            annotationsByScreen: annotations,
            activeCritiquePins: activeCritiquePinsForRefs,
            activeScreenId: selScreen?.id,
            shownScreenId: shownSelScreen?.id,
            detachedKeys: detachedSet,
          })
        : null,
    [derived, chatDraft, allScreensMap, annotations, activeCritiquePinsForRefs, selScreen?.id, shownSelScreen?.id, detachedSet],
  );

  const onAttachCatalogItem = useCallback((item: CatalogReferenceItem) => {
    setDetachedKeys((prev) =>
      prev.filter(
        (k) =>
          k !== (item.annotationId ? `ann:${item.annotationId}` : "") &&
          k !== (item.screenId ? `screen:${item.screenId.split("@")[0]}` : ""),
      ),
    );
    setChatDraft((cur) => {
      if (cur.toLowerCase().includes(item.token.toLowerCase())) return cur;
      const trimmed = cur.trimEnd();
      return trimmed ? `${trimmed} ${item.token} ` : `${item.token} `;
    });
  }, []);

  const onDetachAnnotation = useCallback((annId: string, mentionTag?: string) => {
    setDetachedKeys((prev) => (prev.includes(`ann:${annId}`) ? prev : [...prev, `ann:${annId}`]));
    if (mentionTag) setChatDraft((cur) => stripReferenceTokenFromText(cur, mentionTag));
  }, []);

  const onDetachScreen = useCallback(() => {
    if (!selScreen) return;
    setDetachedKeys((prev) => (prev.includes(`screen:${selScreen.id}`) ? prev : [...prev, `screen:${selScreen.id}`]));
  }, [selScreen]);

  const onClearAllContext = useCallback(() => {
    setPicksState(null);
    const keys: string[] = [];
    if (selScreen) keys.push(`screen:${selScreen.id}`);
    for (const a of liveResolved?.includedAnnotations ?? []) keys.push(`ann:${a.annotation.id}`);
    setDetachedKeys((prev) => [...new Set([...prev, ...keys])]);
  }, [selScreen, liveResolved]);

  const onMentionInChat = useCallback((token: string) => {
    setCollapsed(false);
    setLeftTab("chat");
    setChatDraft((cur) => {
      if (cur.toLowerCase().includes(token.toLowerCase())) return cur;
      const trimmed = cur.trimEnd();
      return trimmed ? `${trimmed} ${token} ` : `${token} `;
    });
    window.setTimeout(() => chatInput.current?.focus(), 0);
  }, []);

  const labelOf = (id: string) => derived?.graph.nodes.find((n) => n.id === id)?.label ?? id;

  const ask = useCallback(
    async (key: string, question: string, screen?: Screen, referencedContext?: string) => {
      const d = latest.current;
      if (!d) return;
      activeAbort.current?.abort();
      const ctrl = new AbortController();
      activeAbort.current = ctrl;
      setBusy({ key, label: "Thinking", startedAt: Date.now() });
      const groups = new Map<string, { edge: string; count: number; example: string; who: Map<string, number> }>();
      const ctxOf = new Map(d.traces.map((t) => [t.id, Object.values(t.context).filter((v) => !v.includes("→")).join("·")]));
      for (const f of d.report.failures) {
        const where = f.kind === "contract" ? f.where.split("->").map(labelOf).join(" → ") : `${labelOf(f.where)} (invariant)`;
        const g = groups.get(where) ?? { edge: where, count: 0, example: f.message, who: new Map() };
        g.count++;
        const who = ctxOf.get(f.traceId) ?? "unknown";
        g.who.set(who, (g.who.get(who) ?? 0) + 1);
        groups.set(where, g);
      }
      const sel =
        selection.kind === "screen" && screen
          ? `Screen "${screen.variant}" on step ${labelOf(selection.nodeId)} for ${Object.values(screen.context ?? {}).join(" · ")}`
          : selection.kind === "node"
            ? `Step ${labelOf(selection.id)} (${d.folded.nodeStats.get(selection.id)?.traces ?? 0} sessions reached it)`
            : selection.kind === "edge"
              ? `Transition ${selection.key.split("->").map(labelOf).join(" → ")} (${d.folded.edgeCounts.get(selection.key) ?? 0} sessions)`
              : "Whole run";
      try {
        const completed = d.traces.filter((t) => t.outcome === "completed").length;
        const res = await askForkcast(
          {
            question,
            selection: sel,
            stats: {
              sessions: d.folded.traceCount,
              completedPct: d.folded.traceCount ? Math.round((completed / d.folded.traceCount) * 100) : 0,
              failedChecks: d.report.failures.length,
              edgesExercised: d.cov.edgesExercised,
              edgesTotal: d.cov.edgesTotal,
              edgesFor95: d.cov.edgesFor95,
            },
            failingEdges: [...groups.values()]
              .sort((a, b) => b.count - a.count)
              .map((g) => ({ edge: g.edge, count: g.count, example: `${g.example} · travelers: ${[...g.who].map(([k, n]) => `${k} ×${n}`).join(", ")}` })),
            screen: screen ? { variant: screen.variant, messages: screen.messages } : undefined,
            referencedContext,
            history: (chats[key] ?? []).filter((m) => m.role !== "system").slice(-6).map((m) => ({ role: m.role as "user" | "assistant", text: m.text })),
          },
          { signal: ctrl.signal },
        );
        recordUsage(res.usage);
        pushMsg(key, { role: "assistant", text: res.answer });
        pushEvent({
          kind: "chat",
          title: `Q&A · ${sel.slice(0, 48)}`,
          detail: `${question} → ${res.answer.slice(0, 120)}`,
          chatKey: key,
        });
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          pushMsg(key, { role: "system", tone: "error", text: `Couldn't answer\n${e instanceof Error ? e.message : String(e)}` });
        }
      } finally {
        if (activeAbort.current === ctrl) {
          activeAbort.current = null;
          setBusy(null);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, chats, pushMsg, derived, recordUsage],
  );

  const edit = useCallback(
    async (
      baseScreen: Screen,
      instruction: string,
      opts?: {
        editAnnotations?: EditAnnotationContext[];
        maskDataUrl?: string;
        referencedContext?: string;
      },
    ) => {
      const key = baseScreen.id;
      const current = shown(baseScreen);
      const ids = picks?.screenId === baseScreen.id ? picks.items.map((p) => p.id) : [];
      const attachedAnns = opts?.editAnnotations ?? [];
      activeAbort.current?.abort();
      const ctrl = new AbortController();
      activeAbort.current = ctrl;

      const targetCount = ids.length + attachedAnns.length;
      setBusy({
        key,
        label: opts?.maskDataUrl
          ? "Applying Paint & Speak mask"
          : targetCount
            ? `Refining ${targetCount} target${targetCount === 1 ? "" : "s"}`
            : "Editing the screen",
        startedAt: Date.now(),
      });
      const t0 = performance.now();
      try {
        const res = await editScreen(
          {
            screen: current,
            componentIds: ids,
            instruction,
            annotations: attachedAnns.length ? attachedAnns : undefined,
            maskDataUrl: opts?.maskDataUrl,
            referencedContext: opts?.referencedContext,
          },
          { signal: ctrl.signal },
        );
        recordUsage(res.usage);
        if (!res?.screen?.messages?.length) throw new Error("Unexpected response from /api/edit-screen");
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        const curVerState = versions[key];
        const prev = curVerState?.list ?? [];
        const n = prev.length + 2;
        const rootVariant = baseScreen.variant;
        const version: Screen = {
          ...res.screen,
          id: `${baseScreen.id}@v${n}`,
          nodeId: baseScreen.nodeId,
          context: baseScreen.context,
          variant: `${rootVariant} · v${n}`,
          rationale: res.summary,
          annotations: [],
        };
        remember();
        const next: VersionState = {
          list: [...prev, version],
          active: prev.length + 1,
          finalized: curVerState?.finalized,
          hidden: curVerState?.hidden ?? [],
        };
        setVersions((v) => ({ ...v, [key]: next }));
        persistVersions(key, next);

        // Automatically mark addressed annotations on `current.id` as resolved
        if (res.resolvedAnnotationIds?.length) {
          const resolvedSet = new Set(res.resolvedAnnotationIds);
          setAnnotations((prevAnns) => {
            const curList = prevAnns[current.id];
            if (!curList?.some((a) => resolvedSet.has(a.id))) return prevAnns;
            const updated = curList.map((a) =>
              resolvedSet.has(a.id) && a.status !== "resolved"
                ? appendAnnotationRevision(a, { status: "resolved", author: "ai-evaluator", resolvedByVersionId: version.id })
                : a,
            );
            saveAnnotations(current.id, updated);
            return { ...prevAnns, [current.id]: updated };
          });
        }

        setPicksState(null);
        setDetachedKeys([]);
        setActiveCritiqueId(null);
        setChanged({ versionId: version.id, ids: res.changed });
        const tokLabel = res.usage?.totalTokens ? ` · ${fmtTok(res.usage.totalTokens)} tok` : "";
        pushMsg(key, {
          role: "system",
          tone: "edit",
          text: `Edited ${res.changed.length} component${res.changed.length === 1 ? "" : "s"} → v${n}\n${res.summary}${res.warnings.length ? `\nGuardrail: ${res.warnings.join("; ")}` : ""}\n${res.screen.model} · ${secs}s${tokLabel}`,
          chips: res.changed.slice(0, 8),
          versionIndex: n - 1,
        });
        pushEvent({
          kind: "edit",
          title: `Edited ${labelOf(baseScreen.nodeId)} → v${n}`,
          detail: res.summary,
          chips: res.changed.slice(0, 6),
          baseScreenId: baseScreen.id,
          versionIndex: n - 1,
          nodeId: baseScreen.nodeId,
          chatKey: key,
        });
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          pushMsg(key, { role: "system", tone: "error", text: `Edit failed\n${e instanceof Error ? e.message : String(e)}` });
        }
      } finally {
        if (activeAbort.current === ctrl) {
          activeAbort.current = null;
          setBusy(null);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, picks, versions, remember, pushMsg, recordUsage],
  );

  const commitMask = useCallback(
    (payload: MaskCommitPayload) => {
      const created = createVersionedAnnotation(latestState.current.annotations, {
        x: payload.x,
        y: payload.y,
        text: payload.text,
        kind: "mask",
        componentId: payload.intersectingIds[0],
        strokes: payload.strokes,
        maskBox: payload.maskBox,
        maskDataUrl: payload.maskDataUrl,
        intersectingIds: payload.intersectingIds,
        includeInAiFeedback: payload.includeInAiFeedback,
      });
      addAnnotation(payload.shownScreenId, created);
      const refTok = formatVersionedRef(created);
      const ownerScr = derived?.screenById.get(payload.baseScreenId);
      pushEvent({
        kind: "mask",
        title: `Painted ${refTok}`,
        detail: payload.text,
        chips: [refTok, ...payload.intersectingIds.slice(0, 4)],
        baseScreenId: payload.baseScreenId,
        nodeId: ownerScr?.nodeId,
      });
      toast({
        tone: "ok",
        title: `${refTok} saved`,
        body: payload.applyImmediately ? "Applying Paint & Speak mask with AI…" : `${payload.intersectingIds.length} component(s) targeted`,
      });

      if (payload.applyImmediately && derived) {
        const baseScreen = derived.screenById.get(payload.baseScreenId);
        if (baseScreen) {
          setCollapsed(false);
          setLeftTab("chat");
          pushMsg(baseScreen.id, {
            role: "user",
            text: `${refTok} ${payload.text}`,
            chips: [refTok, ...payload.intersectingIds.slice(0, 4)],
          });
          void edit(baseScreen, payload.text, {
            editAnnotations: [
              {
                id: created.id,
                token: refTok,
                kind: "mask",
                text: payload.text,
                componentId: created.componentId,
                intersectingIds: payload.intersectingIds,
                maskDataUrl: payload.maskDataUrl,
              },
            ],
            maskDataUrl: payload.maskDataUrl,
          });
        }
      }
    },
    [addAnnotation, toast, derived, pushMsg, edit],
  );

  const resolveIncludedAnnotations = useCallback(
    (baseScreen: Screen) => {
      const cur = shown(baseScreen);
      const optedIn = (annotations[cur.id] ?? []).filter((a) => a.status !== "resolved" && a.includeInAiFeedback !== false);
      if (!optedIn.length) return;
      setCollapsed(false);
      setLeftTab("chat");
      const editAnns: EditAnnotationContext[] = optedIn.map((a) => ({
        id: a.id,
        token: formatVersionedRef(a),
        kind: a.kind,
        text: a.text,
        componentId: a.componentId,
        intersectingIds: a.intersectingIds,
        maskDataUrl: a.maskDataUrl,
      }));
      const summaryPrompt = `Resolve ${editAnns.map((a) => a.token).join(", ")}: ${editAnns.map((a) => a.text).join("; ")}`;
      pushMsg(baseScreen.id, {
        role: "user",
        text: `Resolve included feedback (${editAnns.map((a) => a.token).join(", ")})`,
        chips: editAnns.map((a) => a.token),
      });
      void edit(baseScreen, summaryPrompt, { editAnnotations: editAnns });
    },
    [shown, annotations, pushMsg, edit],
  );

  const onSend = useCallback(
    async (text: string) => {
      const key = chatKey;
      const resolved = derived
        ? resolvePromptReferences({
            prompt: text,
            graph: derived.graph,
            screensById: allScreensMap,
            annotationsByScreen: annotations,
            activeCritiquePins: activeCritiquePinsForRefs,
            activeScreenId: selScreen?.id,
            shownScreenId: shownSelScreen?.id,
            detachedKeys: detachedSet,
          })
        : null;

      const pickChips = picks && selScreen && picks.screenId === selScreen.id ? picks.items.map((p) => p.id) : [];
      const annChips = resolved?.includedAnnotations.map((a) => a.token) ?? [];
      const chips = [...pickChips, ...annChips];
      pushMsg(key, { role: "user", text, chips: chips.length ? chips : undefined });

      const targetScreenForEdit = selScreen && screenAttached ? selScreen : resolved?.explicitScreens[0];
      const isQuestion = text.trim().endsWith("?") && !pickChips.length && !annChips.length;

      if (targetScreenForEdit && !isQuestion) {
        // Optional fast disambiguation check for open-ended redesign instructions with no explicit pins/lasso
        const needsDisambigCheck =
          !pickChips.length &&
          !annChips.length &&
          !/@[A-Za-z0-9_:-]+/.test(text) &&
          text.trim().split(/\s+/).length <= 16 &&
          /\b(redesign|rethink|overhaul|improve|clean up|modernize|simplify|rework|explore)\b/i.test(text);

        if (needsDisambigCheck) {
          setBusy({ key, label: "Checking intent", startedAt: Date.now() });
          try {
            const dis = await assessDisambiguation({
              prompt: text,
              scope: "screen",
              nodeLabel: labelOf(targetScreenForEdit.nodeId),
              screenVariant: shown(targetScreenForEdit).variant,
            });
            recordUsage(dis.usage);
            if (dis.ambiguous && dis.controls.length > 0) {
              setBusy(null);
              setDisambiguation({
                key,
                screen: targetScreenForEdit,
                state: { originalPrompt: text, rationale: dis.rationale, controls: dis.controls },
              });
              return;
            }
          } catch {
            /* fall through directly to edit */
          } finally {
            setBusy(null);
          }
        }

        void edit(targetScreenForEdit, text, {
          editAnnotations: resolved?.editAnnotations,
          referencedContext: resolved?.referencedContext,
        });
      } else {
        void ask(key, text, selScreen && screenAttached ? shown(selScreen) : undefined, resolved?.referencedContext);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatKey, derived, allScreensMap, annotations, selScreen, shownSelScreen, detachedSet, picks, pushMsg, screenAttached, edit, ask, shown, recordUsage],
  );

  const confirmDisambiguation = useCallback(() => {
    if (!disambiguation) return;
    const { screen, state } = disambiguation;
    const answers = state.controls
      .map((c) => {
        if (c.kind === "choice-cards") {
          const opt = c.options.find((o) => o.id === c.selectedId);
          return `${c.label}: ${opt?.title ?? c.selectedId}`;
        }
        if (c.kind === "chips") return `${c.label}: ${c.selected.join(", ")}`;
        return `${c.label}: ${c.value}${c.unit}`;
      })
      .join(" · ");
    setDisambiguation(null);
    void edit(screen, `${state.originalPrompt} (${answers})`);
  }, [disambiguation, edit]);

  const skipDisambiguation = useCallback(() => {
    if (!disambiguation) return;
    const { screen, state } = disambiguation;
    setDisambiguation(null);
    void edit(screen, state.originalPrompt);
  }, [disambiguation, edit]);

  const flagAnchor = useCallback((p: Picks) => {
    if (p.lasso && p.lasso.length > 2) return centroid(p.lasso);
    const el = document.querySelector(`[data-screen="${CSS.escape(p.screenId)}"] .fc-phone`);
    const r = el ? componentRects(el).find((x) => x.id === p.items[0]?.id) : undefined;
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 0.5, y: 0.5 };
  }, []);

  const onFlag = useCallback(
    (text: string, kind: Exclude<AnnotationKind, "mask">) => {
      if (!picks || !selScreen || picks.screenId !== selScreen.id) return;
      const at = flagAnchor(picks);
      const target = shown(selScreen);
      const created = createVersionedAnnotation(latestState.current.annotations, {
        x: at.x,
        y: at.y,
        text,
        kind,
        componentId: picks.items[0]?.id,
        includeInAiFeedback: true,
      });
      addAnnotation(target.id, created);
      const refTok = formatVersionedRef(created);
      pushMsg(selScreen.id, {
        role: "system",
        tone: "flag",
        text: `Pinned ${refTok} (${kind}): ${text}\non ${picks.items.map((i) => i.id).join(", ")}`,
        chips: [refTok, ...picks.items.map((i) => i.id)],
      });
      toast({ tone: "ok", title: `${refTok} flagged as ${kind}`, body: `on ${picks.items[0]?.id}` });
    },
    [picks, selScreen, flagAnchor, shown, addAnnotation, pushMsg, toast],
  );

  const setVersion = useCallback((baseId: string, i: number, keepCritique = false) => {
    setVersions((v) => {
      const cur = v[baseId] ?? { list: [], active: 0, hidden: [] };
      const next: VersionState = { ...cur, active: Math.max(0, Math.min(i, cur.list.length)) };
      persistVersions(baseId, next);
      return { ...v, [baseId]: next };
    });
    setPicksState(null);
    if (!keepCritique) setActiveCritiqueId(null);
  }, []);

  const toggleCritiqueOnCanvas = useCallback(
    (rec: CritiqueRecord) => {
      if (activeCritiqueId === rec.id) {
        setActiveCritiqueId(null);
        return;
      }
      const d = latest.current;
      if (!d) return;
      const scr = d.screenById.get(rec.baseScreenId);
      if (!scr) return;
      setPage("flow");
      setReplay(null);
      setVersion(scr.id, rec.versionIndex, true);
      selectScreen(scr.id, scr.nodeId, { focus: true, keepCritiqueId: rec.id });
    },
    [activeCritiqueId, setPage, setVersion, selectScreen],
  );

  const editCritiquePin = useCallback(
    (critiqueId: string, pinId: string, nextText: string) => {
      setCritiqueHistory((prev) => {
        const next = prev.map((c) => {
          if (c.id !== critiqueId) return c;
          const ensured = ensureCritiqueVersionedPins(c);
          const updatedPins = (ensured.versionedPins ?? []).map((p) =>
            p.id === pinId ? appendAnnotationRevision(p, { text: nextText, author: "designer" }) : p,
          );
          return {
            ...ensured,
            versionedPins: updatedPins,
            pinTokens: updatedPins.map((p) => formatVersionedRef(p)),
          };
        });
        saveStoredCritiques(next);
        return next;
      });
      toast({ tone: "ok", title: "Saved new Critic pin revision" });
    },
    [toast],
  );

  const restoreCritiquePinRevision = useCallback(
    (critiqueId: string, pinId: string, revisionId: string) => {
      setCritiqueHistory((prev) => {
        const next = prev.map((c) => {
          if (c.id !== critiqueId) return c;
          const ensured = ensureCritiqueVersionedPins(c);
          const updatedPins = (ensured.versionedPins ?? []).map((p) => {
            if (p.id !== pinId) return p;
            const target = p.revisions?.find((r) => r.id === revisionId);
            if (!target) return p;
            return appendAnnotationRevision(p, { text: target.text, kind: target.kind, status: target.status, author: "designer" });
          });
          return {
            ...ensured,
            versionedPins: updatedPins,
            pinTokens: updatedPins.map((p) => formatVersionedRef(p)),
          };
        });
        saveStoredCritiques(next);
        return next;
      });
      toast({ tone: "ok", title: "Restored Critic pin revision" });
    },
    [toast],
  );

  const resolveCritiquePinsWithAi = useCallback(
    (baseScreen: Screen, rec: CritiqueRecord) => {
      const ensured = ensureCritiqueVersionedPins(rec);
      const pins = ensured.versionedPins ?? [];
      if (!pins.length) return;
      setVersion(baseScreen.id, ensured.versionIndex, true);
      setCollapsed(false);
      setLeftTab("chat");
      const editAnns: EditAnnotationContext[] = pins.map((p) => ({
        id: p.id,
        token: formatVersionedRef(p),
        kind: p.kind,
        text: p.text,
        componentId: p.componentId,
      }));
      const instruction = `Address UX critique findings (${editAnns.map((a) => a.token).join(", ")}): ${editAnns.map((a) => a.text).join("; ")}`;
      pushMsg(baseScreen.id, {
        role: "user",
        text: `Fix critic findings (${editAnns.map((a) => a.token).join(", ")})`,
        chips: editAnns.map((a) => a.token),
      });
      void edit(baseScreen, instruction, { editAnnotations: editAnns });
    },
    [setVersion, pushMsg, edit],
  );

  const toggleFinalizeVersion = useCallback(
    (baseId: string, idx: number) => {
      remember();
      setVersions((v) => {
        const cur = v[baseId] ?? { list: [], active: 0, hidden: [] };
        const nextFinal = cur.finalized === idx ? undefined : idx;
        const next: VersionState = { ...cur, finalized: nextFinal, active: idx };
        persistVersions(baseId, next);
        return { ...v, [baseId]: next };
      });
      toast({ tone: "ok", title: `v${idx + 1} updated` });
    },
    [remember, toast],
  );

  const toggleHiddenVersion = useCallback((baseId: string, idx: number) => {
    setVersions((v) => {
      const cur = v[baseId] ?? { list: [], active: 0, hidden: [] };
      const hidden = cur.hidden ?? [];
      const nextHidden = hidden.includes(idx) ? hidden.filter((x) => x !== idx) : [...hidden, idx];
      const next: VersionState = { ...cur, hidden: nextHidden };
      persistVersions(baseId, next);
      return { ...v, [baseId]: next };
    });
  }, []);

  const savePlayTrace = useCallback(
    (trace: Trace) => {
      remember();
      setBranches((b) => ({ ...b, traces: [...(b.traces ?? []), trace] }));
      setReplay({ traceId: trace.id, step: 0 });
      pushEvent({
        kind: "play",
        title: `Play walkthrough (${trace.steps.length} steps · ${trace.outcome})`,
        detail: trace.context.walkthrough,
        traceId: trace.id,
      });
      toast({
        tone: "ok",
        title: `Walkthrough recorded (${trace.steps.length} steps)`,
        body: `Outcome: ${trace.outcome} · opened in Replay`,
      });
    },
    [remember, toast],
  );

  // ---- tools ----
  const onToolChange = useCallback(
    (t: Tool) => {
      setTool(t);
      if (t !== "annotate") setDraft(null);
      if (t === "lasso" || t === "annotate" || t === "mask") {
        setCollapsed(false);
        if (t === "lasso" || t === "mask") setLeftTab("chat");
        if (selection.kind === "screen" && rf.getZoom() < LIVE_ZOOM) focusScreen(selection.id, selection.nodeId);
      }
      if (t === "branch" && window.innerWidth < 760) {
        setCollapsed(false);
        setLeftTab("props");
      }
    },
    [selection, rf, focusScreen],
  );

  // ---- keyboard ----
  const zoomIn = useCallback(() => void rf.zoomIn({ duration: 0 }), [rf]);
  const zoomOut = useCallback(() => void rf.zoomOut({ duration: 0 }), [rf]);

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest(".nokeys"));
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) {
        if (e.key === "Escape" && e.target instanceof HTMLElement && !e.target.closest(".composer, .chat")) e.target.blur();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === " " && canvasOn && !playOpen && !compareScreenId) {
        setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if (k === "Escape") {
        if (help) setHelp(false);
        else if (compareScreenId) setCompareScreenId(null);
        else if (playOpen) setPlayOpen(false);
        else if (draft) setDraft(null);
        else if (picks) setPicksState(null);
        else if (activeCritiqueId) setActiveCritiqueId(null);
        else if (replay) setReplay(null);
        else clear();
        return;
      }
      if (help && k !== "?") return;
      if (playOpen || compareScreenId) return;
      if (!canvasOn) return;
      const map: Record<string, Tool> = { v: "select", h: "hand", l: "lasso", c: "annotate", a: "annotate", m: "mask", b: "branch" };
      if (map[k.toLowerCase()] && !e.shiftKey) return onToolChange(map[k.toLowerCase()]);
      if (k === "p" || k === "P") return setPlayOpen(true);
      if (k === "t" || k === "T") return setPlayTraffic((v) => !v);
      if (k === "?") return setHelp((h) => !h);
      if (k === "+" || k === "=") return zoomIn();
      if (k === "-" || k === "_") return zoomOut();
      if (k === "0") return void rf.zoomTo(1, { duration: 0 });
      if (k === "!" || (e.shiftKey && e.code === "Digit1")) return fit();
      if (k === "@" || (e.shiftKey && e.code === "Digit2")) {
        if (selection.kind === "node") focusNodes([selection.id]);
        else if (selection.kind === "screen") focusScreen(selection.id, selection.nodeId);
        else if (selection.kind === "edge") focusEdge(selection.key);
        return;
      }
      if (k === "\\") return setCollapsed((c) => !c);
      if (k === "r" || k === "R") return rerun();
      if (k === "Enter" && selection.kind === "screen") return focusScreen(selection.id, selection.nodeId);
      if (/^[1-9]$/.test(k) && derived) {
        const n = derived.order[Number(k) - 1];
        if (n) focusNode(n.id);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [help, compareScreenId, playOpen, draft, picks, activeCritiqueId, replay, page, canvasOn, clear, zoomIn, zoomOut, rf, fit, selection, focusNodes, focusScreen, focusEdge, rerun, derived, focusNode, onToolChange, undo, redo]);

  // ---- React Flow elements ----
  const nodes = useMemo<SectionFlowNode[]>(() => {
    if (!derived) return [];
    const { graph, folded, report, placed, sizes, screensByNode, branchIds, failingByNode } = derived;
    return graph.nodes.map((state) => {
      const stats = folded.nodeStats.get(state.id)!;
      const p = placed.get(state.id)!;
      const size = sizes.get(state.id)!;
      return {
        id: state.id,
        type: "section",
        position: { x: p.x, y: p.y },
        width: size.w,
        height: size.h,
        data: {
          state,
          stats,
          failing: report.failingNodes.has(state.id),
          edgeFailing: failingByNode.has(state.id),
          reach: folded.traceCount ? Math.round((stats.traces / folded.traceCount) * 100) : 0,
          completion: stats.traces ? Math.round((stats.completions / stats.traces) * 100) : 0,
          screens: screensByNode.get(state.id) ?? [],
          size,
          depth: p.depth,
          isBranch: branchIds.has(state.id),
        },
      };
    });
  }, [derived]);

  const edges = useMemo<NoodleFlowEdge[]>(() => {
    if (!derived) return [];
    const { graph, folded, report, placed } = derived;
    const max = Math.max(1, ...folded.edgeCounts.values());
    const focusId = selection.kind === "node" ? selection.id : selection.kind === "screen" ? selection.nodeId : null;
    const failCounts = new Map<string, number>();
    for (const f of report.failures) if (f.kind === "contract") failCounts.set(f.where, (failCounts.get(f.where) ?? 0) + 1);
    return graph.transitions.map((t) => {
      const key = edgeKey(t.from, t.to);
      const count = folded.edgeCounts.get(key) ?? 0;
      const status = report.failingEdges.has(key) ? "fail" : count ? "pass" : "untested";
      const selected = selection.kind === "edge" && (selection.key === key || selection.key === t.id);
      const dimmed = (focusId !== null && t.from !== focusId && t.to !== focusId) || (selection.kind === "edge" && !selected);
      return {
        id: key,
        source: t.from,
        target: t.to,
        type: "noodle",
        zIndex: status === "fail" || selected ? 1 : 0,
        data: {
          count,
          max,
          status,
          hasContract: !!t.contract?.carries.length,
          failCount: failCounts.get(key) ?? 0,
          fromDepth: placed.get(t.from)?.depth ?? 0,
          toDepth: placed.get(t.to)?.depth ?? 0,
          kind: t.kind,
          selected,
          dimmed,
        },
      };
    });
  }, [derived, selection]);

  const onVoiceError = useCallback((msg: string) => toast({ tone: "error", title: "Voice input", body: msg }), [toast]);

  const dismissCritiqueOverlay = useCallback(() => setActiveCritiqueId(null), []);

  const api = useMemo<CanvasApi>(
    () => ({
      graph: derived?.graph,
      selection,
      tool: spaceHeld ? "hand" : tool,
      annotations,
      activeCritiqueOverlay,
      draft,
      picks,
      changed,
      playTraffic,
      shown,
      isFinalized,
      selectNode,
      selectEdge,
      selectScreen,
      setPicks,
      startDraft: (d) => {
        setDraft(d);
        setCollapsed(false);
      },
      cancelDraft: () => setDraft(null),
      saveDraft,
      commitMask,
      onDismissCritiqueOverlay: dismissCritiqueOverlay,
      onMentionCritiquePin: onMentionInChat,
      onScreenAction,
      onVoiceUsage: recordUsage,
      onVoiceError,
    }),
    [
      derived?.graph,
      selection,
      tool,
      spaceHeld,
      annotations,
      activeCritiqueOverlay,
      draft,
      picks,
      changed,
      playTraffic,
      shown,
      isFinalized,
      selectNode,
      selectEdge,
      selectScreen,
      setPicks,
      saveDraft,
      commitMask,
      dismissCritiqueOverlay,
      onMentionInChat,
      onScreenAction,
      recordUsage,
      onVoiceError,
    ],
  );

  // ---- panels ----
  const onPickLayer = useCallback(
    (screenId: string, n: TreeNode, additive: boolean) => {
      const s = derived?.screenById.get(screenId);
      if (!s) return;
      if (selection.kind !== "screen" || selection.id !== screenId) setSelection({ kind: "screen", id: screenId, nodeId: s.nodeId });
      const item = { id: n.id, type: n.type, label: n.label };
      setPicksState((p) => {
        if (additive && p?.screenId === screenId && !p.lasso) {
          const has = p.items.some((x) => x.id === n.id);
          const items = has ? p.items.filter((x) => x.id !== n.id) : [...p.items, item];
          return items.length ? { screenId, items } : null;
        }
        return { screenId, items: [item] };
      });
      setChanged(null);
    },
    [derived, selection],
  );

  const propsProps: PropertiesProps | null = derived
    ? {
        graph: derived.graph,
        traces: derived.traces,
        folded: derived.folded,
        report: derived.report,
        invariants: derived.project.invariants,
        screensByNode: derived.screensByNode,
        screenById: derived.screenById,
        annotations,
        uxReports,
        critiqueHistory,
        activeCritiqueId,
        criticConfig,
        selection,
        picks,
        tool,
        branching,
        generating,
        critiquing,
        busy: Boolean(busy),
        replay,
        versionsOf,
        shown,
        onSetVersion: setVersion,
        onToggleFinalizeVersion: toggleFinalizeVersion,
        onToggleHiddenVersion: toggleHiddenVersion,
        onCompareVersions: (baseId) => setCompareScreenId(baseId),
        onCriticConfigChange: setCriticConfig,
        onCritiqueScreen: runCritique,
        onToggleCritiqueOnCanvas: toggleCritiqueOnCanvas,
        onEditCritiquePin: editCritiquePin,
        onRestoreCritiquePinRevision: restoreCritiquePinRevision,
        onResolveCritiquePinsWithAi: resolveCritiquePinsWithAi,
        onOpenHistory: () => {
          setCollapsed(false);
          setLeftTab("history");
        },
        onReplay: setReplay,
        onFocusNode: focusNode,
        onFocusEdge: focusEdge,
        onSelectScreen: (id, nodeId) => {
          setReplay(null);
          selectScreen(id, nodeId, { focus: true });
        },
        onClear: clear,
        onBranch: branch,
        onGenerate: generate,
        onMentionInChat,
        onEditAnnotation: editAnnotation,
        onToggleAnnotationStatus: toggleAnnotationStatus,
        onToggleAnnotationAi: toggleAnnotationAi,
        onSetAllAnnotationsAi: setAllAnnotationsAi,
        onRestoreAnnotationRevision: restoreAnnotationRevision,
        onResolveIncludedAnnotations: resolveIncludedAnnotations,
        onDeleteAnnotation: deleteAnnotation,
        onEditWithAI: () => {
          setCollapsed(false);
          setLeftTab("chat");
          window.setTimeout(() => chatInput.current?.focus(), 0);
        },
        onFlagPicked: () => {
          if (!picks || !selScreen) return;
          const at = flagAnchor(picks);
          setTool("annotate");
          setDraft({ screenId: shown(selScreen).id, x: at.x, y: at.y, componentId: picks.items[0]?.id });
        },
        onLasso: () => onToolChange("lasso"),
        onClearPicks: () => setPicksState(null),
        onVoiceUsage: recordUsage,
        onVoiceError,
      }
    : null;
  const rightVisible = !!propsProps && canvasOn && (!!replay || selection.kind !== "none");
  rightOpen.current = rightVisible;

  const ctx = (() => {
    if (!derived) return { title: "", sub: "", scope: "run" as const };
    if (selection.kind === "screen" && selScreen) {
      const c = selScreen.context;
      const parts = [c.party, c.surface, c.currency].filter(Boolean);
      return { title: labelOf(selection.nodeId), sub: (parts.length ? parts : Object.values(c)).join(" · "), scope: "screen" as const };
    }
    if (selection.kind === "node") return { title: labelOf(selection.id), sub: `${derived.folded.nodeStats.get(selection.id)?.traces ?? 0} reached`, scope: "node" as const };
    if (selection.kind === "edge") return { title: selection.key.split("->").map(labelOf).join(" → "), sub: `${derived.folded.edgeCounts.get(selection.key) ?? 0} sessions`, scope: "edge" as const };
    return { title: "Whole run", sub: `${derived.folded.traceCount} sessions`, scope: "run" as const };
  })();
  const vstate = selScreen ? versionsOf(selScreen.id) : null;
  const suggestions =
    ctx.scope === "screen"
      ? ["Make the total much larger and add a per-traveler line", "Is the total consistent with the selected fare?", "Move the pay button above the payment methods"]
      : ["Which transitions fail most, and why?", "Which traveler types never reach payment?", "What's the untested tail?"];

  const subtitle = derived ? `${derived.project.source === "run" ? "Recorded run" : `Simulated · seed ${seed}`} · ${derived.folded.traceCount.toLocaleString()} sessions` : "Loading…";
  const menuItems = [
    ...(run ? [{ label: source === "run" ? "Switch to seeded simulation" : "Switch to recorded run", fn: () => setSource(source === "run" ? "sim" : "run") }] : []),
    {
      label: bug ? "Turn off seeded price-drift bug" : "Turn on seeded price-drift bug",
      fn: () => {
        setBug(!bug);
        setSource("sim");
      },
    },
  ];

  const compareVersions = compareScreenId ? versionsOf(compareScreenId) : null;

  return (
    <CanvasContext.Provider value={api}>
      <div className={`app${collapsed ? " panel-collapsed" : ""}`}>
        <main className="stage">
          {derived ? (
            <Canvas nodes={nodes} edges={edges} tool={tool} panning={spaceHeld} onNodeClick={selectNode} onEdgeClick={selectEdge} onPaneClick={clear} />
          ) : (
            <div className="loading">
              <span className="spinner" /> Loading run…
            </div>
          )}
        </main>

        <TopBar
          title={page === "journeys" ? "Getaway · Flight booking" : (derived?.project.title ?? "Forkcast")}
          subtitle={page === "journeys" ? (suite?.stats ?? "Loading…") : subtitle}
          badge={page === "journeys" && suite ? (suite.sample ? "Sample data" : "Gemini 4 Hydrogen builds every screen · Neon judges it") : undefined}
          badgeTitle="Every screen on this page was generated by Gemini for that traveler and turn, then checked against the fare data"
          page={page}
          onPage={setPage}
          canvasOn={canvasOn}
          onOpenCanvas={() => {
            setFlowView("canvas");
            setPage("flow");
          }}
          playTraffic={playTraffic}
          onPlayTraffic={setPlayTraffic}
          onPlayMode={canvasOn ? () => setPlayOpen(true) : undefined}
          onRunTests={runTests}
          onRun={rerun}
          onExport={exportRun}
          onFit={fit}
          onHelp={() => setHelp(true)}
          onTogglePanel={() => setCollapsed((c) => !c)}
          onClearNotes={clearNotes}
          tokenSummary={tokenTotal > 0 ? `${fmtTok(tokenTotal)} tok` : undefined}
          onResetTokens={resetTokens}
          menuItems={menuItems}
        />

        {derived && canvasOn && (
          <aside className={`lpanel floating${collapsed ? " is-collapsed" : ""}`} aria-label="Chat and layers">
            <header className="lpanel__head">
              <button className="icon-btn" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand panel" : "Collapse panel"} title="Toggle panel ( \ )">
                <IconPanel />
              </button>
              <div className="seg ptabs" role="tablist">
                <button role="tab" aria-selected={leftTab === "chat"} className={leftTab === "chat" ? "is-on" : ""} onClick={() => setLeftTab("chat")}>
                  <IconChat width={13} height={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                  Chat
                </button>
                <button role="tab" aria-selected={leftTab === "layers"} className={leftTab === "layers" ? "is-on" : ""} onClick={() => setLeftTab("layers")}>
                  <IconLayers width={13} height={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                  Layers
                </button>
                <button role="tab" aria-selected={leftTab === "history"} className={leftTab === "history" ? "is-on" : ""} onClick={() => setLeftTab("history")}>
                  <IconHistory width={13} height={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                  History
                  {(critiqueHistory.length > 0 || Object.keys(chats).length > 0) && (
                    <span className="tab-dot" aria-hidden="true" />
                  )}
                </button>
                {rightVisible && (
                  <button role="tab" aria-selected={leftTab === "props"} className={`ptab--props${leftTab === "props" ? " is-on" : ""}`} onClick={() => setLeftTab("props")}>
                    Props
                  </button>
                )}
              </div>
            </header>
            <div className="lpanel__body">
              {leftTab === "layers" ? (
                <Layers
                  graph={derived.graph}
                  screensByNode={derived.screensByNode}
                  failing={derived.failingByNode}
                  selection={selection}
                  picks={picks}
                  shown={shown}
                  onSelectNode={focusNode}
                  onSelectScreen={(id, nodeId) => selectScreen(id, nodeId, { focus: true })}
                  onPick={onPickLayer}
                />
              ) : leftTab === "history" ? (
                <HistoryPanel
                  graph={derived.graph}
                  screenById={derived.screenById}
                  chats={chats}
                  critiques={critiqueHistory}
                  activeCritiqueId={activeCritiqueId}
                  events={events}
                  activeChatKey={chatKey}
                  onOpenChatThread={(key) => {
                    if (key === "run") {
                      clear();
                    } else if (key.startsWith("node:")) {
                      focusNode(key.slice(5));
                    } else if (key.startsWith("edge:")) {
                      focusEdge(key.slice(5));
                    } else {
                      const baseId = key.split("@")[0];
                      const scr = derived.screenById.get(baseId);
                      if (scr) selectScreen(scr.id, scr.nodeId, { focus: true });
                    }
                    setLeftTab("chat");
                  }}
                  onToggleCritiqueOnCanvas={toggleCritiqueOnCanvas}
                  onEditCritiquePin={editCritiquePin}
                  onRestoreCritiquePinRevision={restoreCritiquePinRevision}
                  onMentionInChat={onMentionInChat}
                  onOpenEvent={(ev) => {
                    if (ev.critiqueId) {
                      const found = critiqueHistory.find((c) => c.id === ev.critiqueId);
                      if (found) {
                        toggleCritiqueOnCanvas(found);
                        return;
                      }
                    }
                    if (ev.traceId) {
                      setReplay({ traceId: ev.traceId, step: 0 });
                    } else if (ev.baseScreenId) {
                      const scr = derived.screenById.get(ev.baseScreenId);
                      if (scr) {
                        if (ev.versionIndex !== undefined) setVersion(scr.id, ev.versionIndex);
                        selectScreen(scr.id, scr.nodeId, { focus: true });
                      }
                      if (ev.chatKey) setLeftTab("chat");
                    } else if (ev.chatKey) {
                      if (ev.chatKey === "run") clear();
                      else if (ev.chatKey.startsWith("node:")) focusNode(ev.chatKey.slice(5));
                      else if (ev.chatKey.startsWith("edge:")) focusEdge(ev.chatKey.slice(5));
                      setLeftTab("chat");
                    }
                  }}
                  onExportHistory={() => {
                    const blob = new Blob(
                      [
                        JSON.stringify(
                          {
                            exportedAt: new Date().toISOString(),
                            chats,
                            critiques: critiqueHistory,
                            events,
                            annotations,
                            versions,
                            branches,
                            tokenTotal,
                          },
                          null,
                          2,
                        ),
                      ],
                      { type: "application/json" },
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `forkcast-history-${Date.now()}.json`;
                    a.click();
                    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                    toast({ tone: "ok", title: "History exported", body: `${critiqueHistory.length} critiques · ${Object.keys(chats).length} chat threads` });
                  }}
                />
              ) : leftTab === "props" && propsProps && rightVisible ? (
                <div className="rpanel__body" style={{ paddingTop: 4 }}>
                  <Properties {...propsProps} />
                </div>
              ) : (
                <Chat
                  scope={ctx.scope}
                  ctxTitle={ctx.title}
                  ctxSub={ctx.sub}
                  draft={chatDraft}
                  onDraftChange={setChatDraft}
                  messages={messages}
                  picks={picks && selScreen && picks.screenId === selScreen.id ? picks.items : []}
                  catalog={catalog}
                  attachedAnnotations={liveResolved?.includedAnnotations ?? []}
                  screenAttached={screenAttached}
                  busy={busy && busy.key === chatKey ? busy : null}
                  disambiguation={disambiguation && disambiguation.key === chatKey ? disambiguation.state : null}
                  versions={
                    selScreen && vstate && vstate.list.length > 1
                      ? {
                          count: vstate.list.length,
                          active: vstate.active,
                          finalized: vstate.finalized,
                          hidden: vstate.hidden,
                          onSet: (i) => setVersion(selScreen.id, i),
                          onCompare: () => setCompareScreenId(selScreen.id),
                        }
                      : undefined
                  }
                  suggestions={suggestions}
                  tokenTotal={tokenTotal}
                  graph={derived.graph}
                  inputRef={chatInput}
                  onRemovePick={(id) =>
                    setPicksState((p) => {
                      if (!p) return p;
                      const items = p.items.filter((x) => x.id !== id);
                      return items.length ? { ...p, items } : null;
                    })
                  }
                  onClearPicks={() => setPicksState(null)}
                  onAttachItem={onAttachCatalogItem}
                  onDetachAnnotation={onDetachAnnotation}
                  onDetachScreen={onDetachScreen}
                  onClearAllContext={onClearAllContext}
                  onCancelBusy={cancelBusy}
                  onUpdateDisambiguation={(cid, updater) =>
                    setDisambiguation((cur) =>
                      cur
                        ? {
                            ...cur,
                            state: {
                              ...cur.state,
                              controls: cur.state.controls.map((c: DisambiguationControl) => (c.id === cid ? updater(c) : c)),
                            },
                          }
                        : cur,
                    )
                  }
                  onConfirmDisambiguation={confirmDisambiguation}
                  onSkipDisambiguation={skipDisambiguation}
                  onSend={onSend}
                  onFlag={onFlag}
                  onOpenVersion={(i) => selScreen && setVersion(selScreen.id, i)}
                  onVoiceUsage={recordUsage}
                  onVoiceError={onVoiceError}
                />
              )}
            </div>
          </aside>
        )}

        {rightVisible && propsProps && <RightPanel {...propsProps} />}

        {canvasOn && drill && (
          <button className="btn pf-return" onClick={() => setFlowView("persona")} title="Back to the persona flow" data-persona-return>
            ← Persona flow
          </button>
        )}

        {personaView && drill && (
          <main className="page">
            <PersonaFlow
              drill={drill}
              onDrill={openDrill}
              onCanvas={() => setFlowView("canvas")}
              onBack={(mode) => {
                setPageState("tests");
                try {
                  window.history.replaceState(null, "", mode === "naive" ? "#tests/generic" : "#tests");
                } catch {
                  /* ignore */
                }
              }}
            />
          </main>
        )}

        {canvasOn && (
          <>
            <Toolbar tool={spaceHeld ? "hand" : tool} onTool={onToolChange} />
            <Dock canUndo={undoStack.length > 0} canRedo={redoStack.length > 0} onUndo={undo} onRedo={redo} onIn={zoomIn} onOut={zoomOut} onFit={fit} onHelp={() => setHelp(true)} />
          </>
        )}

        {page === "journeys" && (
          <main className="page">
            <JourneysPage />
          </main>
        )}

        {page === "tests" && derived && (
          <main className="page">
            <TestsPage
              graph={derived.graph}
              traces={derived.traces}
              invariants={derived.project.invariants}
              report={derived.report}
              folded={derived.folded}
              cov={derived.cov}
              lastRun={lastRun}
              onRunTests={runTests}
              onOpenPersona={(mode, personaId, intent) => openDrill({ mode, personaId, intent })}
              onOpenEdge={(k) => {
                setFlowView("canvas");
                setPage("flow");
                window.setTimeout(() => focusEdge(k), 0);
              }}
              onOpenNode={(id) => {
                setFlowView("canvas");
                setPage("flow");
                window.setTimeout(() => focusNode(id), 0);
              }}
              onReplay={(traceId) => {
                const f = derived.report.failures.find((x) => x.traceId === traceId);
                setFlowView("canvas");
                setPage("flow");
                if (f?.kind === "contract") {
                  selectEdge(f.where);
                  window.setTimeout(() => focusNodes(f.where.split("->"), 0.8), 0);
                } else if (f) selectNode(f.where);
                setReplay({ traceId, step: Math.max(0, (f?.stepIndex ?? 1) - 1) });
              }}
            />
          </main>
        )}

        {compareScreenId && compareVersions && (
          <CompareModal
            title={derived?.screenById.get(compareScreenId)?.variant ?? compareScreenId}
            baseScreenId={compareScreenId}
            versions={compareVersions.list}
            activeIndex={compareVersions.active}
            finalizedIndex={compareVersions.finalized}
            hiddenIndices={compareVersions.hidden}
            onSelectIndex={(idx) => setVersion(compareScreenId, idx)}
            onToggleFinalize={(idx) => toggleFinalizeVersion(compareScreenId, idx)}
            onToggleHidden={(idx) => toggleHiddenVersion(compareScreenId, idx)}
            onClose={() => setCompareScreenId(null)}
          />
        )}

        {playOpen && derived && (
          <PlayModal
            graph={derived.graph}
            screensByNode={derived.screensByNode}
            shown={shown}
            initialNodeId={selection.kind === "node" ? selection.id : selection.kind === "screen" ? selection.nodeId : undefined}
            initialScreenId={selection.kind === "screen" ? selection.id : undefined}
            onSaveTrace={savePlayTrace}
            onClose={() => setPlayOpen(false)}
          />
        )}

        <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
        {help && <HelpOverlay onClose={() => setHelp(false)} />}
      </div>
    </CanvasContext.Provider>
  );
}
