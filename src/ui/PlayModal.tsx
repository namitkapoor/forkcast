import { useEffect, useMemo, useState } from "react";
import { ScreenFrame } from "../a2ui/ScreenFrame";
import type { Screen, ScreenAction } from "../a2ui/types";
import { getDataModel } from "../a2ui/tree";
import type { FlowGraph, Step, Trace, Transition } from "../graph/types";
import { IconAlert, IconCheck, IconChevron, IconPlay, IconUndo, IconX } from "./icons";

export interface PlayModalProps {
  graph: FlowGraph;
  screensByNode: Map<string, Screen[]>;
  shown: (s: Screen) => Screen;
  initialNodeId?: string;
  initialScreenId?: string;
  onSaveTrace: (trace: Trace) => void;
  onClose: () => void;
}

interface RecordedWalkStep {
  step: Step;
  dwellMs: number;
  deadClicks: number;
  hesitated: boolean;
  backtracked: boolean;
}

function extractStepProps(screen?: Screen): Record<string, unknown> {
  if (!screen) return {};
  const dm = getDataModel(screen.messages);
  const booking = dm.booking;
  if (booking && typeof booking === "object" && !Array.isArray(booking)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(booking as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    }
    return out;
  }
  return {};
}

export function PlayModal({
  graph,
  screensByNode,
  shown,
  initialNodeId,
  initialScreenId,
  onSaveTrace,
  onClose,
}: PlayModalProps) {
  const startNode = useMemo(() => {
    if (initialNodeId && graph.nodes.some((n) => n.id === initialNodeId)) return initialNodeId;
    const targets = new Set(graph.transitions.map((t) => t.to));
    return graph.nodes.find((n) => !targets.has(n.id))?.id ?? graph.nodes[0]?.id ?? "";
  }, [graph, initialNodeId]);

  const [nodeId, setNodeId] = useState(startNode);
  const [prevNodeId, setPrevNodeId] = useState<string | null>(null);
  const [walk, setWalk] = useState<RecordedWalkStep[]>([]);
  const [enteredAt, setEnteredAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [deadClicks, setDeadClicks] = useState(0);
  const [lastAction, setLastAction] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setElapsedMs(Date.now() - enteredAt), 250);
    return () => window.clearInterval(t);
  }, [enteredAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const node = graph.nodes.find((n) => n.id === nodeId);
  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

  const currentBaseScreen = useMemo(() => {
    const list = screensByNode.get(nodeId) ?? [];
    if (nodeId === initialNodeId && initialScreenId) {
      const exact = list.find((s) => s.id === initialScreenId);
      if (exact) return exact;
    }
    return list[0];
  }, [screensByNode, nodeId, initialNodeId, initialScreenId]);

  const activeScreen = currentBaseScreen ? shown(currentBaseScreen) : undefined;
  const outgoing = useMemo(() => graph.transitions.filter((t) => t.from === nodeId), [graph.transitions, nodeId]);
  const hesitated = elapsedMs > 10_000 || deadClicks >= 2;

  const advance = (transition: Transition, actionLabel?: string) => {
    const now = Date.now();
    const dwell = now - enteredAt;
    const backtracked = transition.kind === "back" || transition.to === prevNodeId;
    const entry: RecordedWalkStep = {
      step: {
        node: nodeId,
        screenId: currentBaseScreen?.id,
        props: extractStepProps(activeScreen),
        userAction: actionLabel || `${transition.kind} → ${labelOf(transition.to)}`,
      },
      dwellMs: dwell,
      deadClicks,
      hesitated: dwell > 10_000 || deadClicks >= 2,
      backtracked,
    };
    setWalk((w) => [...w, entry]);
    setPrevNodeId(nodeId);
    setNodeId(transition.to);
    setEnteredAt(now);
    setElapsedMs(0);
    setDeadClicks(0);
    setLastAction(entry.step.userAction ?? null);
  };

  const handleScreenAction = (act: ScreenAction) => {
    const nameLower = act.name.toLowerCase();
    // Match A2UI button action against outgoing transitions cleanly
    const matched =
      outgoing.find((t) => nameLower.includes(t.to.toLowerCase())) ??
      (nameLower.includes("back") || nameLower.includes("cancel")
        ? outgoing.find((t) => t.kind === "back")
        : nameLower.includes("filter") || nameLower.includes("cheaper") || nameLower.includes("refine")
          ? outgoing.find((t) => t.kind === "refine")
          : outgoing.find((t) => t.kind === "next") ?? outgoing[0]);

    if (matched) {
      advance(matched, `Action "${act.name}"${act.sourceComponentId ? ` (${act.sourceComponentId})` : ""}`);
    } else {
      setLastAction(`Triggered "${act.name}" (terminal step)`);
    }
  };

  const finish = (completed: boolean) => {
    const finalStep: Step = {
      node: nodeId,
      screenId: currentBaseScreen?.id,
      props: extractStepProps(activeScreen),
      userAction: completed ? "Completed walkthrough" : "Dropped off",
    };
    const steps = [...walk.map((w) => w.step), finalStep];
    const hesitations = walk.filter((w) => w.hesitated).length + (hesitated ? 1 : 0);
    const backtracks = walk.filter((w) => w.backtracked).length;
    const trace: Trace = {
      id: `play-${Date.now().toString(36)}`,
      context: {
        ...(currentBaseScreen?.context ?? { party: "designer", surface: "inline", currency: "EUR" }),
        walkthrough: `${steps.length} steps · ${hesitations} hesit · ${backtracks} back`,
      },
      steps,
      outcome: completed ? "completed" : "abandoned",
    };
    onSaveTrace(trace);
    onClose();
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal-card modal-card--play floating"
        role="dialog"
        aria-modal="true"
        aria-label="Interactive Play Walkthrough"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-card__head">
          <div className="play-head__left">
            <span className="badge badge--accent">
              <IconPlay width={10} height={10} /> Play Walkthrough
            </span>
            <h2>{node?.label ?? nodeId}</h2>
            {activeScreen && <span className="muted small mono">{activeScreen.variant}</span>}
          </div>
          <div className="play-telemetry">
            <span className={`badge${elapsedMs > 10_000 ? " badge--bad" : ""}`}>{(elapsedMs / 1000).toFixed(1)}s dwell</span>
            <span className={`badge${deadClicks > 0 ? " badge--bad" : ""}`}>{deadClicks} dead clicks</span>
            {hesitated && (
              <span className="badge badge--bad">
                <IconAlert width={11} height={11} /> Hesitation
              </span>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <IconX />
            </button>
          </div>
        </header>

        <div
          className="play-stage"
          onClick={(e) => {
            // Clicks on empty background or static text inside the stage count as dead clicks
            const el = e.target as HTMLElement;
            if (el.closest(".fc-phone") && !el.closest("button, a, input, select, [role='button']")) {
              setDeadClicks((d) => d + 1);
            }
          }}
        >
          {activeScreen ? (
            <div className="play-stage__phone">
              <ScreenFrame screen={activeScreen} mode="live" width={300} onAction={handleScreenAction} />
            </div>
          ) : (
            <div className="ghost" style={{ width: 280, padding: 24 }}>
              <b>{node?.label ?? nodeId}</b>
              <p className="muted small">No generated screen recorded at this state yet. Use a transition below to continue.</p>
            </div>
          )}
          {lastAction && <div className="muted small">Last event: {lastAction}</div>}
        </div>

        <footer className="modal-card__foot play-foot">
          <div className="play-edges">
            <span className="muted small">Transitions:</span>
            {outgoing.length === 0 && <span className="muted small">Terminal state reached</span>}
            {outgoing.map((t) => (
              <button key={t.id} className="btn btn--sm" onClick={() => advance(t)}>
                {t.kind === "back" && <IconUndo width={12} height={12} />}
                <span>{labelOf(t.to)}</span>
                <small className="muted">({t.kind})</small>
                <IconChevron width={12} height={12} />
              </button>
            ))}
          </div>

          <div className="row-btns">
            <button className="btn btn--sm btn--ghost" onClick={() => finish(false)}>
              Record drop-off
            </button>
            <button className="btn btn--sm btn--primary" onClick={() => finish(true)}>
              <IconCheck width={12} height={12} /> Save trace ({walk.length + 1} steps)
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
