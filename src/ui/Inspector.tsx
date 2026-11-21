import { useEffect, useMemo, useRef, useState } from "react";
import { edgeKey, type FlowGraph, type Invariant, type Trace, type Transition } from "../graph/types";
import type { FoldedGraph } from "../graph/fold";
import type { CheckReport } from "../checks/run";
import type { Annotation, Screen } from "../a2ui/types";
import type { Picks, Selection, Tool } from "../canvas/context";
import { componentBindings, getComponents, getDataModel, resolveText } from "../a2ui/tree";
import { ScreenFrame } from "../a2ui/ScreenFrame";
import { IconAlert, IconBranch, IconChevron, IconComment, IconLasso, IconPerson, IconSpark, IconX } from "./icons";
import { useBrowserVoice } from "./useBrowserVoice";
import { VoiceButton, VoiceFeedback } from "./VoiceButton";

// Figma-style properties panel for whatever is selected: a picked component, a screen, a step
// or a transition, plus session replay. Rendered in the right panel (desktop) or the left
// sheet's Props tab (mobile).

export interface Versions {
  /** All versions of a base screen, original first. */
  list: Screen[];
  active: number;
}

export interface ReplayState {
  traceId: string;
  step: number;
}

export interface PropertiesProps {
  graph: FlowGraph;
  traces: Trace[];
  folded: FoldedGraph;
  report: CheckReport;
  invariants: Invariant[];
  screensByNode: Map<string, Screen[]>;
  screenById: Map<string, Screen>;
  annotations: Record<string, Annotation[]>;
  selection: Selection;
  picks: Picks | null;
  tool: Tool;
  branching: boolean;
  generating: boolean;
  replay: ReplayState | null;
  versionsOf: (baseId: string) => Versions;
  shown: (screen: Screen) => Screen;
  onSetVersion: (baseId: string, index: number) => void;
  onReplay: (r: ReplayState | null) => void;
  onFocusNode: (id: string) => void;
  onFocusEdge: (key: string) => void;
  onSelectScreen: (id: string, nodeId: string) => void;
  onClear: () => void;
  onBranch: (screen: Screen, utterance: string) => void;
  onGenerate: (nodeId: string) => void;
  onDeleteAnnotation: (screenId: string, id: string) => void;
  onEditWithAI: () => void;
  onFlagPicked: () => void;
  onLasso: () => void;
  onClearPicks: () => void;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** What the panel is about, for its header. Null = nothing to show. */
export function propertiesTitle(p: PropertiesProps): { kind: string; title: string } | null {
  if (p.replay) return { kind: "Replay", title: p.replay.traceId };
  const { selection } = p;
  if (selection.kind === "screen") {
    if (p.picks?.screenId === selection.id && p.picks.items.length)
      return p.picks.items.length === 1
        ? { kind: p.picks.items[0].type, title: p.picks.items[0].id }
        : { kind: "Components", title: `${p.picks.items.length} selected` };
    const s = p.screenById.get(selection.id);
    return { kind: "Screen", title: s ? p.shown(s).variant : selection.id };
  }
  if (selection.kind === "node") return { kind: "Step", title: p.graph.nodes.find((n) => n.id === selection.id)?.label ?? selection.id };
  if (selection.kind === "edge") {
    const [a, b] = selection.key.split("->");
    const l = (id: string) => p.graph.nodes.find((n) => n.id === id)?.label ?? id;
    return { kind: "Transition", title: `${l(a)} → ${l(b)}` };
  }
  return null;
}

export function Properties(p: PropertiesProps) {
  const { selection } = p;
  if (p.replay) return <Replay {...p} replay={p.replay} />;
  if (selection.kind === "screen") {
    const screen = p.screenById.get(selection.id);
    if (!screen) return <p className="muted">This screen no longer exists.</p>;
    if (p.picks?.screenId === selection.id && p.picks.items.length) return <ComponentView {...p} screen={screen} picks={p.picks} />;
    return <ScreenView {...p} screen={screen} />;
  }
  if (selection.kind === "node") return <NodeView {...p} nodeId={selection.id} />;
  if (selection.kind === "edge") return <EdgeView {...p} edge={selection.key} />;
  return null;
}

export function RightPanel(p: PropertiesProps) {
  const head = propertiesTitle(p);
  if (!head) return null;
  return (
    <aside className="rpanel floating" aria-label="Properties">
      <header className="rpanel__head">
        <div className="rpanel__title">
          <span className="rpanel__kind">{head.kind}</span> {head.title}
        </div>
        <button className="icon-btn icon-btn--sm" onClick={p.replay ? () => p.onReplay(null) : p.onClear} aria-label="Close" title="Close (Esc)">
          <IconX width={13} height={13} />
        </button>
      </header>
      <div className="rpanel__body">
        <Properties {...p} />
      </div>
    </aside>
  );
}

function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone?: "bad" | "ok" }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ""}`}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

function useLabels(graph: FlowGraph) {
  return useMemo(() => {
    const m = new Map(graph.nodes.map((n) => [n.id, n.label]));
    return (id: string) => m.get(id) ?? id;
  }, [graph]);
}

/** Checks that apply to a node: its invariants and the contracts on its in/out edges, with failure counts. */
function nodeChecks(p: PropertiesProps, nodeId: string) {
  const node = p.graph.nodes.find((n) => n.id === nodeId);
  const invs = p.invariants
    .filter((i) => i.component === node?.component)
    .map((i) => ({
      key: i.id,
      label: i.description,
      where: "invariant",
      fails: p.report.failures.filter((f) => f.kind === "invariant" && f.where === nodeId && f.message.startsWith(`${i.id}:`)).length,
      steps: p.folded.nodeStats.get(nodeId)?.visits ?? 0,
      carries: [] as string[],
    }));
  const edges = p.graph.transitions
    .filter((t) => (t.from === nodeId || t.to === nodeId) && t.contract?.carries.length)
    .map((t) => {
      const key = edgeKey(t.from, t.to);
      return {
        key,
        label: `${t.contract!.carries.join(", ")} carry over`,
        where: key,
        fails: p.report.failures.filter((f) => f.kind === "contract" && f.where === key).length,
        steps: p.folded.edgeCounts.get(key) ?? 0,
        carries: t.contract!.carries,
      };
    });
  return [...invs, ...edges];
}

function CheckRows({ checks, labelOf, onFocusEdge }: { checks: ReturnType<typeof nodeChecks>; labelOf: (id: string) => string; onFocusEdge: (k: string) => void }) {
  if (!checks.length) return <p className="muted small">No checks touch this.</p>;
  return (
    <div>
      {checks.map((c) => {
        const status = c.fails ? "fail" : c.steps ? "pass" : "untested";
        const edge = c.where.includes("->");
        return (
          <div key={c.key} className={`check check--${status}`}>
            <span className={`dot dot--${status}`} />
            <span style={{ minWidth: 0 }}>
              {edge ? (
                <button className="msg__link" onClick={() => onFocusEdge(c.where)}>
                  {c.where.split("->").map(labelOf).join(" → ")}
                </button>
              ) : (
                <b>{c.label}</b>
              )}
              {edge && <div className="muted small">{c.label}</div>}
            </span>
            <span className="check__n">{c.fails ? `${c.fails} fail` : c.steps ? `${c.steps} pass` : "not run"}</span>
          </div>
        );
      })}
    </div>
  );
}

function ComponentView(p: PropertiesProps & { screen: Screen; picks: Picks }) {
  const shown = p.shown(p.screen);
  const labelOf = useLabels(p.graph);
  const comps = useMemo(() => new Map(getComponents(shown.messages).map((c) => [c.id, c])), [shown.messages]);
  const model = useMemo(() => getDataModel(shown.messages), [shown.messages]);
  const first = p.picks.items[0];
  const c = comps.get(first.id);
  const bindings = c ? componentBindings(c, model) : [];
  // Contracts whose carried keys this component displays (via a binding path ending in that key).
  const checks = nodeChecks(p, p.screen.nodeId).filter(
    (k) => !k.carries.length || k.carries.some((key) => bindings.some((b) => b.path.split("/").some((seg) => seg.toLowerCase().startsWith(key.toLowerCase())))),
  );
  const PROPS = ["text", "label", "variant", "name", "value", "justify", "align", "usageHint", "description"];

  return (
    <>
      {p.picks.items.length > 1 && (
        <section className="block">
          <h3>Selection</h3>
          <div className="chips">
            {p.picks.items.map((it) => (
              <span key={it.id} className="chip">
                {it.type} <code>{it.id}</code>
              </span>
            ))}
          </div>
        </section>
      )}
      <section className="block">
        <dl className="props">
          <dt>Type</dt>
          <dd>{c?.type ?? first.type}</dd>
          <dt>Id</dt>
          <dd>
            <code>{first.id}</code>
          </dd>
          <dt>Shows</dt>
          <dd>{first.label}</dd>
          {c &&
            PROPS.filter((k) => c.props[k] !== undefined).map((k) => {
              const v = c.props[k];
              const bound = typeof v === "object" && v !== null && "path" in v;
              return (
                <FragmentRow key={k} k={k}>
                  {bound ? (
                    <>
                      <code>{String((v as { path: string }).path)}</code>
                      <small>{resolveText(v, model) || "—"}</small>
                    </>
                  ) : (
                    String(typeof v === "object" ? JSON.stringify(v) : v)
                  )}
                </FragmentRow>
              );
            })}
        </dl>
      </section>
      {bindings.length > 0 && (
        <section className="block">
          <h3>Data bindings</h3>
          <dl className="props">
            {bindings.slice(0, 10).map((b) => (
              <FragmentRow key={`${b.prop}${b.path}`} k={b.prop}>
                <code>{b.path}</code>
                <small>{b.value === undefined ? "per list item" : typeof b.value === "object" ? JSON.stringify(b.value).slice(0, 80) : String(b.value)}</small>
              </FragmentRow>
            ))}
          </dl>
        </section>
      )}
      <section className="block">
        <h3>Checks on this step</h3>
        <CheckRows checks={checks} labelOf={labelOf} onFocusEdge={p.onFocusEdge} />
      </section>
      <section className="block">
        <div className="row-btns">
          <button className="btn btn--primary" onClick={p.onEditWithAI}>
            <IconSpark width={14} height={14} /> Edit with AI
          </button>
          <button className="btn" onClick={p.onFlagPicked}>
            <IconComment width={14} height={14} /> Flag
          </button>
          <button className="btn" onClick={p.onLasso} title="Lasso more components (L)">
            <IconLasso width={14} height={14} /> Lasso
          </button>
        </div>
        <button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={p.onClearPicks}>
          Back to screen
        </button>
      </section>
    </>
  );
}

function FragmentRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </>
  );
}

function ScreenView(p: PropertiesProps & { screen: Screen }) {
  const { screen } = p;
  const shown = p.shown(screen);
  const node = p.graph.nodes.find((n) => n.id === screen.nodeId);
  const labelOf = useLabels(p.graph);
  const notes = p.annotations[shown.id] ?? [];
  const versions = p.versionsOf(screen.id);
  const [text, setText] = useState("");
  const voice = useBrowserVoice({ value: text, onChange: setText });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (p.tool === "branch") input.current?.focus();
  }, [p.tool, screen.id]);

  const submit = () => {
    if (!text.trim() || p.branching) return;
    voice.stop();
    p.onBranch(shown, text.trim());
  };

  return (
    <>
      <section className="block">
        <div className="eyebrow">
          {node?.label ?? screen.nodeId} · {shown.model}
        </div>
        <div className="title-row">
          <h2 className="mono">{shown.variant}</h2>
        </div>
        {shown.rationale && <p className="rationale">{shown.rationale}</p>}
        <div className="chips">
          {Object.entries(screen.context).map(([k, v]) => (
            <span className="chip chip--ctx" key={k}>
              <span>{k}</span>
              {v}
            </span>
          ))}
        </div>
      </section>

      {versions.list.length > 1 && (
        <section className="block">
          <h3>Versions</h3>
          <div className="chips">
            {versions.list.map((v, i) => (
              <button key={v.id} className={`vchip${versions.active === i ? " is-on" : ""}`} onClick={() => p.onSetVersion(screen.id, i)}>
                {i === 0 ? "v1 original" : `v${i + 1}`}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <h3>Checks</h3>
        <CheckRows checks={nodeChecks(p, screen.nodeId)} labelOf={labelOf} onFocusEdge={p.onFocusEdge} />
      </section>

      <section className="block branch">
        <h3>
          <IconBranch width={13} height={13} /> Branch
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
            <VoiceButton voice={voice} disabled={p.branching} compact ariaLabel="Speak branch scenario" />
            <input
              id="branch-input"
              ref={input}
              className="nokeys"
              value={text}
              placeholder="Speak or type: asks for something cheaper"
              onChange={(e) => setText(e.target.value)}
              disabled={p.branching}
            />
            <button className="btn btn--accent" type="submit" disabled={!text.trim() || p.branching}>
              {p.branching ? <span className="spinner" aria-label="Branching" /> : "Branch"}
            </button>
          </div>
          <VoiceFeedback voice={voice} />
        </form>
      </section>

      <section className="block">
        <h3>
          Annotations <span className="count">{notes.length}</span>
        </h3>
        {notes.length === 0 && (
          <p className="muted small">
            Press <span className="kbd">C</span> and click a component to pin a note.
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
              <button className="icon-btn icon-btn--sm" aria-label="Delete annotation" onClick={() => p.onDeleteAnnotation(shown.id, a.id)}>
                <IconX width={12} height={12} />
              </button>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function NodeView(p: PropertiesProps & { nodeId: string }) {
  const node = p.graph.nodes.find((n) => n.id === p.nodeId);
  const labelOf = useLabels(p.graph);
  if (!node) return <p className="muted">This step no longer exists.</p>;
  const stats = p.folded.nodeStats.get(node.id);
  const screens = p.screensByNode.get(node.id) ?? [];
  const incoming = p.graph.transitions.filter((t) => t.to === node.id);
  const outgoing = p.graph.transitions.filter((t) => t.from === node.id);
  const invFails = p.report.failures.filter((f) => f.kind === "invariant" && f.where === node.id);

  return (
    <>
      <section className="block">
        <div className="mono muted small">
          {node.component} · {node.stage}
        </div>
        <div className="stats">
          <Stat value={(stats?.traces ?? 0).toLocaleString()} label="reached" />
          <Stat value={`${pct(stats?.traces ?? 0, p.folded.traceCount)}%`} label="of sessions" />
          <Stat value={`${pct(stats?.completions ?? 0, stats?.traces ?? 0)}%`} label="completed" tone="ok" />
        </div>
        {invFails.length > 0 && (
          <div className="callout callout--bad">
            <b>{invFails.length} invariant failures</b>
            <span>{invFails[0].message}</span>
          </div>
        )}
      </section>
      <section className="block">
        <h3>Into this step</h3>
        <EdgeList edges={incoming} side="from" {...p} labelOf={labelOf} />
        <h3>Out of this step</h3>
        <EdgeList edges={outgoing} side="to" {...p} labelOf={labelOf} />
      </section>
      <section className="block">
        <h3>
          Screens <span className="count">{screens.length}</span>
        </h3>
        <ul className="screen-list">
          {screens.map((s) => (
            <li key={s.id}>
              <button onClick={() => p.onSelectScreen(s.id, node.id)}>
                <span className="screen-list__name">{p.shown(s).variant}</span>
                <span className="screen-list__ctx">{Object.values(s.context).filter((v) => !v.includes("→")).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
        <button className="btn btn--block" onClick={() => p.onGenerate(node.id)} disabled={p.generating}>
          <IconSpark /> {p.generating ? "Generating…" : "Generate a screen for this step"}
        </button>
      </section>
    </>
  );
}

function EdgeList({ edges, side, report, folded, onFocusEdge, labelOf }: PropertiesProps & { edges: Transition[]; side: "from" | "to"; labelOf: (id: string) => string }) {
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
              <span className="edge-list__count">
                <IconPerson width={11} height={11} />
                {count || "—"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EdgeView(p: PropertiesProps & { edge: string }) {
  const t = p.graph.transitions.find((x) => edgeKey(x.from, x.to) === p.edge || x.id === p.edge);
  const labelOf = useLabels(p.graph);
  if (!t) return <p className="muted">Transition not found.</p>;
  const key = edgeKey(t.from, t.to);
  const count = p.folded.edgeCounts.get(key) ?? 0;
  const fails = p.report.failures.filter((f) => f.kind === "contract" && f.where === key);
  const failingTraces = [...new Map(fails.map((f) => [f.traceId, f])).values()];
  return (
    <>
      <section className="block">
        <div className="mono muted small">{t.kind}</div>
        <div className="stats">
          <Stat value={count.toLocaleString()} label="sessions" />
          <Stat value={count - failingTraces.length >= 0 ? (count - failingTraces.length).toLocaleString() : "—"} label="passed" tone={count ? "ok" : undefined} />
          <Stat value={fails.length} label="failed" tone={fails.length ? "bad" : undefined} />
        </div>
      </section>
      <section className="block">
        <h3>Contract</h3>
        {t.contract?.carries.length ? (
          <div className="chips">
            {t.contract.carries.map((c) => (
              <code className="chip" key={c}>
                {c}
              </code>
            ))}
          </div>
        ) : (
          <p className="muted small">No contract declared. Nothing is required to survive this jump.</p>
        )}
      </section>
      {failingTraces.length > 0 && (
        <section className="block">
          <h3>
            Failing sessions <span className="count">{failingTraces.length}</span>
          </h3>
          <ul className="fail-list">
            {failingTraces.slice(0, 8).map((f) => (
              <li key={f.traceId}>
                <button className="fail" onClick={() => p.onReplay({ traceId: f.traceId, step: Math.max(0, f.stepIndex - 1) })}>
                  <IconAlert className="fail__icon" width={14} height={14} />
                  <span className="fail__main">
                    <span className="fail__where">{f.traceId} · replay</span>
                    <span className="fail__msg">{f.message}</span>
                  </span>
                  <IconChevron width={13} height={13} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="block">
        <div className="row-btns">
          <button className="btn btn--sm" onClick={() => p.onFocusNode(t.from)}>
            Go to {labelOf(t.from)}
          </button>
          <button className="btn btn--sm" onClick={() => p.onFocusNode(t.to)}>
            Go to {labelOf(t.to)}
          </button>
        </div>
      </section>
    </>
  );
}

/** Step through one session's screens, with the failures at each step. */
function Replay(p: PropertiesProps & { replay: ReplayState }) {
  const trace = p.traces.find((t) => t.id === p.replay.traceId);
  const labelOf = useLabels(p.graph);
  if (!trace) return <p className="muted">Session not found in this run.</p>;
  const i = Math.min(Math.max(0, p.replay.step), trace.steps.length - 1);
  const step = trace.steps[i];
  const screen = step.screenId ? p.screenById.get(step.screenId) : undefined;
  const fails = p.report.failures.filter((f) => f.traceId === trace.id && f.stepIndex === i);
  const go = (n: number) => p.onReplay({ traceId: trace.id, step: n });
  return (
    <div className="replay">
      <div className="replay__head">
        <b>{Object.values(trace.context).filter((v) => !v.includes("→")).join(" · ")}</b>
        <span style={{ marginLeft: "auto" }}>{trace.outcome}</span>
      </div>
      <div className="replay__step">
        Step {i + 1} of {trace.steps.length} · <b>{labelOf(step.node)}</b>
      </div>
      {screen ? (
        <div className={`replay__frame${fails.length ? " is-failing" : ""}`}>
          <ScreenFrame screen={p.shown(screen)} width={180} />
        </div>
      ) : (
        <div className="replay__props">No screen recorded for this step.</div>
      )}
      {fails.map((f) => (
        <div key={f.message} className="replay__fail">
          {f.message}
        </div>
      ))}
      {step.userAction && <div className="replay__step">“{step.userAction}”</div>}
      <div className="replay__props">{JSON.stringify(step.props)}</div>
      <div className="replay__nav">
        <button className="btn btn--sm" disabled={i === 0} onClick={() => go(i - 1)}>
          Previous
        </button>
        <button className="btn btn--sm" disabled={i >= trace.steps.length - 1} onClick={() => go(i + 1)}>
          Next
        </button>
        {screen && (
          <button className="btn btn--sm btn--ghost" onClick={() => p.onSelectScreen(screen.id, screen.nodeId)}>
            Open on canvas
          </button>
        )}
      </div>
    </div>
  );
}
