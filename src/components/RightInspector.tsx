import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Columns2,
  Crown,
  Edit3,
  Eye,
  EyeOff,
  History,
  Lock,
  MessageSquare,
  Paintbrush,
  Pin,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { FlowEdge, PriorityTier, ScreenAnnotation } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';
import { betaMean, compileWorkflowGraph } from '../graph/compiler';

type InspectorTab = 'options' | 'annotations' | 'eval';

export const RightInspector: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const isBusy = useStudioStore((s) => s.isBusy);

  const setActiveVariant = useStudioStore((s) => s.setActiveVariant);
  const setFinalizedVariant = useStudioStore((s) => s.setFinalizedVariant);
  const toggleVariantHidden = useStudioStore((s) => s.toggleVariantHidden);
  const toggleScreenInFinalFlow = useStudioStore((s) => s.toggleScreenInFinalFlow);
  const setScreenPriority = useStudioStore((s) => s.setScreenPriority);
  const toggleScreenPolicyMode = useStudioStore((s) => s.toggleScreenPolicyMode);
  const exploreNewVariant = useStudioStore((s) => s.exploreNewVariant);
  const setCompareScreenId = useStudioStore((s) => s.setCompareScreenId);
  const deleteScreen = useStudioStore((s) => s.deleteScreen);

  const toggleAnnotationIncludeInAi = useStudioStore((s) => s.toggleAnnotationIncludeInAi);
  const setAllScreenAnnotationsIncludeInAi = useStudioStore(
    (s) => s.setAllScreenAnnotationsIncludeInAi
  );
  const editAnnotation = useStudioStore((s) => s.editAnnotation);
  const toggleAnnotationStatus = useStudioStore((s) => s.toggleAnnotationStatus);
  const restoreAnnotationRevision = useStudioStore((s) => s.restoreAnnotationRevision);
  const deleteAnnotation = useStudioStore((s) => s.deleteAnnotation);
  const sendIncludedFeedbackToAI = useStudioStore((s) => s.sendIncludedFeedbackToAI);
  const runUXEval = useStudioStore((s) => s.runUXEval);
  const selectScreen = useStudioStore((s) => s.selectScreen);

  const updateEdge = useStudioStore((s) => s.updateEdge);
  const deleteEdge = useStudioStore((s) => s.deleteEdge);

  const [tab, setTab] = useState<InspectorTab>('options');
  const [annotationScope, setAnnotationScope] = useState<'screen' | 'all'>('screen');
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [expandedRevId, setExpandedRevId] = useState<string | null>(null);

  const selectedEdge = project.selectedEdgeId ? project.edges[project.selectedEdgeId] : null;
  const selectedScreen = project.selectedScreenId
    ? project.screens[project.selectedScreenId]
    : null;

  // 1) Edge Inspector
  if (selectedEdge) {
    const src = project.screens[selectedEdge.sourceScreenId];
    const dst = project.screens[selectedEdge.targetScreenId];
    return (
      <aside className="w-80 bg-[#18181c] border-l border-[#2b2b33] flex flex-col shrink-0 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
              Transition Edge
            </div>
            <div className="text-sm font-semibold text-zinc-100 mt-0.5">
              @{src?.slug ?? '?'} → @{dst?.slug ?? '?'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => deleteEdge(selectedEdge.id)}
            className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30"
            title="Disconnect screens"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] text-zinc-400 font-medium">Transition Label</label>
          <input
            value={selectedEdge.label}
            onChange={(e) => updateEdge(selectedEdge.id, { label: e.target.value })}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-emerald-400"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] text-zinc-400 font-medium">Edge Type</label>
          <select
            value={selectedEdge.edgeType}
            onChange={(e) =>
              updateEdge(selectedEdge.id, {
                edgeType: e.target.value as FlowEdge['edgeType'],
              })
            }
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100"
          >
            <option value="primary">Primary Forward</option>
            <option value="alternate">Alternate Branch</option>
            <option value="error">Error / Recovery</option>
            <option value="back">Back / Return</option>
          </select>
        </div>

        <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer">
          <div>
            <div className="text-xs font-semibold text-emerald-300">Part of Final Flow</div>
            <div className="text-[10px] text-zinc-400">
              Highlights brightly when any screen is clicked
            </div>
          </div>
          <input
            type="checkbox"
            checked={selectedEdge.isFinalFlowEdge}
            onChange={(e) => updateEdge(selectedEdge.id, { isFinalFlowEdge: e.target.checked })}
            className="accent-emerald-500 w-4 h-4"
          />
        </label>

        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10px] text-zinc-500">Traversals</div>
            <div className="text-sm font-mono font-bold text-zinc-100">
              {selectedEdge.metrics.traversals}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500">Completed</div>
            <div className="text-sm font-mono font-bold text-emerald-400">
              {selectedEdge.metrics.completions}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500">Backtracks</div>
            <div className="text-sm font-mono font-bold text-amber-400">
              {selectedEdge.metrics.backtracks}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // 2) Empty state
  if (!selectedScreen) {
    return (
      <aside className="w-80 bg-[#18181c] border-l border-[#2b2b33] flex flex-col items-center justify-center p-6 text-center shrink-0 space-y-3">
        <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="text-sm font-semibold text-zinc-200">Select a Screen or Edge</div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Click any screen on the canvas to highlight the{' '}
          <span className="text-emerald-400 font-medium">Final Flow</span>, compare proposed
          alternatives, hide noisy options, or manage annotation revisions.
        </p>
      </aside>
    );
  }

  // 3) Screen Inspector
  const finalizedVariant = selectedScreen.variants.find(
    (v) => v.id === selectedScreen.finalizedVariantId
  );
  const visibleAlternatives = selectedScreen.variants.filter(
    (v) => !v.isHidden && v.id !== selectedScreen.finalizedVariantId
  );
  const hiddenVariants = selectedScreen.variants.filter((v) => v.isHidden);
  const activeVariant =
    selectedScreen.variants.find((v) => v.id === selectedScreen.activeVariantId) ??
    selectedScreen.variants[0];

  const allProjectAnnotations: ScreenAnnotation[] = Object.values(project.screens).flatMap(
    (sc) => sc.annotations
  );
  const displayedAnnotations =
    annotationScope === 'screen' ? selectedScreen.annotations : allProjectAnnotations;

  const includedOpenOnScreen = selectedScreen.annotations.filter(
    (a) => a.status === 'open' && a.includeInAiFeedback
  ).length;

  const insight = compileWorkflowGraph(project).insights[selectedScreen.id];

  return (
    <aside className="w-80 bg-[#18181c] border-l border-[#2b2b33] flex flex-col shrink-0 overflow-hidden">
      {/* Screen Identity Header */}
      <div className="p-3 border-b border-[#2b2b33] space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-bold text-zinc-100 truncate">{selectedScreen.title}</h2>
              <span className="text-[10px] font-mono text-zinc-400">@{selectedScreen.slug}</span>
            </div>
            <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5">
              {selectedScreen.description}
            </p>
          </div>
          <button
            type="button"
            onClick={() => deleteScreen(selectedScreen.id)}
            title="Delete screen"
            className="p-1 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-zinc-800"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Priority + Final Flow + Exploit Lock Quick Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <select
            value={selectedScreen.priority}
            onChange={(e) =>
              setScreenPriority(selectedScreen.id, e.target.value as PriorityTier)
            }
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-[10px] font-semibold text-zinc-200"
          >
            <option value="core">★ Core UX Focus</option>
            <option value="standard">Standard Flow</option>
            <option value="supporting">Supporting</option>
          </select>

          <button
            type="button"
            onClick={() => toggleScreenInFinalFlow(selectedScreen.id)}
            className={`px-2 py-1 rounded-lg border text-[10px] font-semibold transition ${
              selectedScreen.isInFinalFlow
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {selectedScreen.isInFinalFlow ? '✓ Final Flow' : '+ Final Flow'}
          </button>

          <button
            type="button"
            onClick={() => toggleScreenPolicyMode(selectedScreen.id)}
            title="Toggle Exploit-Locked (save tokens) vs Explore (generate alternatives)"
            className={`px-2 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 transition ${
              selectedScreen.policyMode === 'exploit-locked'
                ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
                : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {selectedScreen.policyMode === 'exploit-locked' ? (
              <>
                <Lock className="w-2.5 h-2.5" /> Exploit
              </>
            ) : (
              <>
                <Unlock className="w-2.5 h-2.5" /> Explore
              </>
            )}
          </button>
        </div>
      </div>

      {/* Inspector Tabs */}
      <div className="grid grid-cols-3 bg-[#141418] border-b border-[#2b2b33] p-1 gap-1">
        {[
          { id: 'options', label: `Options (${selectedScreen.variants.length})` },
          { id: 'annotations', label: `Pins (${selectedScreen.annotations.length})` },
          { id: 'eval', label: 'UX & Stats' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as InspectorTab)}
            className={`py-1.5 rounded-lg text-[11px] font-medium transition ${
              tab === t.id
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OPTIONS, FINALIZED VERSION & VISIBILITY CONTROLS */}
      {tab === 'options' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Action bar */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => exploreNewVariant(selectedScreen.id)}
              className="flex-1 py-1.5 px-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              {selectedScreen.fidelity === 'skeleton' ? 'Expand Live UI' : 'Explore Alternative'}
            </button>
            {selectedScreen.variants.length > 1 && (
              <button
                type="button"
                onClick={() => setCompareScreenId(selectedScreen.id)}
                className="py-1.5 px-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center gap-1"
                title="Compare visible options side-by-side"
              >
                <Columns2 className="w-3.5 h-3.5" /> Compare
              </button>
            )}
          </div>

          {/* Clearly Finalized Version Card */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
              <Crown className="w-3 h-3" /> Finalized Version
            </div>
            {finalizedVariant ? (
              <div
                onClick={() => setActiveVariant(selectedScreen.id, finalizedVariant.id)}
                className={`p-2.5 rounded-xl border cursor-pointer transition space-y-1.5 ${
                  selectedScreen.activeVariantId === finalizedVariant.id
                    ? 'bg-emerald-500/12 border-emerald-400/70'
                    : 'bg-zinc-900/90 border-emerald-500/35 hover:border-emerald-400/60'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold text-emerald-200 truncate">
                    {finalizedVariant.label}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">
                    FINAL
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  {finalizedVariant.rationale}
                </p>
                <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 border-t border-zinc-800/80">
                  <span className="font-mono text-emerald-300">
                    β {Math.round(betaMean(finalizedVariant.banditStats) * 100)}% (
                    {finalizedVariant.banditStats.impressions} runs)
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVariantHidden(selectedScreen.id, finalizedVariant.id);
                    }}
                    className="text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
                    title="Hide this option on the canvas"
                  >
                    <EyeOff className="w-3 h-3" /> Hide
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl border border-dashed border-zinc-700 text-[11px] text-zinc-400">
                No finalized version yet. Click <strong>Mark Finalized</strong> on any alternative
                below.
              </div>
            )}
          </div>

          {/* Proposed Alternatives */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Proposed Alternatives ({visibleAlternatives.length} visible)
            </div>
            {visibleAlternatives.length === 0 ? (
              <div className="text-[11px] text-zinc-500 italic px-1">
                No other visible alternatives. Click &ldquo;Explore Alternative&rdquo; to generate
                divergent options.
              </div>
            ) : (
              visibleAlternatives.map((v) => {
                const isViewing = selectedScreen.activeVariantId === v.id;
                return (
                  <div
                    key={v.id}
                    onClick={() => setActiveVariant(selectedScreen.id, v.id)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition space-y-1.5 ${
                      isViewing
                        ? 'bg-zinc-800/90 border-zinc-500'
                        : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-zinc-100 truncate">
                        {v.label}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400">
                        β {Math.round(betaMean(v.banditStats) * 100)}%
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-snug">{v.rationale}</p>
                    <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/80">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFinalizedVariant(selectedScreen.id, v.id);
                        }}
                        className="px-2 py-0.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[10px] font-semibold flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3" /> Mark Finalized
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVariantHidden(selectedScreen.id, v.id);
                        }}
                        title="Hide alternative to reduce cognitive load"
                        className="px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] flex items-center gap-1"
                      >
                        <EyeOff className="w-3 h-3" /> Hide
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Hidden Alternatives (Cognitive Load Drawer) */}
          {hiddenVariants.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-zinc-800">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1">
                <EyeOff className="w-3 h-3" /> Hidden for Cognitive Load ({hiddenVariants.length})
              </div>
              {hiddenVariants.map((hv) => (
                <div
                  key={hv.id}
                  className="p-2 rounded-xl bg-zinc-900/40 border border-dashed border-zinc-800 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] text-zinc-400 truncate">{hv.label}</div>
                    <div className="text-[10px] text-zinc-500 truncate">{hv.rationale}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleVariantHidden(selectedScreen.id, hv.id)}
                    className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-emerald-300 text-[10px] font-medium flex items-center gap-1 shrink-0"
                  >
                    <Eye className="w-3 h-3" /> Show
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ANNOTATIONS, REVISIONS & SELECTIVE AI FEEDBACK INCLUSION */}
      {tab === 'annotations' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Scope & Batch Include Controls */}
          <div className="p-2.5 border-b border-zinc-800 flex items-center justify-between gap-2 bg-[#151519]">
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setAnnotationScope('screen')}
                className={`px-2 py-0.5 rounded ${
                  annotationScope === 'screen'
                    ? 'bg-zinc-700 text-white font-medium'
                    : 'text-zinc-400'
                }`}
              >
                This Screen
              </button>
              <button
                type="button"
                onClick={() => setAnnotationScope('all')}
                className={`px-2 py-0.5 rounded ${
                  annotationScope === 'all'
                    ? 'bg-zinc-700 text-white font-medium'
                    : 'text-zinc-400'
                }`}
              >
                All ({allProjectAnnotations.length})
              </button>
            </div>

            {annotationScope === 'screen' && selectedScreen.annotations.length > 0 && (
              <div className="flex items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => setAllScreenAnnotationsIncludeInAi(selectedScreen.id, true)}
                  className="text-emerald-400 hover:underline"
                >
                  All AI
                </button>
                <span className="text-zinc-600">/</span>
                <button
                  type="button"
                  onClick={() => setAllScreenAnnotationsIncludeInAi(selectedScreen.id, false)}
                  className="text-zinc-400 hover:underline"
                >
                  None
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {displayedAnnotations.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-zinc-800 text-center space-y-1.5">
                <MessageSquare className="w-5 h-5 text-zinc-500 mx-auto" />
                <div className="text-xs font-medium text-zinc-300">No annotations yet</div>
                <p className="text-[11px] text-zinc-500">
                  Press <kbd className="px-1 rounded bg-zinc-800 text-zinc-300">C</kbd> to Point-Pin
                  any element or <kbd className="px-1 rounded bg-zinc-800 text-zinc-300">B</kbd> to
                  Paint &amp; Speak a region.
                </p>
              </div>
            ) : (
              displayedAnnotations.map((ann) => {
                const ownerScreen = project.screens[ann.screenId];
                const isEditing = editingAnnId === ann.id;
                const showRevs = expandedRevId === ann.id;
                return (
                  <div
                    key={ann.id}
                    className={`p-2.5 rounded-xl border space-y-2 transition ${
                      ann.status === 'resolved'
                        ? 'bg-zinc-900/40 border-zinc-800 opacity-75'
                        : ann.includeInAiFeedback
                        ? 'bg-zinc-900 border-zinc-700'
                        : 'bg-zinc-900/50 border-dashed border-zinc-800'
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {ann.kind === 'paint-region' ? (
                          <Paintbrush className="w-3 h-3 text-pink-400 shrink-0" />
                        ) : (
                          <Pin className="w-3 h-3 text-blue-400 shrink-0" />
                        )}
                        <span className="text-[11px] font-mono font-semibold text-zinc-100">
                          @{ann.mentionTag}
                        </span>
                        {annotationScope === 'all' && ownerScreen && (
                          <button
                            type="button"
                            onClick={() => selectScreen(ownerScreen.id)}
                            className="text-[10px] font-mono text-violet-300 hover:underline"
                          >
                            @{ownerScreen.slug}
                          </button>
                        )}
                        <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-400">
                          v{ann.revisions.length}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleAnnotationStatus(ann.screenId, ann.id)}
                          title={ann.status === 'open' ? 'Mark resolved' : 'Reopen'}
                          className={`p-1 rounded ${
                            ann.status === 'resolved'
                              ? 'text-emerald-400 bg-emerald-500/15'
                              : 'text-zinc-500 hover:text-emerald-300'
                          }`}
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAnnotation(ann.screenId, ann.id)}
                          className="p-1 rounded text-zinc-500 hover:text-rose-400"
                          title="Delete annotation"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Target element / region badge */}
                    {ann.elementTarget && (
                      <div className="text-[10px] font-mono text-blue-300/80 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5 truncate">
                        &lt;{ann.elementTarget.tagName}&gt; {ann.elementTarget.textSnippet || ann.elementTarget.selector}
                      </div>
                    )}

                    {/* Body / Edit Mode */}
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <textarea
                          rows={2}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          className="w-full bg-zinc-950 border border-blue-500/60 rounded-lg p-2 text-xs text-zinc-100 focus:outline-none"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingAnnId(null)}
                            className="px-2 py-0.5 text-[10px] text-zinc-400"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (editDraft.trim()) {
                                editAnnotation(ann.screenId, ann.id, editDraft.trim());
                              }
                              setEditingAnnId(null);
                            }}
                            className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-semibold"
                          >
                            Save Rev v{ann.revisions.length + 1}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-200 leading-snug">{ann.comment}</p>
                    )}

                    {/* Opt-in AI Toggle + Edit + Revisions Footer */}
                    <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/80 gap-1">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={ann.includeInAiFeedback}
                          onChange={() => toggleAnnotationIncludeInAi(ann.screenId, ann.id)}
                          className="accent-emerald-500 rounded"
                        />
                        <span
                          className={`text-[10px] font-medium ${
                            ann.includeInAiFeedback ? 'text-emerald-300' : 'text-zinc-500'
                          }`}
                        >
                          {ann.includeInAiFeedback ? 'Include in AI' : 'Excluded from AI'}
                        </span>
                      </label>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAnnId(ann.id);
                            setEditDraft(ann.comment);
                          }}
                          className="text-[10px] text-zinc-400 hover:text-zinc-100 flex items-center gap-0.5"
                          title="Edit annotation (saves a new revision)"
                        >
                          <Edit3 className="w-2.5 h-2.5" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedRevId(showRevs ? null : ann.id)}
                          className="text-[10px] text-zinc-400 hover:text-zinc-100 flex items-center gap-0.5"
                        >
                          <History className="w-2.5 h-2.5" /> Revs ({ann.revisions.length})
                        </button>
                      </div>
                    </div>

                    {/* Saved Revisions Timeline */}
                    {showRevs && (
                      <div className="pt-2 border-t border-zinc-800 space-y-1.5">
                        <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">
                          Saved Revision History
                        </div>
                        {[...ann.revisions].reverse().map((rev) => (
                          <div
                            key={rev.id}
                            className="p-2 rounded-lg bg-zinc-950/90 border border-zinc-800/90 space-y-1"
                          >
                            <div className="flex items-center justify-between text-[9px] text-zinc-500">
                              <span className="font-mono text-zinc-300 font-semibold">
                                v{rev.revisionNumber} · {rev.author} ({rev.status})
                              </span>
                              {rev.revisionNumber < ann.revisions.length && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    restoreAnnotationRevision(ann.screenId, ann.id, rev.id)
                                  }
                                  className="text-blue-400 hover:underline flex items-center gap-0.5"
                                >
                                  <RotateCcw className="w-2.5 h-2.5" /> Restore
                                </button>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-300 leading-snug">
                              {rev.comment}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Send Included Feedback to AI Footer CTA */}
          <div className="p-3 border-t border-[#2b2b33] bg-[#151519]">
            <button
              type="button"
              disabled={isBusy || includedOpenOnScreen === 0}
              onClick={() => sendIncludedFeedbackToAI(selectedScreen.id)}
              className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow transition"
            >
              <Send className="w-3.5 h-3.5" />
              Send Included to AI ({includedOpenOnScreen} opted-in)
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: UX EVALUATION & THOMPSON BANDIT TELEMETRY */}
      {tab === 'eval' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => runUXEval(selectedScreen.id)}
            className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" /> Run UX Eval on @{selectedScreen.slug}
          </button>

          {selectedScreen.evaluation ? (
            <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">Multimodal UX Score</span>
                <span className="text-lg font-mono font-bold text-emerald-400">
                  {selectedScreen.evaluation.overallScore}/100
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                {selectedScreen.evaluation.summary}
              </p>
              <div className="space-y-2">
                {(
                  [
                    ['Usability', selectedScreen.evaluation.dimensions.usability],
                    ['Visual Hierarchy', selectedScreen.evaluation.dimensions.visualHierarchy],
                    ['Accessibility', selectedScreen.evaluation.dimensions.accessibility],
                    ['Flow Continuity', selectedScreen.evaluation.dimensions.flowContinuity],
                  ] as const
                ).map(([label, score]) => (
                  <div key={label} className="space-y-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-zinc-400">{label}</span>
                      <span className="font-mono text-zinc-200">{score}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          score >= 82
                            ? 'bg-emerald-400'
                            : score >= 74
                            ? 'bg-amber-400'
                            : 'bg-rose-400'
                        }`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl border border-dashed border-zinc-800 text-xs text-zinc-400 text-center">
              No UX evaluation yet for this screen.
            </div>
          )}

          {/* Thompson Sampling & Traversal Evidence */}
          {activeVariant && (
            <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">
                  Empirical Bandit Evidence
                </span>
                <span className="text-[10px] font-mono text-violet-300">
                  Beta({activeVariant.banditStats.alpha}, {activeVariant.banditStats.beta})
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-zinc-950 p-2">
                  <div className="text-zinc-500 text-[10px]">Impressions</div>
                  <div className="font-mono font-bold text-zinc-100">
                    {activeVariant.banditStats.impressions}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-950 p-2">
                  <div className="text-zinc-500 text-[10px]">Completions</div>
                  <div className="font-mono font-bold text-emerald-400">
                    {activeVariant.banditStats.completions}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-950 p-2">
                  <div className="text-zinc-500 text-[10px]">Hesitations</div>
                  <div className="font-mono font-bold text-amber-400">
                    {activeVariant.banditStats.hesitations}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-950 p-2">
                  <div className="text-zinc-500 text-[10px]">Backtracks</div>
                  <div className="font-mono font-bold text-rose-400">
                    {activeVariant.banditStats.backtracks}
                  </div>
                </div>
              </div>
              {insight && (
                <div className="text-[10px] text-zinc-400 bg-zinc-950 rounded-lg p-2 border border-zinc-800">
                  <span className="font-semibold text-zinc-200">Policy Signal:</span>{' '}
                  {insight.reason}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
