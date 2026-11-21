import React from 'react';
import { Sparkles } from 'lucide-react';
import type { DesignVariant, ScreenNode } from '../../types/studio';
import type { CompiledScreenInsight } from '../../graph/compiler';

interface InspectorEvalTabProps {
  screen: ScreenNode;
  activeVariant: DesignVariant | undefined;
  insight: CompiledScreenInsight | undefined;
  isBusy: boolean;
  onRunEval: () => void;
}

export const InspectorEvalTab: React.FC<InspectorEvalTabProps> = ({
  screen,
  activeVariant,
  insight,
  isBusy,
  onRunEval,
}) => {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      <button
        type="button"
        disabled={isBusy}
        onClick={onRunEval}
        className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
      >
        <Sparkles className="w-3.5 h-3.5" /> Run UX Eval on @{screen.slug}
      </button>

      {screen.evaluation ? (
        <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">Multimodal UX Score</span>
            <span className="text-lg font-mono font-bold text-emerald-400">
              {screen.evaluation.overallScore}/100
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed break-words">
            {screen.evaluation.summary}
          </p>
          <div className="space-y-2">
            {(
              [
                ['Usability', screen.evaluation.dimensions.usability],
                ['Visual Hierarchy', screen.evaluation.dimensions.visualHierarchy],
                ['Accessibility', screen.evaluation.dimensions.accessibility],
                ['Flow Continuity', screen.evaluation.dimensions.flowContinuity],
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

      {activeVariant && (
        <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">Empirical Bandit Evidence</span>
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
            <div className="text-[10px] text-zinc-400 bg-zinc-950 rounded-lg p-2 border border-zinc-800 break-words">
              <span className="font-semibold text-zinc-200">Policy Signal:</span> {insight.reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
