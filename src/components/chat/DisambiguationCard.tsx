import React from 'react';
import { Check, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { DisambiguationControl, DisambiguationRequest } from '../../types/studio';
import { formatTokens } from '../../ai/budgetPolicy';

interface DisambiguationCardProps {
  request: DisambiguationRequest;
  onUpdateControl: (
    controlId: string,
    updater: (c: DisambiguationControl) => DisambiguationControl
  ) => void;
  onConfirm: () => void;
  onDismiss: () => void;
}

export const DisambiguationCard: React.FC<DisambiguationCardProps> = ({
  request,
  onUpdateControl,
  onConfirm,
  onDismiss,
}) => {
  return (
    <div className="rounded-2xl bg-[#1b1b24] border border-violet-500/50 p-3.5 space-y-3 shadow-lg min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-semibold flex items-center gap-1">
            <SlidersHorizontal className="w-3 h-3" /> Disambiguate First
          </span>
          <span className="text-[10px] font-mono text-emerald-300">
            Saves ~{formatTokens(request.estimatedTokenSavings)}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-zinc-500 hover:text-zinc-200 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2.5">
        {request.controls.map((ctrl) => {
          if (ctrl.kind === 'choice-cards') {
            return (
              <div key={ctrl.id} className="space-y-1">
                <div className="text-[10px] font-semibold text-zinc-300">{ctrl.label}</div>
                <div className="space-y-1">
                  {ctrl.options.map((opt) => {
                    const selected = ctrl.selectedIds.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          onUpdateControl(ctrl.id, (c) =>
                            c.kind === 'choice-cards' ? { ...c, selectedIds: [opt.id] } : c
                          )
                        }
                        className={`w-full text-left p-2 rounded-xl border transition ${
                          selected
                            ? 'bg-violet-500/20 border-violet-400 text-zinc-100'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-semibold">
                          <span>{opt.title}</span>
                          {selected && <Check className="w-3 h-3 text-violet-300 shrink-0" />}
                        </div>
                        <div className="text-[10px] text-zinc-400">{opt.subtitle}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }

          if (ctrl.kind === 'visual-preview') {
            return (
              <div key={ctrl.id} className="space-y-1">
                <div className="text-[10px] font-semibold text-zinc-300">{ctrl.label}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {ctrl.options.map((opt) => {
                    const selected = ctrl.selectedId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          onUpdateControl(ctrl.id, (c) =>
                            c.kind === 'visual-preview' ? { ...c, selectedId: opt.id } : c
                          )
                        }
                        className={`text-left p-2 rounded-xl border transition space-y-1 min-w-0 ${
                          selected
                            ? 'bg-emerald-500/15 border-emerald-400 text-zinc-100'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          {opt.palette.map((hex, i) => (
                            <span
                              key={i}
                              style={{ backgroundColor: hex }}
                              className="w-3 h-3 rounded-full border border-white/20 shrink-0"
                            />
                          ))}
                        </div>
                        <div className="text-[10px] font-semibold truncate">{opt.title}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }

          if (ctrl.kind === 'slider') {
            return (
              <div key={ctrl.id} className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="font-semibold text-zinc-300">{ctrl.label}</span>
                  <span className="font-mono text-violet-300">
                    {ctrl.value}
                    {ctrl.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step}
                  value={ctrl.value}
                  onChange={(e) =>
                    onUpdateControl(ctrl.id, (c) =>
                      c.kind === 'slider' ? { ...c, value: Number(e.target.value) } : c
                    )
                  }
                  className="w-full accent-violet-500"
                />
              </div>
            );
          }

          if (ctrl.kind === 'chips') {
            return (
              <div key={ctrl.id} className="space-y-1">
                <div className="text-[10px] font-semibold text-zinc-300">{ctrl.label}</div>
                <div className="flex gap-1 flex-wrap">
                  {ctrl.options.map((opt) => {
                    const active = ctrl.selected.includes(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          onUpdateControl(ctrl.id, (c) => {
                            if (c.kind !== 'chips') return c;
                            return {
                              ...c,
                              selected: active
                                ? c.selected.filter((x) => x !== opt)
                                : [...c.selected, opt],
                            };
                          })
                        }
                        className={`px-2 py-0.5 rounded-full text-[10px] border ${
                          active
                            ? 'bg-violet-500/20 border-violet-400 text-violet-200'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>

      <button
        type="button"
        onClick={onConfirm}
        className="w-full py-2 rounded-xl bg-gradient-to-r from-violet-600 to-emerald-600 hover:from-violet-500 hover:to-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow"
      >
        <Sparkles className="w-3.5 h-3.5" /> Generate Progressive Flow
      </button>
    </div>
  );
};
