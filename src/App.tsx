import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Canvas } from "./canvas/Canvas";
import { CanvasContext, type CanvasApi, type Draft, type Selection, type Tool } from "./canvas/context";
import type { SectionFlowNode } from "./canvas/SectionNode";
import type { NoodleFlowEdge } from "./canvas/NoodleEdge";
import { layoutGraph, sectionSize, slotOffset, THUMB_H, THUMB_W, visibleScreens, type SectionSize } from "./canvas/geometry";
import {
  emptyBranches,
  groupScreens,
  isRunFile,
  projectFromRun,
  simulatedProject,
  withBranches,
  type Branches,
  type Source,
} from "./canvas/model";
import { foldTraces } from "./graph/fold";
import { runChecks } from "./checks/run";
import { coverage } from "./checks/coverage";
import { edgeKey } from "./graph/types";
import type { Annotation, Screen, ScreenAction } from "./a2ui/types";
import { loadRun, type RunFile } from "./data/run";
import { branchFromScreen, generateScreen, type BranchResponse } from "./lib/api";
import { Inspector } from "./ui/Inspector";
import { HelpOverlay, TopBar, ToolRail, Toasts, ZoomPill, type Toast } from "./ui/Chrome";
import { loadAnnotations, mergeAnnotations, prefersReducedMotion, saveAnnotations } from "./ui/storage";

export function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

const NONE: Selection = { kind: "none" };

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
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 720);
  const [help, setHelp] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [branching, setBranching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const toastId = useRef(0);

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

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === "error" ? 8000 : 4500);
  }, []);

  // ---- data ----
  const base = useMemo(() => {
    if (source === "loading") return null;
    return source === "run" && run ? projectFromRun(run) : simulatedProject(seed, bug);
  }, [source, run, seed, bug]);

  const derived = useMemo(() => {
    if (!base) return null;
    const project = withBranches(base, branches);
    const { graph, traces } = project;
    const folded = foldTraces(graph, traces);
    const report = runChecks(graph, project.invariants, traces);
    const cov = coverage(graph, folded);
    const screensByNode = groupScreens(graph, project.screens);
    const sizes = new Map<string, SectionSize>(graph.nodes.map((n) => [n.id, sectionSize(screensByNode.get(n.id)!.length)]));
    const placed = layoutGraph(graph, sizes);
    const branchIds = new Set(branches.nodes.map((n) => n.id));
    const failingByNode = new Set<string>(report.failingNodes);
    for (const k of report.failingEdges) k.split("->").forEach((id) => failingByNode.add(id));
    const order = [...graph.nodes].sort((a, b) => placed.get(a.id)!.depth - placed.get(b.id)!.depth || placed.get(a.id)!.y - placed.get(b.id)!.y);
    return { project, graph, traces, folded, report, cov, screensByNode, sizes, placed, branchIds, failingByNode, order };
  }, [base, branches]);

  // Annotations: stored ones for any screen we haven't seen yet.
  useEffect(() => {
    if (!derived) return;
    setAnnotations((prev) => {
      let next = prev;
      for (const s of derived.project.screens) {
        if (prev[s.id]) continue;
        const merged = mergeAnnotations(loadAnnotations(s.id), s.annotations ?? []);
        if (merged.length) next = { ...next, [s.id]: merged };
      }
      return next;
    });
  }, [derived]);

  // ---- viewport helpers ----
  const duration = () => (prefersReducedMotion() ? 0 : 450);

  const latest = useRef(derived);
  latest.current = derived;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  /** Visible canvas area in screen px, excluding the floating chrome (top bar, inspector, rail). */
  const viewArea = useCallback(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const mobile = W < 760;
    const panelOpen = !collapsedRef.current;
    const left = !mobile && panelOpen ? 404 : 16;
    const top = mobile ? 116 : 76;
    const right = mobile ? 56 : 64;
    const bottom = mobile ? (panelOpen ? H * 0.46 + 16 : 64) : 16;
    return { x: left, y: top, w: Math.max(80, W - left - right), h: Math.max(80, H - top - bottom) };
  }, []);

  /** Frame a flow-space rectangle inside the visible area. */
  const frame = useCallback(
    (r: { x: number; y: number; w: number; h: number }, opts: { pad?: number; maxZoom?: number; minZoom?: number } = {}) => {
      const a = viewArea();
      const pad = opts.pad ?? 0.1;
      const zoom = Math.min(opts.maxZoom ?? 1.2, Math.max(opts.minZoom ?? 0.08, Math.min(a.w / (r.w * (1 + pad * 2)), a.h / (r.h * (1 + pad * 2)))));
      const x = a.x + a.w / 2 - (r.x + r.w / 2) * zoom;
      const y = a.y + a.h / 2 - (r.y + r.h / 2) * zoom;
      void rf.setViewport({ x, y, zoom }, { duration: duration() });
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
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + s.w);
      y1 = Math.max(y1, p.y + s.h);
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  };

  const focusNodes = useCallback(
    (ids: string[], maxZoom = 1.1) => {
      const b = boundsOf(ids);
      if (b) frame(b, { pad: 0.08, maxZoom });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame],
  );

  const screenCentre = useCallback(
    (screenId: string, nodeId: string) => {
      if (!derived) return null;
      const pos = derived.placed.get(nodeId);
      const size = derived.sizes.get(nodeId);
      const screens = derived.screensByNode.get(nodeId) ?? [];
      if (!pos || !size) return null;
      const { shown } = visibleScreens(screens, screenId);
      const i = Math.max(0, shown.findIndex((s) => s.id === screenId));
      const o = slotOffset(size, i);
      return { x: pos.x + o.x + THUMB_W / 2, y: pos.y + o.y + THUMB_H / 2 };
    },
    [derived],
  );

  const focusScreen = useCallback(
    (screenId: string, nodeId: string) => {
      const c = screenCentre(screenId, nodeId);
      if (!c) return;
      frame({ x: c.x - THUMB_W / 2, y: c.y - THUMB_H / 2, w: THUMB_W, h: THUMB_H }, { pad: 0.06, maxZoom: 3, minZoom: 1.5 });
    },
    [frame, screenCentre],
  );

  const fit = useCallback(() => {
    const d = latest.current;
    const b = d && boundsOf(d.graph.nodes.map((n) => n.id));
    if (b) frame(b, { pad: 0.04, maxZoom: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  // Fit once when the first graph arrives.
  const fitted = useRef(false);
  useEffect(() => {
    if (!derived || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => {
      const d = latest.current;
      const b = d && boundsOf(d.graph.nodes.map((n) => n.id));
      if (b) {
        const a = viewArea();
        const fitZoom = Math.min(1, a.w / (b.w * 1.08), a.h / (b.h * 1.08));
        // Small screens: don't shrink the tree to dust; start at the root, readable, and let people pan.
        const zoom = Math.max(fitZoom, window.innerWidth < 760 ? 0.2 : 0);
        const root = d.placed.get(d.graph.nodes[0].id)!;
        const rootH = d.sizes.get(d.graph.nodes[0].id)!.h;
        const x = zoom > fitZoom ? a.x + 12 - b.x * zoom : a.x + a.w / 2 - (b.x + b.w / 2) * zoom;
        const y = zoom > fitZoom ? a.y + a.h / 2 - (root.y + rootH / 2) * zoom : a.y + a.h / 2 - (b.y + b.h / 2) * zoom;
        void rf.setViewport({ x, y, zoom });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived]);

  // ---- selection ----
  const selectNode = useCallback((id: string) => {
    setDraft(null);
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
    setSelection({ kind: "edge", key });
  }, []);
  const focusEdge = useCallback(
    (key: string) => {
      selectEdge(key);
      const [a, b] = key.split("->");
      focusNodes([a, b], 0.9);
    },
    [selectEdge, focusNodes],
  );
  const selectScreen = useCallback(
    (id: string, nodeId: string, opts?: { focus?: boolean }) => {
      setDraft((d) => (d && d.screenId !== id ? null : d));
      setSelection({ kind: "screen", id, nodeId });
      if (opts?.focus) focusScreen(id, nodeId);
    },
    [focusScreen],
  );
  const clear = useCallback(() => {
    setDraft(null);
    setSelection(NONE);
  }, []);

  // ---- annotations ----
  const saveDraft = useCallback(
    (text: string, kind: Annotation["kind"]) => {
      if (!draft) return;
      const a: Annotation = {
        id: `an-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        componentId: draft.componentId,
        x: draft.x,
        y: draft.y,
        text,
        kind,
        createdAt: new Date().toISOString(),
      };
      setAnnotations((prev) => {
        const list = [...(prev[draft.screenId] ?? []), a];
        saveAnnotations(draft.screenId, list);
        return { ...prev, [draft.screenId]: list };
      });
      setDraft(null);
      toast({ tone: "ok", title: "Note pinned", body: draft.componentId ? `on ${draft.componentId}` : undefined });
    },
    [draft, toast],
  );

  const deleteAnnotation = useCallback((screenId: string, id: string) => {
    setAnnotations((prev) => {
      const list = (prev[screenId] ?? []).filter((a) => a.id !== id);
      saveAnnotations(screenId, list);
      return { ...prev, [screenId]: list };
    });
  }, []);

  const clearNotes = useCallback(() => {
    setAnnotations((prev) => {
      for (const id of Object.keys(prev)) saveAnnotations(id, []);
      return {};
    });
    toast({ tone: "info", title: "Annotations cleared" });
  }, [toast]);

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
    [derived, toast, focusNodes],
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
    [derived, toast],
  );

  const rerun = useCallback(() => {
    setSource("sim");
    setSeed((s) => s + 1);
    toast({ tone: "info", title: "Simulation re-run", body: `500 sessions · seed ${seed + 1}` });
  }, [seed, toast]);

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
  }, [derived, annotations, toast]);

  // ---- keyboard ----
  const zoomIn = useCallback(() => void rf.zoomIn({ duration: duration() ? 200 : 0 }), [rf]);
  const zoomOut = useCallback(() => void rf.zoomOut({ duration: duration() ? 200 : 0 }), [rf]);

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest(".nokeys"));
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) {
        if (e.key === "Escape" && e.target instanceof HTMLElement && !e.target.closest(".composer")) e.target.blur();
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
        else clear();
        return;
      }
      if (help && k !== "?") return;
      const map: Record<string, Tool> = { v: "select", h: "hand", a: "annotate", b: "branch" };
      if (map[k.toLowerCase()] && !e.shiftKey) {
        setTool(map[k.toLowerCase()]);
        if (map[k.toLowerCase()] === "branch") setCollapsed(false);
        return;
      }
      if (k === "?") return setHelp((h) => !h);
      if (k === "+" || k === "=") return zoomIn();
      if (k === "-" || k === "_") return zoomOut();
      if (k === "0") return void rf.zoomTo(1, { duration: duration() });
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
  }, [help, draft, clear, zoomIn, zoomOut, rf, fit, selection, focusNodes, focusScreen, focusEdge, rerun, derived, focusNode]);

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
      selectNode,
      selectEdge,
      selectScreen,
      startDraft: (d) => {
        setDraft(d);
        setCollapsed(false);
      },
      cancelDraft: () => setDraft(null),
      saveDraft,
      onScreenAction,
    }),
    [selection, tool, spaceHeld, annotations, draft, selectNode, selectEdge, selectScreen, saveDraft, onScreenAction],
  );

  const onToolChange = (t: Tool) => {
    setTool(t);
    if (t === "branch") setCollapsed(false);
    if (t !== "annotate") setDraft(null);
  };

  const activeNode = selection.kind === "node" ? selection.id : selection.kind === "screen" ? selection.nodeId : undefined;
  const subtitle = derived
    ? `${derived.project.source === "run" ? "Recorded run" : "Simulated"} · ${derived.folded.traceCount.toLocaleString()} sessions`
    : "Loading…";

  return (
    <CanvasContext.Provider value={api}>
      <div className={`app${collapsed ? " panel-collapsed" : ""}`}>
        <main className="stage">
          {derived ? (
            <Canvas
              nodes={nodes}
              edges={edges}
              tool={tool}
              panning={spaceHeld}
              onNodeClick={selectNode}
              onEdgeClick={selectEdge}
              onPaneClick={clear}
            />
          ) : (
            <div className="loading">
              <span className="spinner" /> Loading run…
            </div>
          )}
        </main>

        <TopBar
          title={derived?.project.title ?? "Forkcast"}
          subtitle={subtitle}
          nodes={derived?.order ?? []}
          activeNode={activeNode}
          failing={derived?.failingByNode ?? new Set()}
          onTab={focusNode}
          onRun={rerun}
          onExport={exportRun}
          onFit={fit}
          onHelp={() => setHelp(true)}
          onTogglePanel={() => setCollapsed((c) => !c)}
          onClearNotes={clearNotes}
        />

        {derived && (
          <Inspector
            title={derived.project.title}
            source={derived.project.source}
            hasRun={!!run}
            graph={derived.graph}
            traces={derived.traces}
            folded={derived.folded}
            report={derived.report}
            cov={derived.cov}
            screensByNode={derived.screensByNode}
            annotations={annotations}
            selection={selection}
            tool={tool}
            bug={bug}
            seed={seed}
            branching={branching}
            generating={generating}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((c) => !c)}
            onBug={(v) => {
              setBug(v);
              setSource("sim");
            }}
            onRerun={rerun}
            onSource={setSource}
            onFocusNode={focusNode}
            onFocusEdge={focusEdge}
            onSelectScreen={(id, nodeId) => selectScreen(id, nodeId, { focus: true })}
            onClear={clear}
            onBranch={branch}
            onGenerate={generate}
            onDeleteAnnotation={deleteAnnotation}
          />
        )}

        <ToolRail tool={spaceHeld ? "hand" : tool} onTool={onToolChange} />
        <ZoomPill onIn={zoomIn} onOut={zoomOut} onFit={fit} onHelp={() => setHelp(true)} />
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
        {help && <HelpOverlay onClose={() => setHelp(false)} />}
      </div>
    </CanvasContext.Provider>
  );
}
