import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Canvas } from "./canvas/Canvas";
import { CanvasContext, type CanvasApi, type Draft, type Picks, type Selection, type Tool } from "./canvas/context";
import { LIVE_ZOOM, type SectionFlowNode } from "./canvas/SectionNode";
import type { NoodleFlowEdge } from "./canvas/NoodleEdge";
import { layoutGraph, sectionSize, slotOffset, THUMB_H, THUMB_W, visibleScreens, type SectionSize } from "./canvas/geometry";
import { emptyBranches, groupScreens, isRunFile, projectFromRun, simulatedProject, withBranches, type Branches, type Source } from "./canvas/model";
import { foldTraces } from "./graph/fold";
import { runChecks } from "./checks/run";
import { coverage } from "./checks/coverage";
import { edgeKey } from "./graph/types";
import type { Annotation, Screen, ScreenAction } from "./a2ui/types";
import { centroid, componentRects } from "./a2ui/componentRects";
import type { TreeNode } from "./a2ui/tree";
import { loadRun, type RunFile } from "./data/run";
import { askForkcast, branchFromScreen, editScreen, generateScreen, type BranchResponse } from "./lib/api";
import { Properties, RightPanel, type PropertiesProps, type ReplayState } from "./ui/Inspector";
import { Chat, type ChatMsg } from "./ui/Chat";
import { Layers } from "./ui/Layers";
import { TestsPage } from "./ui/pages/TestsPage";
import { JourneysPage } from "./ui/journeys/JourneysPage";
import { Dock, HelpOverlay, Toolbar, TopBar, Toasts, type Page, type Toast } from "./ui/Chrome";
import { IconChat, IconLayers, IconPanel } from "./ui/icons";
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
}

interface Snapshot {
  branches: Branches;
  annotations: Record<string, Annotation[]>;
  versions: Record<string, VersionState>;
}

// Journeys is the default page (no hash); Flow and Tests keep their own hash.
const pageFromHash = (): Page => {
  const h = typeof window !== "undefined" ? window.location.hash : "";
  return h === "#tests" ? "tests" : h === "#flow" ? "flow" : "journeys";
};
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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
  const [picks, setPicksState] = useState<Picks | null>(null);
  const [changed, setChanged] = useState<{ versionId: string; ids: string[] } | null>(null);
  const [playTraffic, setPlayTraffic] = useState(false);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [leftTab, setLeftTab] = useState<"chat" | "layers" | "props">("chat");
  const [chats, setChats] = useState<Record<string, ChatMsg[]>>({});
  const [busy, setBusy] = useState<{ key: string; label: string; startedAt: number } | null>(null);
  const [runNonce, setRunNonce] = useState(0);
  const [lastRun, setLastRun] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const [help, setHelp] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [branching, setBranching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const toastId = useRef(0);
  const chatInput = useRef<HTMLTextAreaElement>(null);

  // The renderer may set `color-scheme: light dark` globally; the tool chrome is always dark.
  useEffect(() => {
    document.documentElement.style.colorScheme = "dark";
    if (prefersReducedMotion()) document.documentElement.classList.add("reduce-motion");
  }, []);

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
    const on = () => setPageState(pageFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const setPage = useCallback((p: Page) => {
    setPageState(p);
    try {
      window.history.replaceState(null, "", p === "journeys" ? window.location.pathname + window.location.search : `#${p}`);
    } catch {
      /* ignore */
    }
  }, []);

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
    void runNonce; // "Run tests" re-runs every check over the loaded sessions.
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

  // Stored annotations and versions for screens we haven't seen yet.
  useEffect(() => {
    if (!derived) return;
    setVersions((prev) => {
      let next = prev;
      for (const s of derived.project.screens) {
        if (prev[s.id]) continue;
        const v = loadJson<VersionState | null>(`forkcast:versions:${s.id}`, null);
        if (v && Array.isArray(v.list) && v.list.length) next = { ...next, [s.id]: { list: v.list, active: Math.min(v.active ?? 0, v.list.length) } };
      }
      return next;
    });
  }, [derived]);
  useEffect(() => {
    if (!derived) return;
    setAnnotations((prev) => {
      let next = prev;
      const ids = [...derived.project.screens.map((s) => s.id), ...Object.values(versions).flatMap((v) => v.list.map((x) => x.id))];
      for (const id of ids) {
        if (prev[id]) continue;
        const s = derived.screenById.get(id);
        const merged = mergeAnnotations(loadAnnotations(id), s?.annotations ?? []);
        if (merged.length) next = { ...next, [id]: merged };
      }
      return next;
    });
  }, [derived, versions]);

  const shown = useCallback(
    (screen: Screen): Screen => {
      const v = versions[screen.id];
      return v && v.active > 0 ? (v.list[v.active - 1] ?? screen) : screen;
    },
    [versions],
  );
  const versionsOf = useCallback(
    (baseId: string) => {
      const s = derived?.screenById.get(baseId);
      const v = versions[baseId];
      return { list: s ? [s, ...(v?.list ?? [])] : [], active: v?.active ?? 0 };
    },
    [derived, versions],
  );
  const persistVersions = (baseId: string, v: VersionState | undefined) => saveJson(`forkcast:versions:${baseId}`, v && v.list.length ? v : null);

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

  // ---- viewport helpers (no animated camera moves: the tool stays snappy) ----
  const latest = useRef(derived);
  latest.current = derived;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const rightOpen = useRef(false);

  /** Visible canvas area in screen px, excluding the floating chrome. */
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

  // First view: readable screens, starting at the first step (pan to see the rest).
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
    (id: string, nodeId: string, opts?: { focus?: boolean }) => {
      setDraft((d) => (d && !d.screenId.startsWith(id) ? null : d));
      setPicksState((p) => (p && p.screenId !== id ? null : p));
      setSelection({ kind: "screen", id, nodeId });
      if (opts?.focus) focusScreen(id, nodeId);
    },
    [focusScreen],
  );
  const clear = useCallback(() => {
    setDraft(null);
    setPicksState(null);
    setReplay(null);
    setSelection(NONE);
  }, []);

  // ---- annotations ----
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
    (text: string, kind: Annotation["kind"]) => {
      if (!draft) return;
      addAnnotation(draft.screenId, { id: uid("an"), componentId: draft.componentId, x: draft.x, y: draft.y, text, kind, createdAt: new Date().toISOString() });
      setDraft(null);
      toast({ tone: "ok", title: `${kind === "note" ? "Note" : kind === "bug" ? "Bug" : "Rule"} pinned`, body: draft.componentId ? `on ${draft.componentId}` : undefined });
    },
    [draft, toast, addAnnotation],
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

  // ---- API: branch / generate ----
  const apiError = (e: unknown, what: string) => {
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
        if (!res?.node?.id || !res.screen?.id) throw new Error("Unexpected response from /api/branch");
        const taken = new Set(derived.graph.nodes.map((n) => n.id));
        let id = res.node.id;
        for (let i = 2; taken.has(id); i++) id = `${res.node.id}-${i}`;
        const node = { ...res.node, id };
        const transition = { ...res.transition, id: edgeKey(fromNode.id, id), from: fromNode.id, to: id, kind: res.transition?.kind ?? "digress" };
        const newScreen: Screen = { ...res.screen, nodeId: id, annotations: res.screen.annotations ?? [] };
        remember();
        setBranches((b) => ({ nodes: [...b.nodes, node], transitions: [...b.transitions, transition], screens: [...b.screens, newScreen] }));
        setSelection({ kind: "screen", id: newScreen.id, nodeId: id });
        toast({ tone: "ok", title: `Branched: ${node.label}`, body: `“${utterance}” from ${fromNode.label}` });
        window.setTimeout(() => focusNodes([id], 1), 60);
      } catch (e) {
        apiError(e, "Branching");
      } finally {
        setBranching(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derived, toast, focusNodes, remember],
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
  }, [derived, annotations, versions, toast]);

  // ---- chat ----
  const selScreen = selection.kind === "screen" ? derived?.screenById.get(selection.id) : undefined;
  const chatKey = selection.kind === "screen" ? selection.id : selection.kind === "node" ? `node:${selection.id}` : selection.kind === "edge" ? `edge:${selection.key}` : "run";
  const messages = useMemo(() => chats[chatKey] ?? loadJson<ChatMsg[]>(`forkcast:chat:${chatKey}`, []), [chats, chatKey]);
  const pushMsg = useCallback((key: string, m: Omit<ChatMsg, "id" | "at">) => {
    setChats((prev) => {
      const list = [...(prev[key] ?? loadJson<ChatMsg[]>(`forkcast:chat:${key}`, [])), { ...m, id: uid("m"), at: Date.now() }].slice(-60);
      saveJson(`forkcast:chat:${key}`, list);
      return { ...prev, [key]: list };
    });
  }, []);

  const labelOf = (id: string) => derived?.graph.nodes.find((n) => n.id === id)?.label ?? id;

  const ask = useCallback(
    async (key: string, question: string, screen?: Screen) => {
      const d = latest.current;
      if (!d) return;
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
        selection.kind === "screen"
          ? `Screen "${screen?.variant}" on step ${labelOf(selection.nodeId)} for ${Object.values(screen?.context ?? {}).join(" · ")}`
          : selection.kind === "node"
            ? `Step ${labelOf(selection.id)} (${d.folded.nodeStats.get(selection.id)?.traces ?? 0} sessions reached it)`
            : selection.kind === "edge"
              ? `Transition ${selection.key.split("->").map(labelOf).join(" → ")} (${d.folded.edgeCounts.get(selection.key) ?? 0} sessions)`
              : "Whole run";
      try {
        const completed = d.traces.filter((t) => t.outcome === "completed").length;
        const res = await askForkcast({
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
          history: (chats[key] ?? []).filter((m) => m.role !== "system").slice(-6).map((m) => ({ role: m.role as "user" | "assistant", text: m.text })),
        });
        pushMsg(key, { role: "assistant", text: res.answer });
      } catch (e) {
        pushMsg(key, { role: "system", tone: "error", text: `Couldn't answer\n${e instanceof Error ? e.message : String(e)}` });
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, chats, pushMsg, derived],
  );

  const edit = useCallback(
    async (baseScreen: Screen, instruction: string) => {
      const key = baseScreen.id;
      const current = shown(baseScreen);
      const ids = picks?.screenId === baseScreen.id ? picks.items.map((p) => p.id) : [];
      setBusy({ key, label: ids.length ? `Editing ${ids.length} component${ids.length === 1 ? "" : "s"}` : "Editing the screen", startedAt: Date.now() });
      const t0 = performance.now();
      try {
        const res = await editScreen({ screen: current, componentIds: ids, instruction });
        if (!res?.screen?.messages?.length) throw new Error("Unexpected response from /api/edit-screen");
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        const prev = versions[key]?.list ?? [];
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
        const next: VersionState = { list: [...prev, version], active: prev.length + 1 };
        setVersions((v) => ({ ...v, [key]: next }));
        persistVersions(key, next);
        setPicksState(null);
        setChanged({ versionId: version.id, ids: res.changed });
        pushMsg(key, {
          role: "system",
          tone: "edit",
          text: `Edited ${res.changed.length} component${res.changed.length === 1 ? "" : "s"} → v${n}\n${res.summary}${res.warnings.length ? `\nGuardrail: ${res.warnings.join("; ")}` : ""}\n${res.screen.model} · ${secs}s`,
          chips: res.changed.slice(0, 8),
          versionIndex: n - 1,
        });
      } catch (e) {
        pushMsg(key, { role: "system", tone: "error", text: `Edit failed\n${e instanceof Error ? e.message : String(e)}` });
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, picks, versions, remember, pushMsg],
  );

  const onSend = useCallback(
    (text: string) => {
      const key = chatKey;
      const chips = picks && selScreen && picks.screenId === selScreen.id ? picks.items.map((p) => p.id) : undefined;
      pushMsg(key, { role: "user", text, chips });
      if (selScreen && !(text.trim().endsWith("?") && !chips?.length)) void edit(selScreen, text);
      else void ask(key, text, selScreen ? shown(selScreen) : undefined);
    },
    [chatKey, picks, selScreen, pushMsg, edit, ask, shown],
  );

  /** Where a flag goes: the lasso centroid, else the first picked component's centre. */
  const flagAnchor = useCallback(
    (p: Picks) => {
      if (p.lasso && p.lasso.length > 2) return centroid(p.lasso);
      const el = document.querySelector(`[data-screen="${CSS.escape(p.screenId)}"] .fc-phone`);
      const r = el ? componentRects(el).find((x) => x.id === p.items[0]?.id) : undefined;
      return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 0.5, y: 0.5 };
    },
    [],
  );

  const onFlag = useCallback(
    (text: string, kind: Annotation["kind"]) => {
      if (!picks || !selScreen || picks.screenId !== selScreen.id) return;
      const at = flagAnchor(picks);
      const target = shown(selScreen);
      addAnnotation(target.id, { id: uid("an"), componentId: picks.items[0]?.id, x: at.x, y: at.y, text, kind, createdAt: new Date().toISOString() });
      pushMsg(selScreen.id, { role: "system", tone: "flag", text: `Flagged ${kind}: ${text}\non ${picks.items.map((i) => i.id).join(", ")}`, chips: picks.items.map((i) => i.id) });
      toast({ tone: "ok", title: `Flagged as ${kind}`, body: `on ${picks.items[0]?.id}` });
    },
    [picks, selScreen, flagAnchor, shown, addAnnotation, pushMsg, toast],
  );

  const setVersion = useCallback((baseId: string, i: number) => {
    setVersions((v) => {
      const cur = v[baseId];
      if (!cur) return v;
      const next = { ...cur, active: Math.max(0, Math.min(i, cur.list.length)) };
      persistVersions(baseId, next);
      return { ...v, [baseId]: next };
    });
    setPicksState(null);
  }, []);

  // ---- tools ----
  const onToolChange = useCallback(
    (t: Tool) => {
      setTool(t);
      if (t !== "annotate") setDraft(null);
      if (t === "lasso" || t === "annotate") {
        setCollapsed(false);
        if (t === "lasso") setLeftTab("chat");
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
      if (k === " ") {
        setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if (k === "Escape") {
        if (help) setHelp(false);
        else if (draft) setDraft(null);
        else if (picks) setPicksState(null);
        else if (replay) setReplay(null);
        else clear();
        return;
      }
      if (help && k !== "?") return;
      if (page !== "flow") return;
      const map: Record<string, Tool> = { v: "select", h: "hand", l: "lasso", c: "annotate", a: "annotate", b: "branch" };
      if (map[k.toLowerCase()] && !e.shiftKey) return onToolChange(map[k.toLowerCase()]);
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
  }, [help, draft, picks, replay, page, clear, zoomIn, zoomOut, rf, fit, selection, focusNodes, focusScreen, focusEdge, rerun, derived, focusNode, onToolChange, undo, redo]);

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

  const api = useMemo<CanvasApi>(
    () => ({
      selection,
      tool: spaceHeld ? "hand" : tool,
      annotations,
      draft,
      picks,
      changed,
      playTraffic,
      shown,
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
      onScreenAction,
    }),
    [selection, tool, spaceHeld, annotations, draft, picks, changed, playTraffic, shown, selectNode, selectEdge, selectScreen, setPicks, saveDraft, onScreenAction],
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
        selection,
        picks,
        tool,
        branching,
        generating,
        replay,
        versionsOf,
        shown,
        onSetVersion: setVersion,
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
      }
    : null;
  const rightVisible = !!propsProps && page === "flow" && (!!replay || selection.kind !== "none");
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
          title={derived?.project.title ?? "Forkcast"}
          subtitle={subtitle}
          page={page}
          onPage={setPage}
          playTraffic={playTraffic}
          onPlayTraffic={setPlayTraffic}
          onRunTests={runTests}
          onRun={rerun}
          onExport={exportRun}
          onFit={fit}
          onHelp={() => setHelp(true)}
          onTogglePanel={() => setCollapsed((c) => !c)}
          onClearNotes={clearNotes}
          menuItems={menuItems}
        />

        {derived && page === "flow" && (
          <aside className={`lpanel floating${collapsed ? " is-collapsed" : ""}`} aria-label="Chat and layers">
            <header className="lpanel__head">
              <button className="icon-btn" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand panel" : "Collapse panel"} title="Toggle panel ( \ )">
                <IconPanel />
              </button>
              <div className="seg ptabs" role="tablist">
                <button role="tab" aria-selected={leftTab === "chat"} className={leftTab === "chat" ? "is-on" : ""} onClick={() => setLeftTab("chat")}>
                  <IconChat width={13} height={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                  Chat
                </button>
                <button role="tab" aria-selected={leftTab === "layers"} className={leftTab === "layers" ? "is-on" : ""} onClick={() => setLeftTab("layers")}>
                  <IconLayers width={13} height={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                  Layers
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
              ) : leftTab === "props" && propsProps && rightVisible ? (
                <div className="rpanel__body" style={{ paddingTop: 4 }}>
                  <Properties {...propsProps} />
                </div>
              ) : (
                <Chat
                  scope={ctx.scope}
                  ctxTitle={ctx.title}
                  ctxSub={ctx.sub}
                  messages={messages}
                  picks={picks && selScreen && picks.screenId === selScreen.id ? picks.items : []}
                  busy={busy && busy.key === chatKey ? busy : null}
                  versions={selScreen && vstate && vstate.list.length > 1 ? { count: vstate.list.length, active: vstate.active, onSet: (i) => setVersion(selScreen.id, i) } : undefined}
                  suggestions={suggestions}
                  inputRef={chatInput}
                  onRemovePick={(id) =>
                    setPicksState((p) => {
                      if (!p) return p;
                      const items = p.items.filter((x) => x.id !== id);
                      return items.length ? { ...p, items } : null;
                    })
                  }
                  onClearPicks={() => setPicksState(null)}
                  onSend={onSend}
                  onFlag={onFlag}
                  onOpenVersion={(i) => selScreen && setVersion(selScreen.id, i)}
                />
              )}
            </div>
          </aside>
        )}

        {rightVisible && propsProps && <RightPanel {...propsProps} />}

        {page === "flow" && (
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
              onOpenEdge={(k) => {
                setPage("flow");
                window.setTimeout(() => focusEdge(k), 0);
              }}
              onOpenNode={(id) => {
                setPage("flow");
                window.setTimeout(() => focusNode(id), 0);
              }}
              onReplay={(traceId) => {
                const f = derived.report.failures.find((x) => x.traceId === traceId);
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

        <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
        {help && <HelpOverlay onClose={() => setHelp(false)} />}
      </div>
    </CanvasContext.Provider>
  );
}
