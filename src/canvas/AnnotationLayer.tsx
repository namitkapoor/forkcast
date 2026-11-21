import React, { useState } from 'react';
import { Check, EyeOff, Paintbrush, Pin, Sparkles } from 'lucide-react';
import type { ScreenAnnotation } from '../types/studio';
import { formatVersionedRef } from '../domain/annotations';

interface AnnotationLayerProps {
  annotations: ScreenAnnotation[];
  activeVariantId: string | null;
  onToggleIncludeInAi: (annotationId: string) => void;
  onSelectScreen: () => void;
  onMentionInChat?: (versionedToken: string) => void;
}

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  annotations,
  activeVariantId,
  onToggleIncludeInAi,
  onSelectScreen,
  onMentionInChat,
}) => {
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = annotations.filter(
    (a) => !activeVariantId || a.variantId === activeVariantId || a.status === 'open'
  );

  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {visible.map((ann) => {
        const isResolved = ann.status === 'resolved';
        const isIncluded = ann.includeInAiFeedback;
        const isAi = ann.author === 'ai-evaluator';
        const isOpen = openId === ann.id;
        const versionedToken = formatVersionedRef(ann);

        return (
          <React.Fragment key={ann.id}>
            {/* Paint region bounding box overlay */}
            {ann.kind === 'paint-region' && ann.paintTarget && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectScreen();
                  setOpenId(isOpen ? null : ann.id);
                }}
                style={{
                  left: `${ann.paintTarget.boundingBoxPercent.x}%`,
                  top: `${ann.paintTarget.boundingBoxPercent.y}%`,
                  width: `${ann.paintTarget.boundingBoxPercent.w}%`,
                  height: `${ann.paintTarget.boundingBoxPercent.h}%`,
                }}
                className={`pointer-events-auto absolute rounded-lg border-2 transition cursor-pointer ${
                  isResolved
                    ? 'border-emerald-400/60 bg-emerald-500/10'
                    : isIncluded
                    ? 'border-pink-500 bg-pink-500/15 shadow-[0_0_12px_rgba(236,72,153,0.3)]'
                    : 'border-dashed border-zinc-400/80 bg-zinc-900/20'
                }`}
              >
                <span
                  className={`absolute -top-2.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold flex items-center gap-1 shadow whitespace-nowrap ${
                    isResolved
                      ? 'bg-emerald-600 text-white'
                      : isIncluded
                      ? 'bg-pink-600 text-white'
                      : 'bg-zinc-800 text-zinc-300 border border-zinc-600'
                  }`}
                >
                  <Paintbrush className="w-2.5 h-2.5" />
                  {versionedToken}
                  {!isIncluded && !isResolved && ' · AI off'}
                </span>
              </div>
            )}

            {/* Point pin marker */}
            {ann.kind === 'point-element' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectScreen();
                  setOpenId(isOpen ? null : ann.id);
                }}
                style={{
                  left: `${ann.xPercent}%`,
                  top: `${ann.yPercent}%`,
                }}
                title={`${versionedToken}: ${ann.comment}`}
                className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center shadow-lg border-2 transition hover:scale-115 ${
                  isResolved
                    ? 'bg-emerald-600 border-emerald-200 text-white'
                    : !isIncluded
                    ? 'bg-zinc-800 border-zinc-400 border-dashed text-zinc-300'
                    : isAi
                    ? 'bg-amber-500 border-amber-100 text-zinc-950'
                    : 'bg-blue-600 border-blue-200 text-white'
                }`}
              >
                {isResolved ? (
                  <Check className="w-3 h-3" />
                ) : isAi ? (
                  <Sparkles className="w-3 h-3" />
                ) : (
                  <Pin className="w-3 h-3" />
                )}
              </button>
            )}

            {/* Compact inline Figma comment popover (clamped safely inside viewport) */}
            {isOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  left: `${Math.min(44, Math.max(3, ann.xPercent))}%`,
                  top: `${Math.min(48, Math.max(6, ann.yPercent + 5))}%`,
                }}
                className="pointer-events-auto nodrag nopan absolute z-40 w-52 max-h-36 overflow-y-auto rounded-xl bg-[#18181d] border border-zinc-700 p-2.5 shadow-2xl text-left space-y-1.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-mono font-semibold text-blue-300">
                    {versionedToken}
                  </span>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                    {ann.category}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-200 leading-snug break-words">{ann.comment}</p>
                <div className="flex items-center justify-between pt-1 border-t border-zinc-800 gap-1">
                  <button
                    type="button"
                    onClick={() => onToggleIncludeInAi(ann.id)}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center gap-1 transition ${
                      isIncluded
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}
                  >
                    {!isIncluded && <EyeOff className="w-2.5 h-2.5" />}
                    {isIncluded ? 'AI on' : 'AI off'}
                  </button>
                  <div className="flex items-center gap-1.5">
                    {onMentionInChat && (
                      <button
                        type="button"
                        onClick={() => {
                          onMentionInChat(versionedToken);
                          setOpenId(null);
                        }}
                        className="text-[10px] font-mono text-blue-300 hover:text-blue-200"
                      >
                        +Chat
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenId(null)}
                      className="text-[10px] text-zinc-400 hover:text-zinc-200"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
