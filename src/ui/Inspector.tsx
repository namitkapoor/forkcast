import { useEffect, useMemo, useRef, useState } from "react";
import { edgeKey, type FlowGraph, type Trace, type Transition } from "../graph/types";
import type { FoldedGraph } from "../graph/fold";
import type { CheckReport, Failure } from "../checks/run";
import type { Coverage } from "../checks/coverage";
import type { Annotation, Screen } from "../a2ui/types";
import type { Selection, Tool } from "../canvas/context";
import type { Source } from "../canvas/model";
import { IconAlert, IconBranch, IconChevron, IconPanel, IconSpark, IconX } from "./icons";

export interface InspectorProps {
  title: string;
  source: Source;
  hasRun: boolean;
  graph: FlowGraph;
  traces: Trace[];
  folded: FoldedGraph;
  report: CheckReport;
  cov: Coverage;
  screensByNode: Map<string, Screen[]>;
  annotations: Record<string, Annotation[]>;
  selection: Selection;
  tool: Tool;
  bug: boolean;
  seed: number;
  branching: boolean;
  generating: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onBug: (v: boolean) => void;
  onRerun: () => void;
  onSource: (s: Source) => void;
  onFocusNode: (id: string) => void;
  onFocusEdge: (key: string) => void;
  onSelectScreen: (id: string, nodeId: string) => void;
  onClear: () => void;
  onBranch: (screen: Screen, utterance: string) => void;
  onGenerate: (nodeId: string) => void;
  onDeleteAnnotation: (screenId: string, id: string) => void;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function Inspector(p: InspectorProps) {
  const { selection } = p;
  let body: React.ReactNode;
  let heading: string;
  if (selection.kind === "screen") {
    const screen = p.screensByNode.get(selection.nodeId)?.find((s) => s.id === selection.id);
    heading = "Screen";
    body = screen ? <ScreenView {...p} screen={screen} /> : <Summary {...p} />;
  } else if (selection.kind === "node") {
    heading = "State";
    body = <NodeView {...p} nodeId={selection.id} />;
  } else if (selection.kind === "edge") {
    heading = "Transition";
    body = <EdgeView {...p} edge={selection.key} />;
  } else {
    heading = "Run summary";
    body = <Summary {...p} />;
  }

  return (
    <aside className={`inspector${p.collapsed ? " is-collapsed" : ""}`} aria-label="Inspector">
      <header className="inspector__head">
        <button className="icon-btn" onClick={p.onToggleCollapsed} aria-label={p.collapsed ? "Expand inspector" : "Collapse inspector"} title="Toggle inspector ( \\ )">
          <IconPanel />
        </button>
        <div className="inspector__crumbs">
          {selection.kind !== "none" ? (
            <>
              <button className="crumb" onClick={p.onClear}>
                Summary
              </button>
              <IconChevron width={12} height={12} className="crumb__sep" />
              <span className="crumb is-current">{heading}</span>
            </>
          ) : (
            <span className="crumb is-current">{heading}</span>
          )}
        </div>
        {selection.kind !== "none" && (
          <button className="icon-btn" onClick={p.onClear} aria-label="Clear selection" title="Clear (Esc)">
            <IconX />
          </button>
        )}
      </header>
      <div className="inspector__body">{body}</div>
    </aside>
  );
}

function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone?: "bad" | "ok" | "accent" }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ""}`}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

function Summary(p: InspectorProps) {
  const completed = p.traces.filter((t) => t.outcome === "completed").length;
  const groups = useMemo(() => groupFailures(p.report.failures), [p.report]);
  const labelOf = useLabels(p.graph);
  const covPct = pct(p.cov.edgesExercised, p.cov.edgesTotal);

  return (
    <>
      <section className="block">
        <div className="eyebrow">{p.source === "run" ? "Recorded run" : `Seeded simulation · seed ${p.seed}`}</div>
        <div className="stats">
          <Stat value={p.folded.traceCount.toLocaleString()} label="sessions" />
          <Stat value={`${pct(completed, p.folded.traceCount)}%`} label="completed" tone="ok" />
          <Stat value={p.report.failures.length.toLocaleString()} label="failed checks" tone={p.report.failures.length ? "bad" : undefined} />
        </div>
      </section>

      <section className="block">
        <h3>Coverage</h3>
        <div className="meter" role="img" aria-label={`${covPct}% of transitions exercised`}>
          <i style={{ width: `${covPct}%` }} />
        </div>
        <p className="lede">
          <b>{p.cov.edgesExercised}</b> of {p.cov.edgesTotal} transitions exercised
        </p>
        <p className="lede">
          95% of traffic runs over <b>{p.cov.edgesFor95}</b> transition{p.cov.edgesFor95 === 1 ? "" : "s"}
        </p>
        {p.cov.untested.length > 0 && (
          <div className="chips">
            {p.cov.untested.map((k) => (
              <button key={k} className="chip chip--untested" onClick={() => p.onFocusEdge(k)}>
                {edgeLabel(k, labelOf)}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="block">
        <h3>
          Failures <span className="count">{groups.length}</span>
        </h3>
        {groups.length === 0 && <p className="muted">Every invariant and contract held on every step.</p>}
        <ul className="fail-list">
          {groups.map((g) => (
            <li key={g.where}>
              <button
                className="fail"
                onClick={() => (g.kind === "contract" ? p.onFocusEdge(g.where) : p.onFocusNode(g.where))}
              >
                <IconAlert className="fail__icon" />
                <span className="fail__main">
                  <span className="fail__where">{g.kind === "contract" ? edgeLabel(g.where, labelOf) : labelOf(g.where)}</span>
                  <span className="fail__msg">{g.example}</span>
                </span>
                <span className="fail__count">{g.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <h3>Simulation</h3>
        {p.hasRun && (
          <div className="seg" role="radiogroup" aria-label="Data source">
            {(["run", "sim"] as const).map((s) => (
              <button key={s} role="radio" aria-checked={p.source === s} className={p.source === s ? "is-on" : ""} onClick={() => p.onSource(s)}>
                {s === "run" ? "Recorded run" : "Seeded sim"}
              </button>
            ))}
          </div>
        )}
        <label className="toggle">
          <input type="checkbox" checked={p.bug} onChange={(e) => p.onBug(e.target.checked)} />
          <span className="toggle__track" aria-hidden="true" />
          <span>
            Seed price-drift bug
            <small>5% of passengers→payment hops add $37</small>
          </span>
        </label>
        <button className="btn btn--block" onClick={p.onRerun}>
          Re-run simulation
          <span className="kbd">seed {p.seed + 1}</span>
        </button>
      </section>
    </>
  );
}

function NodeView(p: InspectorProps & { nodeId: string }) {
  const node = p.graph.nodes.find((n) => n.id === p.nodeId);
  const labelOf = useLabels(p.graph);
  if (!node) return <p className="muted">This state no longer exists.</p>;
  const stats = p.folded.nodeStats.get(node.id);
  const screens = p.screensByNode.get(node.id) ?? [];
  const incoming = p.graph.transitions.filter((t) => t.to === node.id);
  const outgoing = p.graph.transitions.filter((t) => t.from === node.id);
  const invFails = p.report.failures.filter((f) => f.kind === "invariant" && f.where === node.id);

  return (
    <>
      <section className="block">
        <div className="title-row">
          <h2>{node.label}</h2>
          {node.acts && <span className="badge badge--acts">commits</span>}
        </div>
        <div className="mono muted">
          {node.component} · {node.stage}
        </div>
        <div className="stats">
          <Stat value={`${pct(stats?.traces ?? 0, p.folded.traceCount)}%`} label="reach" />
          <Stat value={(stats?.visits ?? 0).toLocaleString()} label="visits" />
          <Stat value={`${pct(stats?.completions ?? 0, stats?.traces ?? 0)}%`} label="complete" tone="ok" />
        </div>
        {invFails.length > 0 && (
          <div className="callout callout--bad">
            <b>{invFails.length} invariant failures</b>
            <span>{invFails[0].message}</span>
          </div>
        )}
      </section>

      <section className="block">
        <h3>Contracts in</h3>
        <EdgeList edges={incoming} side="from" {...p} labelOf={labelOf} />
        <h3>Contracts out</h3>
        <EdgeList edges={outgoing} side="to" {...p} labelOf={labelOf} />
      </section>

      <section className="block">
        <h3>
          Screens <span className="count">{screens.length}</span>
        </h3>
        {screens.length === 0 && <p className="muted">No renderings recorded for this state yet.</p>}
        <ul className="screen-list">
          {screens.map((s) => (
            <li key={s.id}>
              <button onClick={() => p.onSelectScreen(s.id, node.id)}>
                <span className="screen-list__name">{s.variant}</span>
                <span className="screen-list__ctx">{Object.values(s.context).join(" · ")}</span>
                {(p.annotations[s.id]?.length ?? 0) > 0 && <span className="count">{p.annotations[s.id].length}</span>}
              </button>
            </li>
          ))}
        </ul>
        <button className="btn btn--block" onClick={() => p.onGenerate(node.id)} disabled={p.generating}>
          <IconSpark /> {p.generating ? "Generating…" : "Generate a screen for this state"}
        </button>
      </section>
    </>
  );
}

function EdgeList({
  edges,
  side,
  report,
  folded,
  onFocusEdge,
  labelOf,
}: InspectorProps & { edges: Transition[]; side: "from" | "to"; labelOf: (id: string) => string }) {
  if (!edges.length) return <p className="muted small">None</p>;
  return (
    <ul className="edge-list">
      {edges.map((t) => {
        const key = edgeKey(t.from, t.to);
        const count = folded.edgeCounts.get(key) ?? 0;
        const status = report.failingEdges.has(key) ? "fail" : count ? "pass" : "untested";
        return (
          <li key={t.id}>
            <button onClick={() => onFocusEdge(key)}>
              <span className={`dot dot--${status}`} />
              <span className="edge-list__name">
                {labelOf(side === "from" ? t.from : t.to)}
                <small>{t.kind}</small>
              </span>
              <span className="edge-list__carries">
                {t.contract?.carries.length ? t.contract.carries.map((c) => <code key={c}>{c}</code>) : <em>no contract</em>}
              </span>
              <span className="edge-list__count">{count || "—"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EdgeView(p: InspectorProps & { edge: string }) {
  const t = p.graph.transitions.find((x) => edgeKey(x.from, x.to) === p.edge || x.id === p.edge);
  const labelOf = useLabels(p.graph);
  if (!t) return <p className="muted">Transition not found.</p>;
  const key = edgeKey(t.from, t.to);
  const count = p.folded.edgeCounts.get(key) ?? 0;
  const fails = p.report.failures.filter((f) => f.kind === "contract" && f.where === key);
  return (
    <>
      <section className="block">
        <div className="title-row">
          <h2>
            {labelOf(t.from)} → {labelOf(t.to)}
          </h2>
        </div>
        <div className="mono muted">{t.kind}</div>
        <div className="stats">
          <Stat value={count.toLocaleString()} label="traversals" />
          <Stat value={fails.length} label="contract failures" tone={fails.length ? "bad" : undefined} />
          <Stat value={count ? (fails.length ? "fail" : "pass") : "—"} label="status" tone={fails.length ? "bad" : count ? "ok" : undefined} />
        </div>
      </section>
      <section className="block">
        <h3>Contract</h3>
        {t.contract?.carries.length ? (
          <div className="chips">
            {t.contract.carries.map((c) => (
              <code className="chip" key={c}>
                {c} must carry over
              </code>
            ))}
          </div>
        ) : (
          <p className="muted">No contract declared. Nothing is required to survive this jump.</p>
        )}
        {fails.length > 0 && (
          <ul className="fail-list">
            {fails.slice(0, 5).map((f) => (
              <li key={`${f.traceId}-${f.stepIndex}-${f.message}`} className="fail fail--static">
                <IconAlert className="fail__icon" />
                <span className="fail__main">
                  <span className="fail__where">
                    trace {f.traceId} · step {f.stepIndex}
                  </span>
                  <span className="fail__msg">{f.message}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="block">
        <div className="row-btns">
          <button className="btn" onClick={() => p.onFocusNode(t.from)}>
            Go to {labelOf(t.from)}
          </button>
          <button className="btn" onClick={() => p.onFocusNode(t.to)}>
            Go to {labelOf(t.to)}
          </button>
        </div>
      </section>
    </>
  );
}

function ScreenView(p: InspectorProps & { screen: Screen }) {
  const { screen } = p;
  const node = p.graph.nodes.find((n) => n.id === screen.nodeId);
  const notes = p.annotations[screen.id] ?? [];
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (p.tool === "branch") input.current?.focus();
  }, [p.tool, screen.id]);

  const submit = () => {
    if (!text.trim() || p.branching) return;
    p.onBranch(screen, text.trim());
  };

  return (
    <>
      <section className="block">
        <div className="eyebrow">
          {node?.label ?? screen.nodeId} · {screen.model}
        </div>
        <div className="title-row">
          <h2 className="mono">{screen.variant}</h2>
        </div>
        <p className="rationale">{screen.rationale}</p>
        <div className="chips">
          {Object.entries(screen.context).map(([k, v]) => (
            <span className="chip chip--ctx" key={k}>
              <span>{k}</span>
              {v}
            </span>
          ))}
        </div>
      </section>

      <section className="block branch">
        <h3>
          <IconBranch width={14} height={14} /> Branch
        </h3>
        <form
          className="branch__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="branch__label" htmlFor="branch-input">
            What if the user…
          </label>
          <div className="branch__row">
            <input
              id="branch-input"
              ref={input}
              className="nokeys"
              value={text}
              placeholder="asks for something cheaper"
              onChange={(e) => setText(e.target.value)}
              disabled={p.branching}
            />
            <button className="btn btn--accent" type="submit" disabled={!text.trim() || p.branching}>
              {p.branching ? <span className="spinner" aria-label="Branching" /> : "Branch"}
            </button>
          </div>
          <p className="muted small">Generates the next state and its screen, wired from {node?.label ?? "this state"}.</p>
        </form>
      </section>

      <section className="block">
        <h3>
          Annotations <span className="count">{notes.length}</span>
        </h3>
        {notes.length === 0 && (
          <p className="muted">
            Press <span className="kbd">A</span> and click the screen to pin a note.
          </p>
        )}
        <ol className="notes">
          {notes.map((a, i) => (
            <li key={a.id} className={`note note--${a.kind}`}>
              <span className={`pin pin--${a.kind} pin--inline`}>{i + 1}</span>
              <div className="note__body">
                <div className="note__meta">
                  {a.kind}
                  {a.componentId ? ` · ${a.componentId}` : ""}
                </div>
                <div>{a.text}</div>
              </div>
              <button className="icon-btn icon-btn--sm" aria-label="Delete annotation" onClick={() => p.onDeleteAnnotation(screen.id, a.id)}>
                <IconX width={12} height={12} />
              </button>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function useLabels(graph: FlowGraph) {
  return useMemo(() => {
    const m = new Map(graph.nodes.map((n) => [n.id, n.label]));
    return (id: string) => m.get(id) ?? id;
  }, [graph]);
}

function edgeLabel(key: string, labelOf: (id: string) => string) {
  const [a, b] = key.split("->");
  return `${labelOf(a)} → ${labelOf(b)}`;
}

function groupFailures(failures: Failure[]) {
  const m = new Map<string, { where: string; kind: Failure["kind"]; count: number; example: string }>();
  for (const f of failures) {
    const g = m.get(f.where) ?? { where: f.where, kind: f.kind, count: 0, example: f.message };
    g.count++;
    m.set(f.where, g);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}
