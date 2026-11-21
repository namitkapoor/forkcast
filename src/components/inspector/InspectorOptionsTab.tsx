import React from 'react';
import { CheckCircle2, Columns2, Crown, Eye, EyeOff, Plus } from 'lucide-react';
import type { ScreenNode } from '../../types/studio';
import { betaMean } from '../../graph/compiler';

interface InspectorOptionsTabProps {
  screen: ScreenNode;
  isBusy: boolean;
  onExploreAlternative: () => void;
  onCompare: () => void;
  onSelectVariant: (variantId: string) => void;
  onFinalizeVariant: (variantId: string) => void;
  onToggleVariantHidden: (variantId: string) => void;
}

export const InspectorOptionsTab: React.FC<InspectorOptionsTabProps> = ({
  screen,
  isBusy,
  onExploreAlternative,
  onCompare,
  onSelectVariant,
  onFinalizeVariant,
  onToggleVariantHidden,
}) => {
  const finalizedVariant = screen.variants.find((v) => v.id === screen.finalizedVariantId);
  const visibleAlternatives = screen.variants.filter(
    (v) => !v.isHidden && v.id !== screen.finalizedVariantId
  );
  const hiddenVariants = screen.variants.filter((v) => v.isHidden);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={isBusy}
          onClick={onExploreAlternative}
          className="flex-1 py-1.5 px-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          {screen.fidelity === 'skeleton' ? 'Expand Live UI' : 'Explore Alternative'}
        </button>
        {screen.variants.length > 1 && (
          <button
            type="button"
            onClick={onCompare}
            className="py-1.5 px-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center gap-1 shrink-0"
          >
            <Columns2 className="w-3.5 h-3.5" /> Compare
          </button>
        )}
      </div>

      {/* Clearly Finalized Version */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
          <Crown className="w-3 h-3" /> Finalized Version
        </div>
        {finalizedVariant ? (
          <div
            onClick={() => onSelectVariant(finalizedVariant.id)}
            className={`p-2.5 rounded-xl border cursor-pointer transition space-y-1.5 ${
              screen.activeVariantId === finalizedVariant.id
                ? 'bg-emerald-500/12 border-emerald-400/70'
                : 'bg-zinc-900/90 border-emerald-500/35 hover:border-emerald-400/60'
            }`}
          >
            <div className="flex items-center justify-between gap-1 min-w-0">
              <span className="text-xs font-semibold text-emerald-200 truncate">
                {finalizedVariant.label}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold shrink-0">
                FINAL
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-snug break-words">
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
                  onToggleVariantHidden(finalizedVariant.id);
                }}
                className="text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
              >
                <EyeOff className="w-3 h-3" /> Hide
              </button>
            </div>
          </div>
        ) : (
          <div className="p-2.5 rounded-xl border border-dashed border-zinc-700 text-[11px] text-zinc-400">
            No finalized version yet. Click <strong>Mark Finalized</strong> on any alternative.
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
            No other visible alternatives. Click &ldquo;Explore Alternative&rdquo; to generate more.
          </div>
        ) : (
          visibleAlternatives.map((v) => {
            const isViewing = screen.activeVariantId === v.id;
            return (
              <div
                key={v.id}
                onClick={() => onSelectVariant(v.id)}
                className={`p-2.5 rounded-xl border cursor-pointer transition space-y-1.5 ${
                  isViewing
                    ? 'bg-zinc-800/90 border-zinc-500'
                    : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between gap-1 min-w-0">
                  <span className="text-xs font-semibold text-zinc-100 truncate">{v.label}</span>
                  <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                    β {Math.round(betaMean(v.banditStats) * 100)}%
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug break-words">{v.rationale}</p>
                <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/80">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFinalizeVariant(v.id);
                    }}
                    className="px-2 py-0.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[10px] font-semibold flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Mark Finalized
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVariantHidden(v.id);
                    }}
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

      {/* Hidden Alternatives */}
      {hiddenVariants.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-zinc-800">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1">
            <EyeOff className="w-3 h-3" /> Hidden for Cognitive Load ({hiddenVariants.length})
          </div>
          {hiddenVariants.map((hv) => (
            <div
              key={hv.id}
              className="p-2 rounded-xl bg-zinc-900/40 border border-dashed border-zinc-800 flex items-center justify-between gap-2 min-w-0"
            >
              <div className="min-w-0">
                <div className="text-[11px] text-zinc-400 truncate">{hv.label}</div>
                <div className="text-[10px] text-zinc-500 truncate">{hv.rationale}</div>
              </div>
              <button
                type="button"
                onClick={() => onToggleVariantHidden(hv.id)}
                className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-emerald-300 text-[10px] font-medium flex items-center gap-1 shrink-0"
              >
                <Eye className="w-3 h-3" /> Show
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
