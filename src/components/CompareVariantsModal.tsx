import React from 'react';
import { CheckCircle2, Crown, Eye, EyeOff, X } from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { betaMean } from '../graph/compiler';
import { ScreenIframe } from '../canvas/ScreenIframe';

export const CompareVariantsModal: React.FC = () => {
  const screenId = useStudioStore((s) => s.compareScreenId);
  const project = useStudioStore((s) => s.project);
  const setCompareScreenId = useStudioStore((s) => s.setCompareScreenId);
  const setFinalizedVariant = useStudioStore((s) => s.setFinalizedVariant);
  const toggleVariantHidden = useStudioStore((s) => s.toggleVariantHidden);

  if (!screenId) return null;
  const screen = project.screens[screenId];
  if (!screen) return null;

  const visible = screen.variants.filter((v) => !v.isHidden);
  const hidden = screen.variants.filter((v) => v.isHidden);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6">
      <div className="bg-[#18181d] border border-zinc-700 rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-zinc-100">
              Compare Alternatives — {screen.title} (@{screen.slug})
            </h3>
            <p className="text-xs text-zinc-400">
              Showing {visible.length} visible option(s) · {hidden.length} hidden for cognitive load
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCompareScreenId(null)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          {visible.map((v) => {
            const isFinal = v.id === screen.finalizedVariantId;
            return (
              <div
                key={v.id}
                className={`rounded-2xl border p-3.5 bg-[#131317] flex flex-col gap-3 ${
                  isFinal ? 'border-emerald-400 ring-1 ring-emerald-400/40' : 'border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isFinal && <Crown className="w-4 h-4 text-emerald-400 shrink-0" />}
                    <span className="text-xs font-bold text-zinc-100 truncate">{v.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-mono text-emerald-300">
                      β {Math.round(betaMean(v.banditStats) * 100)}%
                    </span>
                    {!isFinal && (
                      <button
                        type="button"
                        onClick={() => setFinalizedVariant(screen.id, v.id)}
                        className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3" /> Finalize
                      </button>
                    )}
                    {visible.length > 1 && (
                      <button
                        type="button"
                        onClick={() => toggleVariantHidden(screen.id, v.id)}
                        className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                        title="Hide option"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-zinc-400">{v.rationale}</p>

                <div className="rounded-xl overflow-hidden border border-zinc-800 bg-white self-center">
                  {v.html ? (
                    <ScreenIframe
                      screenId={`${screen.id}-cmp-${v.id}`}
                      html={v.html}
                      devicePreset={project.devicePreset}
                      displayWidth={project.devicePreset === 'desktop' ? 490 : 250}
                      displayHeight={project.devicePreset === 'desktop' ? 306 : 420}
                      mode="view"
                    />
                  ) : (
                    <div className="w-[460px] h-[260px] bg-zinc-900 p-5 text-xs text-zinc-300">
                      Skeleton preview — expand to interactive HTML first.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {hidden.length > 0 && (
          <div className="px-5 py-3 border-t border-zinc-800 bg-[#151519] flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-zinc-500">Hidden options:</span>
            {hidden.map((hv) => (
              <button
                key={hv.id}
                type="button"
                onClick={() => toggleVariantHidden(screen.id, hv.id)}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] flex items-center gap-1"
              >
                <Eye className="w-3 h-3 text-emerald-400" /> Restore {hv.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
