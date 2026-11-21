import React, { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  CheckCircle2,
  Crown,
  Eye,
  EyeOff,
  Lock,
  Mic,
  MicOff,
  Pin,
  Plus,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type { AnnotationCategory, ScreenNode } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';
import { betaMean, compileWorkflowGraph } from '../graph/compiler';
import { formatTokens } from '../ai/budgetPolicy';
import { ScreenIframe, type PointPickPayload } from './ScreenIframe';
import { AnnotationLayer } from './AnnotationLayer';
import { PaintOverlay } from './PaintOverlay';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface ScreenNodeData extends Record<string, unknown> {
  screen: ScreenNode;
}

export const ScreenNodeCard: React.FC<NodeProps> = ({ data }) => {
  const { screen } = data as ScreenNodeData;

  const project = useStudioStore((s) => s.project);
  const activeTool = useStudioStore((s) => s.activeTool);
  const selectScreen = useStudioStore((s) => s.selectScreen);
  const setActiveVariant = useStudioStore((s) => s.setActiveVariant);
  const toggleVariantHidden = useStudioStore((s) => s.toggleVariantHidden);
  const addAnnotation = useStudioStore((s) => s.addAnnotation);
  const toggleAnnotationIncludeInAi = useStudioStore((s) => s.toggleAnnotationIncludeInAi);
  const sendIncludedFeedbackToAI = useStudioStore((s) => s.sendIncludedFeedbackToAI);
  const exploreNewVariant = useStudioStore((s) => s.exploreNewVariant);
  const setActiveTool = useStudioStore((s) => s.setActiveTool);

  const [pendingPoint, setPendingPoint] = useState<PointPickPayload | null>(null);
  const [pinComment, setPinComment] = useState('');
  const [pinCategory, setPinCategory] = useState<AnnotationCategory>('usability');
  const [pinIncludeAi, setPinIncludeAi] = useState(true);
  const [showHiddenDrawer, setShowHiddenDrawer] = useState(false);

  const { isListening, isSupported, toggleListening } = useVoiceInput((text) => {
    setPinComment(text);
  });

  const isSelected = project.selectedScreenId === screen.id;
  const anyScreenSelected = project.selectedScreenId !== null;
  const isFinalHighlighted = anyScreenSelected && screen.isInFinalFlow;
  const isDimmedNonFinal = anyScreenSelected && !screen.isInFinalFlow && !isSelected;

  const visibleVariants = screen.variants.filter((v) => !v.isHidden);
  const hiddenVariants = screen.variants.filter((v) => v.isHidden);
  const activeVariant =
    screen.variants.find((v) => v.id === screen.activeVariantId) ??
    visibleVariants[0] ??
    screen.variants[0];
  const isViewingFinalized =
    Boolean(screen.finalizedVariantId) && activeVariant?.id === screen.finalizedVariantId;

  const isDesktop = project.devicePreset === 'desktop';
  const viewportW = isDesktop ? 404 : 264;
  const viewportH = isDesktop ? 252 : 340;

  const winRate = activeVariant ? Math.round(betaMean(activeVariant.banditStats) * 100) : 50;
  const openAnnotations = screen.annotations.filter((a) => a.status === 'open');
  const includedCount = openAnnotations.filter((a) => a.includeInAiFeedback).length;
  const screenTokens = screen.variants.reduce((acc, v) => acc + v.tokensUsed, 0);

  const compiled =
    project.canvasView === 'compiled' ? compileWorkflowGraph(project).insights[screen.id] : null;

  const priorityColors: Record<ScreenNode['priority'], string> = {
    core: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
    standard: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
    supporting: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  };

  const handleSavePointPin = async (sendNow: boolean) => {
    if (!pendingPoint || !pinComment.trim() || !activeVariant) return;
    addAnnotation(screen.id, {
      screenId: screen.id,
      variantId: activeVariant.id,
      author: 'designer',
      kind: 'point-element',
      includeInAiFeedback: pinIncludeAi,
      xPercent: pendingPoint.xPercent,
      yPercent: pendingPoint.yPercent,
      elementTarget: {
        selector: pendingPoint.selector,
        tagName: pendingPoint.tagName,
        textSnippet: pendingPoint.textSnippet,
        boundingBox: pendingPoint.boundingBox,
      },
      category: pinCategory,
      severity: 'warning',
      comment: pinComment.trim(),
    });
    const text = pinComment.trim();
    setPendingPoint(null);
    setPinComment('');
    if (sendNow && pinIncludeAi) {
      await sendIncludedFeedbackToAI(screen.id, `Apply pinned feedback on @${screen.slug}: ${text}`);
    }
  };

  // Border & glow hierarchy:
  // 1) Final Flow Highlight when any screen is clicked -> vivid Emerald border + glow
  // 2) Selected screen -> crisp bright ring
  // 3) Compiled bottleneck -> amber pulse ring
  const frameBorderClass = isSelected
    ? screen.isInFinalFlow
      ? 'border-emerald-400 ring-2 ring-emerald-400/50 shadow-[0_0_32px_rgba(16,185,129,0.38)]'
      : 'border-blue-400 ring-2 ring-blue-500/40 shadow-[0_0_24px_rgba(59,130,246,0.3)]'
    : isFinalHighlighted
    ? 'border-emerald-400/90 ring-1 ring-emerald-400/35 shadow-[0_0_24px_rgba(16,185,129,0.28)]'
    : compiled?.isBottleneck
    ? 'border-amber-400/80 ring-1 ring-amber-400/30 shadow-[0_0_22px_rgba(245,158,11,0.25)]'
    : screen.priority === 'core'
    ? 'border-violet-500/50 hover:border-violet-400'
    : 'border-zinc-700/90 hover:border-zinc-500';

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        selectScreen(screen.id);
      }}
      style={{ width: viewportW + 16 }}
      className={`rounded-2xl bg-[#1b1b20] border-2 transition-all duration-200 select-none ${frameBorderClass} ${
        isDimmedNonFinal ? 'opacity-40 hover:opacity-85' : 'opacity-100'
      }`}
    >
      {/* Connection Handles (Freestyle Wiring) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-zinc-900 !border-2 !border-emerald-400"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-zinc-900 !border-2 !border-emerald-400"
      />
      <Handle
        type="target"
        id="top"
        position={Position.Top}
        className="!w-2.5 !h-2.5 !bg-zinc-900 !border-2 !border-zinc-500"
      />
      <Handle
        type="source"
        id="bottom"
        position={Position.Bottom}
        className="!w-2.5 !h-2.5 !bg-zinc-900 !border-2 !border-zinc-500"
      />

      {/* Top Artboard Header */}
      <div className="px-3 pt-2.5 pb-2 flex items-center justify-between gap-2 border-b border-zinc-800/90">
        <div className="min-w-0 flex items-center gap-1.5">
          {screen.isInFinalFlow && (
            <span
              title="Part of the Final Flow"
              className={`w-2 h-2 rounded-full shrink-0 ${
                isFinalHighlighted
                  ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                  : 'bg-emerald-500/70'
              }`}
            />
          )}
          <span className="font-semibold text-xs text-zinc-100 truncate">{screen.title}</span>
          <span className="text-[10px] font-mono text-zinc-400 shrink-0">@{screen.slug}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {screen.policyMode === 'exploit-locked' && (
            <span
              title="Exploit-Locked proven winner"
              className="px-1.5 py-0.5 rounded bg-teal-500/15 border border-teal-500/40 text-teal-300 text-[9px] font-semibold flex items-center gap-0.5"
            >
              <Lock className="w-2.5 h-2.5" /> Exploit
            </span>
          )}
          <span
            className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold uppercase tracking-wide ${priorityColors[screen.priority]}`}
          >
            {screen.priority === 'core' ? '★ Core' : screen.priority}
          </span>
        </div>
      </div>

      {/* Proposed Alternatives + Finalized + Cognitive-Load Hide Strip */}
      <div
        className="px-2.5 py-1.5 bg-[#151519] border-b border-zinc-800/80 flex items-center gap-1 flex-wrap"
        onClick={(e) => e.stopPropagation()}
      >
        {visibleVariants.map((variant, idx) => {
          const isCurrent = variant.id === activeVariant?.id;
          const isFinal = variant.id === screen.finalizedVariantId;
          const shortLabel = variant.label.split('—')[0]?.trim() || `Opt ${idx + 1}`;
          return (
            <div
              key={variant.id}
              className={`group flex items-center rounded-md border text-[10px] transition ${
                isCurrent
                  ? isFinal
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 font-semibold'
                    : 'bg-zinc-800 border-zinc-600 text-zinc-100 font-semibold'
                  : 'bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  selectScreen(screen.id);
                  setActiveVariant(screen.id, variant.id);
                }}
                className="px-1.5 py-0.5 flex items-center gap-1"
                title={`${variant.label}${isFinal ? ' (FINALIZED)' : ''}`}
              >
                {isFinal && <Crown className="w-2.5 h-2.5 text-emerald-400" />}
                <span>{shortLabel}</span>
              </button>
              {visibleVariants.length > 1 && (
                <button
                  type="button"
                  onClick={() => toggleVariantHidden(screen.id, variant.id)}
                  title="Hide option to reduce cognitive load"
                  className="pr-1 pl-0.5 py-0.5 text-zinc-500 hover:text-zinc-200 opacity-60 group-hover:opacity-100 transition"
                >
                  <EyeOff className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          );
        })}

        {hiddenVariants.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHiddenDrawer((v) => !v)}
            className="px-1.5 py-0.5 rounded-md bg-zinc-900 border border-dashed border-zinc-700 text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
            title="Show hidden options"
          >
            <Eye className="w-2.5 h-2.5" />
            {hiddenVariants.length} hidden
          </button>
        )}

        <button
          type="button"
          onClick={() => exploreNewVariant(screen.id)}
          title="Explore new AI design alternative for this screen"
          className="ml-auto px-1.5 py-0.5 rounded-md bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/35 text-violet-300 text-[10px] font-medium flex items-center gap-0.5"
        >
          <Plus className="w-2.5 h-2.5" /> Alt
        </button>
      </div>

      {/* Hidden Options Quick Restore Drawer */}
      {showHiddenDrawer && hiddenVariants.length > 0 && (
        <div
          className="px-2.5 py-1.5 bg-zinc-900/95 border-b border-zinc-800 space-y-1"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">
            Hidden Options (Click to restore)
          </div>
          {hiddenVariants.map((hv) => (
            <div key={hv.id} className="flex items-center justify-between text-[10px] text-zinc-300">
              <span className="truncate">{hv.label}</span>
              <button
                type="button"
                onClick={() => toggleVariantHidden(screen.id, hv.id)}
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-300 flex items-center gap-1 text-[9px]"
              >
                <Eye className="w-2.5 h-2.5" /> Show
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Live Artboard Viewport (Skeleton Progressive Reveal OR Sandboxed Live HTML Iframe) */}
      <div className="p-2">
        <div
          className="relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950"
          style={{ width: viewportW, height: viewportH }}
        >
          {/* Status Ribbon inside viewport top-right */}
          {isViewingFinalized && (
            <div className="pointer-events-none absolute top-1.5 right-1.5 z-25 px-1.5 py-0.5 rounded-md bg-emerald-600/95 text-white text-[9px] font-bold tracking-wide flex items-center gap-1 shadow">
              <CheckCircle2 className="w-2.5 h-2.5" /> FINALIZED
            </div>
          )}

          {activeVariant?.fidelity === 'skeleton' || !activeVariant?.html ? (
            <div className="w-full h-full bg-[#16161b] p-5 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-amber-400 font-semibold">
                    Progressive Reveal · Skeleton
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">~700 tok</span>
                </div>
                <div className="text-sm font-semibold text-zinc-100">{screen.title}</div>
                <ul className="space-y-2 pt-1">
                  {(
                    activeVariant?.skeletonBullets ?? [
                      screen.description,
                      'Primary action wired to downstream flow',
                    ]
                  ).map((b, i) => (
                    <li
                      key={i}
                      className="text-xs text-zinc-300 flex items-start gap-2 bg-zinc-900/90 border border-zinc-800 rounded-lg px-2.5 py-2"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  exploreNewVariant(screen.id, 'Expand skeleton into full interactive UI');
                }}
                className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg transition"
              >
                <Sparkles className="w-3.5 h-3.5" /> Expand to Interactive UI
              </button>
            </div>
          ) : (
            <ScreenIframe
              screenId={screen.id}
              html={activeVariant.html}
              devicePreset={project.devicePreset}
              displayWidth={viewportW}
              displayHeight={viewportH}
              mode={activeTool === 'point' ? 'point' : 'view'}
              onPointPick={(payload) => {
                selectScreen(screen.id);
                setPendingPoint(payload);
              }}
            />
          )}

          {/* Point Pins & Paint Region Overlays */}
          <AnnotationLayer
            annotations={screen.annotations}
            activeVariantId={activeVariant?.id ?? null}
            onToggleIncludeInAi={(annId) => toggleAnnotationIncludeInAi(screen.id, annId)}
            onSelectScreen={() => selectScreen(screen.id)}
          />

          {/* Active Paint & Speak Mode Overlay (B) */}
          {activeTool === 'paint' && isSelected && activeVariant && (
            <PaintOverlay
              width={viewportW}
              height={viewportH}
              onCancel={() => setActiveTool('select')}
              onSaveMask={async (mask) => {
                addAnnotation(screen.id, {
                  screenId: screen.id,
                  variantId: activeVariant.id,
                  author: 'designer',
                  kind: 'paint-region',
                  includeInAiFeedback: mask.includeInAiFeedback,
                  xPercent: mask.xPercent,
                  yPercent: mask.yPercent,
                  paintTarget: {
                    strokes: mask.strokes,
                    boundingBoxPercent: mask.boundingBoxPercent,
                    maskDataUrl: mask.maskDataUrl,
                    intersectingSelectors: [`region(${mask.boundingBoxPercent.x}%,${mask.boundingBoxPercent.y}%)`],
                  },
                  category: mask.category,
                  severity: 'warning',
                  comment: mask.comment,
                });
                setActiveTool('select');
                if (mask.sendImmediately && mask.includeInAiFeedback) {
                  await sendIncludedFeedbackToAI(
                    screen.id,
                    `Refine painted region on @${screen.slug}: ${mask.comment}`
                  );
                }
              }}
            />
          )}

          {/* Point Pin Creation Popover (C) */}
          {pendingPoint && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="nodrag nopan absolute inset-x-2 bottom-2 z-40 rounded-xl bg-[#18181d]/98 border border-blue-500/60 p-3 shadow-2xl space-y-2 backdrop-blur-md"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono text-blue-300 truncate flex items-center gap-1">
                  <Pin className="w-3 h-3 shrink-0" />
                  &lt;{pendingPoint.tagName}&gt;{' '}
                  {pendingPoint.textSnippet ? `"${pendingPoint.textSnippet.slice(0, 24)}"` : pendingPoint.selector}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingPoint(null)}
                  className="text-zinc-400 hover:text-zinc-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={pinComment}
                  onChange={(e) => setPinComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSavePointPin(false);
                    }
                  }}
                  placeholder="Describe feedback for this element..."
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-blue-400"
                />
                {isSupported && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={`px-2 py-1 rounded-lg border text-xs ${
                      isListening
                        ? 'bg-blue-600 border-blue-400 text-white animate-pulse'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-300'
                    }`}
                    title="Dictate feedback"
                  >
                    {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <select
                    value={pinCategory}
                    onChange={(e) => setPinCategory(e.target.value as AnnotationCategory)}
                    className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-300"
                  >
                    <option value="usability">Usability</option>
                    <option value="hierarchy">Hierarchy</option>
                    <option value="copy">Copy</option>
                    <option value="layout">Layout</option>
                    <option value="accessibility">A11y</option>
                    <option value="flow">Flow</option>
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pinIncludeAi}
                      onChange={(e) => setPinIncludeAi(e.target.checked)}
                      className="accent-emerald-500"
                    />
                    Include in AI
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={!pinComment.trim()}
                    onClick={() => handleSavePointPin(false)}
                    className="px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-[10px] text-zinc-100"
                  >
                    Save v1
                  </button>
                  <button
                    type="button"
                    disabled={!pinComment.trim()}
                    onClick={() => handleSavePointPin(true)}
                    className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-[10px] text-white font-semibold flex items-center gap-1"
                  >
                    <Send className="w-2.5 h-2.5" /> AI
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Telemetry Bar */}
      <div className="px-3 pb-2.5 pt-0.5 flex items-center justify-between text-[10px] text-zinc-400">
        <div className="flex items-center gap-2">
          {screen.evaluation && (
            <span
              className={`font-mono font-semibold ${
                screen.evaluation.overallScore >= 82
                  ? 'text-emerald-400'
                  : screen.evaluation.overallScore >= 74
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              UX {screen.evaluation.overallScore}
            </span>
          )}
          <span title="Thompson Sampling empirical win rate" className="font-mono text-zinc-300">
            β {winRate}%
          </span>
          {openAnnotations.length > 0 && (
            <span
              title={`${includedCount} of ${openAnnotations.length} open annotations opted into AI feedback`}
              className="px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-300 font-mono"
            >
              {includedCount}/{openAnnotations.length} → AI
            </span>
          )}
        </div>
        <span className="font-mono text-zinc-500">{formatTokens(screenTokens)} tok</span>
      </div>
    </div>
  );
};
