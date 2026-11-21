import React, { useState } from 'react';
import { Lock, Sparkles, Trash2, Unlock } from 'lucide-react';
import type { PriorityTier } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';
import { compileWorkflowGraph } from '../graph/compiler';
import { EdgeInspector } from './inspector/EdgeInspector';
import { InspectorOptionsTab } from './inspector/InspectorOptionsTab';
import { InspectorPinsTab } from './inspector/InspectorPinsTab';
import { InspectorEvalTab } from './inspector/InspectorEvalTab';

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
  const appendToChatDraft = useStudioStore((s) => s.appendToChatDraft);
  const runUXEval = useStudioStore((s) => s.runUXEval);
  const selectScreen = useStudioStore((s) => s.selectScreen);

  const updateEdge = useStudioStore((s) => s.updateEdge);
  const deleteEdge = useStudioStore((s) => s.deleteEdge);

  const [tab, setTab] = useState<InspectorTab>('options');

  const selectedEdge = project.selectedEdgeId ? project.edges[project.selectedEdgeId] : null;
  const selectedScreen = project.selectedScreenId
    ? project.screens[project.selectedScreenId]
    : null;

  if (selectedEdge) {
    return (
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#18181c]">
        <EdgeInspector
          edge={selectedEdge}
          project={project}
          onUpdate={(patch) => updateEdge(selectedEdge.id, patch)}
          onDelete={() => deleteEdge(selectedEdge.id)}
        />
      </div>
    );
  }

  if (!selectedScreen) {
    return (
      <div className="flex-1 min-h-0 min-w-0 flex flex-col items-center justify-center p-6 text-center bg-[#18181c] space-y-3">
        <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="text-sm font-semibold text-zinc-200">Select a Screen or Edge</div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Click any screen on the canvas to highlight the{' '}
          <span className="text-emerald-400 font-medium">Final Flow</span>, compare proposed
          alternatives, hide noisy options, or inspect versioned pins.
        </p>
      </div>
    );
  }

  const activeVariant =
    selectedScreen.variants.find((v) => v.id === selectedScreen.activeVariantId) ??
    selectedScreen.variants[0];
  const insight = compileWorkflowGraph(project).insights[selectedScreen.id];

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#18181c]">
      {/* Screen Identity Header */}
      <div className="p-3 border-b border-[#2b2b33] space-y-2 shrink-0 min-w-0">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className="text-sm font-bold text-zinc-100 truncate">{selectedScreen.title}</h2>
              <button
                type="button"
                onClick={() => appendToChatDraft(`@${selectedScreen.slug}`)}
                className="text-[10px] font-mono text-zinc-400 hover:text-emerald-300 shrink-0"
                title="Insert @Screen into AI Chat"
              >
                @{selectedScreen.slug}
              </button>
            </div>
            <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5 break-words">
              {selectedScreen.description}
            </p>
          </div>
          <button
            type="button"
            onClick={() => deleteScreen(selectedScreen.id)}
            title="Delete screen"
            className="p-1 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <select
            value={selectedScreen.priority}
            onChange={(e) => setScreenPriority(selectedScreen.id, e.target.value as PriorityTier)}
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

      {/* Sub-Tabs */}
      <div className="grid grid-cols-3 bg-[#141418] border-b border-[#2b2b33] p-1 gap-1 shrink-0">
        {[
          { id: 'options', label: `Options (${selectedScreen.variants.length})` },
          { id: 'annotations', label: `Pins (${selectedScreen.annotations.length})` },
          { id: 'eval', label: 'UX & Stats' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as InspectorTab)}
            className={`py-1.5 rounded-lg text-[11px] font-medium transition truncate ${
              tab === t.id
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'options' && (
        <InspectorOptionsTab
          screen={selectedScreen}
          isBusy={isBusy}
          onExploreAlternative={() => exploreNewVariant(selectedScreen.id)}
          onCompare={() => setCompareScreenId(selectedScreen.id)}
          onSelectVariant={(vid) => setActiveVariant(selectedScreen.id, vid)}
          onFinalizeVariant={(vid) => setFinalizedVariant(selectedScreen.id, vid)}
          onToggleVariantHidden={(vid) => toggleVariantHidden(selectedScreen.id, vid)}
        />
      )}

      {tab === 'annotations' && (
        <InspectorPinsTab
          screen={selectedScreen}
          project={project}
          isBusy={isBusy}
          onSelectScreen={(sid) => selectScreen(sid)}
          onMentionInChat={(tok) => appendToChatDraft(tok)}
          onToggleIncludeInAi={(sid, aid) => toggleAnnotationIncludeInAi(sid, aid)}
          onSetAllIncludeInAi={(sid, inc) => setAllScreenAnnotationsIncludeInAi(sid, inc)}
          onEditAnnotation={(sid, aid, c) => editAnnotation(sid, aid, c)}
          onToggleStatus={(sid, aid) => toggleAnnotationStatus(sid, aid)}
          onRestoreRevision={(sid, aid, rid) => restoreAnnotationRevision(sid, aid, rid)}
          onDeleteAnnotation={(sid, aid) => deleteAnnotation(sid, aid)}
          onSendIncludedToAI={() => sendIncludedFeedbackToAI(selectedScreen.id)}
        />
      )}

      {tab === 'eval' && (
        <InspectorEvalTab
          screen={selectedScreen}
          activeVariant={activeVariant}
          insight={insight}
          isBusy={isBusy}
          onRunEval={() => runUXEval(selectedScreen.id)}
        />
      )}
    </div>
  );
};
