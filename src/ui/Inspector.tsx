import { useEffect, useMemo, useRef, useState } from "react";
import { edgeKey, type FlowGraph, type Invariant, type Trace, type Transition } from "../graph/types";
import type { FoldedGraph } from "../graph/fold";
import type { CheckReport } from "../checks/run";
import type { Annotation, Screen } from "../a2ui/types";
import type { Picks, Selection, Tool } from "../canvas/context";
import { componentBindings, getComponents, getDataModel, resolveText } from "../a2ui/tree";
import { ScreenFrame } from "../a2ui/ScreenFrame";
import type { TokenUsage, UxEvaluationReport } from "../lib/api";
import {
  CRITIC_MODELS,
  EFFORT_LABELS,
  getCriticModelSpec,
  normalizeCriticConfig,
  type CriticConfig,
} from "../lib/criticModels";
import { formatVersionedRef, normalizeAnnotation } from "./annotations";
import { ensureCritiqueVersionedPins, type CritiqueRecord } from "./history";
import {
  IconAlert,
  IconBranch,
  IconBrush,
  IconCheck,
  IconChevron,
  IconCols,
  IconComment,
  IconCrown,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconHistory,
  IconLasso,
  IconPerson,
  IconPin,
  IconSpark,
  IconUndo,
  IconX,
} from "./icons";
import { useVoiceInput, VoiceMicButton } from "./useVoiceInput";

// Figma-style properties panel for whatever is selected: a picked component, a screen, a step
// or a transition, plus session replay, versioned @Pin/@Mask annotations, variant compare/finalize,
// and automated Gemini UX critique.

export interface Versions {
  /** All versions of a base screen, original first. */
  list: Screen[];
  active: number;
  finalized?: number;
  hidden: number[];
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
  uxReports: Record<string, UxEvaluationReport>;
  critiqueHistory: CritiqueRecord[];
  activeCritiqueId: string | null;
  criticConfig: CriticConfig;
  selection: Selection;
  picks: Picks | null;
  tool: Tool;
  branching: boolean;
  generating: boolean;
  critiquing: boolean;
  busy: boolean;
  replay: ReplayState | null;
  versionsOf: (baseId: string) => Versions;
  shown: (screen: Screen) => Screen;
  onSetVersion: (baseId: string, index: number) => void;
  onToggleFinalizeVersion: (baseId: string, index: number) => void;
  onToggleHiddenVersion: (baseId: string, index: number) => void;
  onCompareVersions: (baseId: string) => void;
  onCriticConfigChange: (next: CriticConfig) => void;
  onCritiqueScreen: (screen: Screen) => void;
  onToggleCritiqueOnCanvas: (rec: CritiqueRecord) => void;
  onEditCritiquePin: (critiqueId: string, pinId: string, nextText: string) => void;
  onRestoreCritiquePinRevision: (critiqueId: string, pinId: string, revisionId: string) => void;
  onResolveCritiquePinsWithAi: (baseScreen: Screen, rec: CritiqueRecord) => void;
  onOpenHistory: () => void;
  onReplay: (r: ReplayState | null) => void;
  onFocusNode: (id: string) => void;
  onFocusEdge: (key: string) => void;
  onSelectScreen: (id: string, nodeId: string) => void;
  onClear: () => void;
  onBranch: (screen: Screen, utterance: string) => void;
  onGenerate: (nodeId: string) => void;
  onMentionInChat: (token: string) => void;
  onEditAnnotation: (screenId: string, id: string, nextText: string) => void;
  onToggleAnnotationStatus: (screenId: string, id: string) => void;
  onToggleAnnotationAi: (screenId: string, id: string) => void;
  onSetAllAnnotationsAi: (screenId: string, include: boolean) => void;
  onRestoreAnnotationRevision: (screenId: string, id: string, revId: string) => void;
  onResolveIncludedAnnotations: (baseScreen: Screen) => void;
  onDeleteAnnotation: (screenId: string, id: string) => void;
  onEditWithAI: () => void;
  onFlagPicked: () => void;
  onLasso: () => void;
  onClearPicks: () => void;
  onVoiceUsage?: (u: TokenUsage) => void;
  onVoiceError?: (msg: string) => void;
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
  const screenNotes = (p.annotations[shown.id] ?? []).map((a, i) => normalizeAnnotation(a, i + 1));
  const versions = p.versionsOf(screen.id);
  const screenCritiques = useMemo(
    () =>
      p.critiqueHistory
        .filter((c) => c.baseScreenId === screen.id)
        .map(ensureCritiqueVersionedPins)
        .sort((a, b) => b.createdAt - a.createdAt),
    [p.critiqueHistory, screen.id],
  );
  const [selectedCritiqueId, setSelectedCritiqueId] = useState<string | null>(null);
  const activeCritique = useMemo(
    () =>
      (p.activeCritiqueId ? screenCritiques.find((c) => c.id === p.activeCritiqueId) : undefined) ??
      (selectedCritiqueId ? screenCritiques.find((c) => c.id === selectedCritiqueId) : undefined) ??
      screenCritiques.find((c) => c.screenId === shown.id) ??
      screenCritiques[0],
    [p.activeCritiqueId, selectedCritiqueId, screenCritiques, shown.id],
  );
  const uxReport = activeCritique?.report ?? p.uxReports[shown.id];
  const [editingCriticPinId, setEditingCriticPinId] = useState<string | null>(null);
  const [editCriticPinText, setEditCriticPinText] = useState("");
  const [expandedCriticRevPinId, setExpandedCriticRevPinId] = useState<string | null>(null);

  const [text, setText] = useState("");
  const textRef = useRef(text);
  textRef.current = text;
  const input = useRef<HTMLInputElement>(null);

  const [pinScope, setPinScope] = useState<"screen" | "all">("screen");
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const [editAnnText, setEditAnnText] = useState("");
  const [expandedRevAnnId, setExpandedRevAnnId] = useState<string | null>(null);

  const branchVoice = useVoiceInput({
    getCurrentText: () => textRef.current,
    onTextUpdate: setText,
    graph: p.graph,
    onUsage: p.onVoiceUsage,
    onError: p.onVoiceError,
  });

  useEffect(() => {
    if (p.tool === "branch") input.current?.focus();
  }, [p.tool, screen.id]);

  const submit = () => {
    if (!text.trim() || p.branching) return;
    branchVoice.stop();
    p.onBranch(shown, text.trim());
  };

  const allFlowNotes = useMemo(() => {
    const out: { screenId: string; baseId: string; nodeId: string; ann: Annotation }[] = [];
    for (const [sid, list] of Object.entries(p.annotations)) {
      const baseId = sid.split("@")[0];
      const owner = p.screenById.get(baseId);
      for (const a of list) {
        out.push({ screenId: sid, baseId, nodeId: owner?.nodeId ?? "", ann: normalizeAnnotation(a) });
      }
    }
    return out;
  }, [p.annotations, p.screenById]);

  const displayedNotes = useMemo(
    () =>
      pinScope === "screen"
        ? screenNotes.map((ann) => ({ screenId: shown.id, baseId: screen.id, nodeId: screen.nodeId, ann }))
        : allFlowNotes,
    [pinScope, screenNotes, shown.id, screen.id, screen.nodeId, allFlowNotes],
  );

  const optedInCount = screenNotes.filter((a) => a.status !== "resolved" && a.includeInAiFeedback !== false).length;
  const hiddenSet = new Set(versions.hidden);
  const isCurrentFinal = versions.finalized === versions.active;

  return (
    <>
      <section className="block">
        <div className="eyebrow">
          {node?.label ?? screen.nodeId} · {shown.model}
        </div>
        <div className="title-row">
          <h2 className="mono">{shown.variant}</h2>
          {isCurrentFinal && (
            <span className="badge badge--ok">
              <IconCrown width={10} height={10} /> Final
            </span>
          )}
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
        <div className="row-btns" style={{ marginTop: 10 }}>
          <button
            className={`btn btn--sm${isCurrentFinal ? " btn--accent" : ""}`}
            onClick={() => p.onToggleFinalizeVersion(screen.id, versions.active)}
            title={isCurrentFinal ? "Unmark finalized version" : "Mark this version as finalized"}
          >
            <IconCrown width={12} height={12} /> {isCurrentFinal ? "Finalized" : "Mark Final"}
          </button>
          {versions.list.length > 1 && (
            <button className="btn btn--sm" onClick={() => p.onCompareVersions(screen.id)}>
              <IconCols width={12} height={12} /> Compare ({versions.list.length})
            </button>
          )}
        </div>
      </section>

      <section className="block">
        <div className="ann-head">
          <h3>
            UX Critique
            {uxReport && <span className="badge badge--accent">{uxReport.overallScore}/100</span>}
          </h3>
          <button className="msg__link" onClick={p.onOpenHistory} title="View all saved critiques and chats in History">
            History ({p.critiqueHistory.length}) →
          </button>
        </div>

        {(() => {
          const activeModelSpec = getCriticModelSpec(p.criticConfig.model);
          return (
            <div className="critic-bar nokeys">
              <select
                className="critic-select"
                aria-label="Critic model"
                title="Select Gemini 4 model for UX Critique"
                value={p.criticConfig.model}
                disabled={p.critiquing}
                onChange={(e) => p.onCriticConfigChange(normalizeCriticConfig(e.target.value, p.criticConfig.effort))}
              >
                {CRITIC_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.shortLabel}
                  </option>
                ))}
              </select>
              <select
                className="critic-select critic-select--effort"
                aria-label="Critic reasoning effort"
                title={`Reasoning effort (valid for ${activeModelSpec.label}: ${activeModelSpec.validEfforts.join(", ")})`}
                value={p.criticConfig.effort}
                disabled={p.critiquing}
                onChange={(e) => p.onCriticConfigChange(normalizeCriticConfig(p.criticConfig.model, e.target.value))}
              >
                {activeModelSpec.validEfforts.map((eff) => (
                  <option key={eff} value={eff}>
                    {EFFORT_LABELS[eff]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--sm btn--accent"
                disabled={p.critiquing}
                onClick={() => p.onCritiqueScreen(shown)}
                title={`Run UX Critique with ${activeModelSpec.label} (${EFFORT_LABELS[p.criticConfig.effort]} effort)`}
              >
                <IconSpark width={12} height={12} /> {p.critiquing ? "Running…" : "Critique"}
              </button>
            </div>
          );
        })()}

        {p.critiquing && (
          <div className="msg msg--pending" style={{ marginBottom: uxReport ? 8 : 0 }}>
            <span className="spinner" /> Running {getCriticModelSpec(p.criticConfig.model).label} ({EFFORT_LABELS[p.criticConfig.effort]})…
          </div>
        )}

        {!uxReport && !p.critiquing && (
          <p className="muted small" style={{ margin: 0 }}>
            Pick a model &amp; reasoning effort above and click <b>Critique</b> to score this screen and pin findings.
          </p>
        )}

        {uxReport && (
          <>
            {screenCritiques.length > 1 && (
              <div className="chips" style={{ marginTop: 0, marginBottom: 8 }}>
                {screenCritiques.map((c, idx) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`vchip${activeCritique?.id === c.id ? " is-on" : ""}`}
                    onClick={() => {
                      setSelectedCritiqueId(c.id);
                      if (p.activeCritiqueId !== c.id) p.onToggleCritiqueOnCanvas(c);
                    }}
                  >
                    #{screenCritiques.length - idx} · v{c.versionIndex + 1} · {c.report.overallScore}
                  </button>
                ))}
              </div>
            )}
            <div className="ann-head" style={{ marginBottom: 6 }}>
              <span className="muted small mono">
                {uxReport.model}
                {uxReport.thinkingLevel ? ` · ${uxReport.thinkingLevel.toLowerCase()} effort` : ""}
              </span>
              {activeCritique && (activeCritique.versionedPins?.length ?? 0) > 0 && (
                <button
                  type="button"
                  className={`vchip${p.activeCritiqueId === activeCritique.id ? " is-on" : ""}`}
                  onClick={() => p.onToggleCritiqueOnCanvas(activeCritique)}
                  title={p.activeCritiqueId === activeCritique.id ? "Hide ephemeral Critic pins from freeform canvas" : "Show these versioned Critic pins on the freeform canvas"}
                >
                  {p.activeCritiqueId === activeCritique.id ? (
                    <>
                      <IconEyeOff width={10} height={10} style={{ marginRight: 3, verticalAlign: -1 }} /> Hide pins
                    </>
                  ) : (
                    <>
                      <IconEye width={10} height={10} style={{ marginRight: 3, verticalAlign: -1 }} /> Show pins ({activeCritique.versionedPins!.length})
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="ux-dims">
              <div className="ux-dim">
                <span>Usability</span>
                <b>{uxReport.dimensions.usability}</b>
              </div>
              <div className="ux-dim">
                <span>Hierarchy</span>
                <b>{uxReport.dimensions.hierarchy}</b>
              </div>
              <div className="ux-dim">
                <span>Access.</span>
                <b>{uxReport.dimensions.accessibility}</b>
              </div>
              <div className="ux-dim">
                <span>Continuity</span>
                <b>{uxReport.dimensions.continuity}</b>
              </div>
            </div>
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              {uxReport.summary}
            </p>
            {activeCritique && (activeCritique.versionedPins?.length ?? 0) > 0 && (
              <>
                <ul className="hist-pins" style={{ marginTop: 8 }}>
                  {activeCritique.versionedPins!.map((cp) => {
                    const tok = formatVersionedRef(cp);
                    const isEditingCp = editingCriticPinId === cp.id;
                    const showCpRevs = expandedCriticRevPinId === cp.id;
                    const cpRevs = cp.revisions ?? [];
                    return (
                      <li key={cp.id} className="hist-pin-item">
                        <div className="hist-pin-item__top">
                          <button type="button" className="note__tok" onClick={() => p.onMentionInChat(tok)} title={`Mention ${tok} in Chat`}>
                            {tok}
                          </button>
                          {cp.componentId && <code className="muted">{cp.componentId}</code>}
                          <div className="note__foot-btns" style={{ marginLeft: "auto" }}>
                            <button
                              type="button"
                              className="note__mini"
                              onClick={() => {
                                setEditingCriticPinId(cp.id);
                                setEditCriticPinText(cp.text);
                              }}
                            >
                              <IconEdit width={10} height={10} /> Edit
                            </button>
                            <button
                              type="button"
                              className="note__mini"
                              onClick={() => setExpandedCriticRevPinId(showCpRevs ? null : cp.id)}
                            >
                              <IconHistory width={10} height={10} /> v{Math.max(1, cpRevs.length)}
                            </button>
                          </div>
                        </div>

                        {isEditingCp ? (
                          <div className="note__edit nokeys" style={{ width: "100%", marginTop: 4 }}>
                            <textarea rows={2} value={editCriticPinText} onChange={(e) => setEditCriticPinText(e.target.value)} />
                            <div className="row-btns" style={{ justifyContent: "flex-end", marginTop: 4 }}>
                              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditingCriticPinId(null)}>
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn btn--sm btn--accent"
                                onClick={() => {
                                  if (editCriticPinText.trim()) p.onEditCritiquePin(activeCritique.id, cp.id, editCriticPinText.trim());
                                  setEditingCriticPinId(null);
                                }}
                              >
                                Save v{cpRevs.length + 1}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ width: "100%", color: "var(--text)" }}>{cp.text}</div>
                        )}

                        {showCpRevs && cpRevs.length > 0 && (
                          <div className="rev-list" style={{ width: "100%" }}>
                            {[...cpRevs].reverse().map((rev) => {
                              const rTok = formatVersionedRef(cp, rev.revisionNumber);
                              return (
                                <div key={rev.id} className="rev-row">
                                  <div className="rev-row__head">
                                    <code className="mono">{rTok}</code>
                                    <span className="muted">{rev.author}</span>
                                    <button type="button" className="msg__link" onClick={() => p.onMentionInChat(rTok)}>
                                      +{rTok}
                                    </button>
                                    {rev.revisionNumber < cpRevs.length && (
                                      <button
                                        type="button"
                                        className="msg__link"
                                        onClick={() => p.onRestoreCritiquePinRevision(activeCritique.id, cp.id, rev.id)}
                                      >
                                        <IconUndo width={10} height={10} /> Restore
                                      </button>
                                    )}
                                  </div>
                                  <div className="rev-row__txt">{rev.text}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className="btn btn--block"
                  disabled={p.busy}
                  onClick={() => p.onResolveCritiquePinsWithAi(screen, activeCritique)}
                >
                  <IconSpark width={12} height={12} /> Fix {activeCritique.versionedPins!.length} critic pin{activeCritique.versionedPins!.length === 1 ? "" : "s"} with AI
                </button>
              </>
            )}
          </>
        )}
      </section>

      {versions.list.length > 1 && (
        <section className="block">
          <h3>
            Versions <span className="count">{versions.list.length}</span>
          </h3>
          <div className="chips">
            {versions.list.map((v, i) => {
              const hidden = hiddenSet.has(i);
              if (hidden && versions.active !== i) return null;
              return (
                <span key={v.id} className="ver-pill-wrap">
                  <button className={`vchip${versions.active === i ? " is-on" : ""}`} onClick={() => p.onSetVersion(screen.id, i)}>
                    {versions.finalized === i && <IconCrown width={10} height={10} style={{ marginRight: 3, verticalAlign: -1 }} />}
                    {i === 0 ? "v1 original" : `v${i + 1}`}
                  </button>
                  {versions.list.length > 1 && (
                    <button
                      className="ver-eye"
                      onClick={() => p.onToggleHiddenVersion(screen.id, i)}
                      title={hidden ? "Restore version" : "Hide version"}
                      aria-label={hidden ? "Restore version" : "Hide version"}
                    >
                      {hidden ? <IconEye width={10} height={10} /> : <IconEyeOff width={10} height={10} />}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          {versions.hidden.length > 0 && (
            <div className="muted small" style={{ marginTop: 6 }}>
              {versions.hidden.length} hidden ·{" "}
              <button className="msg__link" onClick={() => p.onCompareVersions(screen.id)}>
                manage in Compare
              </button>
            </div>
          )}
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
            <VoiceMicButton voice={branchVoice} disabled={p.branching} compact />
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
        </form>
      </section>

      <section className="block">
        <div className="ann-head">
          <h3>
            Annotations <span className="count">{displayedNotes.length}</span>
          </h3>
          <div className="seg ann-scope">
            <button className={pinScope === "screen" ? "is-on" : ""} onClick={() => setPinScope("screen")}>
              Screen ({screenNotes.length})
            </button>
            <button className={pinScope === "all" ? "is-on" : ""} onClick={() => setPinScope("all")}>
              All ({allFlowNotes.length})
            </button>
          </div>
        </div>

        {pinScope === "screen" && screenNotes.length > 0 && (
          <div className="ann-batch">
            <span className="muted small">AI feedback:</span>
            <button className="msg__link" onClick={() => p.onSetAllAnnotationsAi(shown.id, true)}>
              All on
            </button>
            <span className="muted">·</span>
            <button className="msg__link" onClick={() => p.onSetAllAnnotationsAi(shown.id, false)}>
              None
            </button>
          </div>
        )}

        {displayedNotes.length === 0 && (
          <p className="muted small">
            Press <span className="kbd">C</span> to pin a component or <span className="kbd">M</span> to paint a region mask.
          </p>
        )}

        <ol className="notes">
          {displayedNotes.map(({ screenId: ownerSid, baseId, nodeId: ownerNid, ann }, i) => {
            const verToken = formatVersionedRef(ann);
            const resolved = ann.status === "resolved";
            const isEditing = editingAnnId === ann.id;
            const showRevs = expandedRevAnnId === ann.id;
            const revs = ann.revisions ?? [];

            return (
              <li key={ann.id} className={`note note--${ann.kind}${resolved ? " is-resolved" : ""}`}>
                <span className={`pin pin--${ann.kind} pin--inline`}>{ann.kind === "mask" ? `M${i + 1}` : i + 1}</span>
                <div className="note__body">
                  <div className="note__top">
                    <button
                      type="button"
                      className="note__tok"
                      onClick={() => p.onMentionInChat(verToken)}
                      title={`Insert ${verToken} into Chat`}
                    >
                      {ann.kind === "mask" ? <IconBrush width={10} height={10} /> : <IconPin width={10} height={10} />}
                      {verToken}
                    </button>
                    {ann.author === "ai-evaluator" && <span className="badge badge--accent">AI</span>}
                    {pinScope === "all" && baseId !== screen.id && ownerNid && (
                      <button type="button" className="msg__link" onClick={() => p.onSelectScreen(baseId, ownerNid)}>
                        {labelOf(ownerNid)}
                      </button>
                    )}
                    <div className="note__acts">
                      <button
                        type="button"
                        className="note__chat-btn"
                        onClick={() => p.onMentionInChat(verToken)}
                        title="Reference in Chat"
                      >
                        +Chat
                      </button>
                      <button
                        type="button"
                        className={`icon-btn icon-btn--sm${resolved ? " is-ok" : ""}`}
                        onClick={() => p.onToggleAnnotationStatus(ownerSid, ann.id)}
                        title={resolved ? "Reopen annotation" : "Mark resolved"}
                        aria-label={resolved ? "Reopen annotation" : "Mark resolved"}
                      >
                        <IconCheck width={12} height={12} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm"
                        aria-label="Delete annotation"
                        onClick={() => p.onDeleteAnnotation(ownerSid, ann.id)}
                      >
                        <IconX width={12} height={12} />
                      </button>
                    </div>
                  </div>

                  <div className="note__meta">
                    {ann.kind}
                    {ann.componentId ? ` · ${ann.componentId}` : ""}
                    {ann.intersectingIds?.length ? ` · ${ann.intersectingIds.length} comps` : ""}
                  </div>

                  {isEditing ? (
                    <div className="note__edit nokeys">
                      <textarea
                        rows={2}
                        value={editAnnText}
                        onChange={(e) => setEditAnnText(e.target.value)}
                      />
                      <div className="row-btns" style={{ justifyContent: "flex-end", marginTop: 4 }}>
                        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditingAnnId(null)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--accent"
                          onClick={() => {
                            if (editAnnText.trim()) p.onEditAnnotation(ownerSid, ann.id, editAnnText.trim());
                            setEditingAnnId(null);
                          }}
                        >
                          Save v{revs.length + 1}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="note__txt">{ann.text}</div>
                  )}

                  <div className="note__foot">
                    <label className="ai-toggle">
                      <input
                        type="checkbox"
                        checked={ann.includeInAiFeedback !== false}
                        onChange={() => p.onToggleAnnotationAi(ownerSid, ann.id)}
                      />
                      <span>{ann.includeInAiFeedback !== false ? "Include in AI" : "Excluded"}</span>
                    </label>
                    <div className="note__foot-btns">
                      <button
                        type="button"
                        className="note__mini"
                        onClick={() => {
                          setEditingAnnId(ann.id);
                          setEditAnnText(ann.text);
                        }}
                      >
                        <IconEdit width={10} height={10} /> Edit
                      </button>
                      <button
                        type="button"
                        className="note__mini"
                        onClick={() => setExpandedRevAnnId(showRevs ? null : ann.id)}
                      >
                        <IconHistory width={10} height={10} /> Revs ({Math.max(1, revs.length)})
                      </button>
                    </div>
                  </div>

                  {showRevs && revs.length > 0 && (
                    <div className="rev-list">
                      {[...revs].reverse().map((rev) => {
                        const rTok = formatVersionedRef(ann, rev.revisionNumber);
                        return (
                          <div key={rev.id} className="rev-row">
                            <div className="rev-row__head">
                              <code className="mono">{rTok}</code>
                              <span className="muted">{rev.author}</span>
                              <button type="button" className="msg__link" onClick={() => p.onMentionInChat(rTok)}>
                                +{rTok}
                              </button>
                              {rev.revisionNumber < revs.length && (
                                <button
                                  type="button"
                                  className="msg__link"
                                  onClick={() => p.onRestoreAnnotationRevision(ownerSid, ann.id, rev.id)}
                                >
                                  <IconUndo width={10} height={10} /> Restore
                                </button>
                              )}
                            </div>
                            <div className="rev-row__txt">{rev.text}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {optedInCount > 0 && (
          <button
            className="btn btn--block btn--accent"
            disabled={p.busy}
            onClick={() => p.onResolveIncludedAnnotations(screen)}
          >
            <IconSpark width={13} height={13} /> Resolve {optedInCount} included pin{optedInCount === 1 ? "" : "s"} with AI
          </button>
        )}
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
