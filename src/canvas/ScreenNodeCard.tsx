import React, { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  CheckCircle2,
  Crown,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Paintbrush,
  Pin,
  Plus,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type { ScreenNode } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';
import { betaMean, compileWorkflowGraph } from '../graph/compiler';
import { formatTokens } from '../ai/budgetPolicy';
import { formatVersionedRef } from '../domain/annotations';
import { ScreenIframe } from './ScreenIframe';
import { AnnotationLayer } from './AnnotationLayer';
import { PaintOverlay } from './PaintOverlay';

interface ScreenNodeData extends Record<string, unknown> {
  screen: ScreenNode;
}

export const ScreenNodeCard: React.FC<NodeProps> = ({ data }) => {
  const { screen } = data as ScreenNodeData;

  const project = useStudioStore((s) => s.project);
  const activeTool = useStudioStore((s) => s.activeTool);
  const pendingPinDraft = useStudioStore((s) => s.pendingPinDraft);
  const selectScreen = useStudioStore((s) => s.selectScreen);
  const setActiveVariant = useStudioStore((s) => s.setActiveVariant);
  const toggleVariantHidden = useStudioStore((s) => s.toggleVariantHidden);
  const addAnnotation = useStudioStore((s) => s.addAnnotation);
  const toggleAnnotationIncludeInAi = useStudioStore((s) => s.toggleAnnotationIncludeInAi);
  const sendIncludedFeedbackToAI = useStudioStore((s) => s.sendIncludedFeedbackToAI);
  const exploreNewVariant = useStudioStore((s) => s.exploreNewVariant);
  const setActiveTool = useStudioStore((s) => s.setActiveTool);
  const setPendingPinDraft = useStudioStore((s) => s.setPendingPinDraft);
  const appendToChatDraft = useStudioStore((s) => s.appendToChatDraft);

  const [showHiddenDrawer, setShowHiddenDrawer] = useState(false);

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

  const activeDraftOnThisScreen =
    pendingPinDraft && pendingPinDraft.screenId === screen.id ? pendingPinDraft : null;

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
      {/* Connection Handles */}
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

      {/* Top Artboard Header (Fixed single-line height, min-w-0 safe) */}
      <div className="h-9 px-3 flex items-center justify-between gap-2 border-b border-zinc-800/90">
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              selectScreen(screen.id);
              appendToChatDraft(`@${screen.slug}`);
            }}
            title={`Insert @${screen.slug} into AI Chat`}
            className="text-[10px] font-mono text-zinc-400 hover:text-emerald-300 shrink-0 transition"
          >
            @{screen.slug}
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              selectScreen(screen.id);
              setActiveTool(activeTool === 'point' && isSelected ? 'select' : 'point');
            }}
            title="Pin an element on this screen (C)"
            className={`p-1 rounded-md border transition ${
              activeTool === 'point' && isSelected
                ? 'bg-blue-600 border-blue-400 text-white'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-blue-300'
            }`}
          >
            <Pin className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              selectScreen(screen.id);
              setActiveTool(activeTool === 'paint' && isSelected ? 'select' : 'paint');
            }}
            title="Paint & Speak a region on this screen (B)"
            className={`p-1 rounded-md border transition ${
              activeTool === 'paint' && isSelected
                ? 'bg-pink-600 border-pink-400 text-white'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-pink-300'
            }`}
          >
            <Paintbrush className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={() => selectScreen(screen.id, true)}
            title="Open Screen Inspector (Options, Pins & UX Eval)"
            className="p-1 rounded-md border bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100 transition"
          >
            <SlidersHorizontal className="w-2.5 h-2.5" />
          </button>
          {screen.policyMode === 'exploit-locked' && (
            <span
              title="Exploit-Locked proven winner"
              className="px-1 py-0.5 rounded bg-teal-500/15 border border-teal-500/40 text-teal-300 text-[9px]"
            >
              <Lock className="w-2.5 h-2.5" />
            </span>
          )}
          <span
            className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold uppercase tracking-wide ${priorityColors[screen.priority]}`}
          >
            {screen.priority === 'core' ? '★ Core' : screen.priority.slice(0, 4)}
          </span>
        </div>
      </div>

      {/* Horizontal-Scrolling Option Strip (Never wraps vertically -> prevents node overlap!) */}
      <div
        className="h-8 px-2 bg-[#151519] border-b border-zinc-800/80 flex items-center gap-1 overflow-x-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
          {visibleVariants.map((variant, idx) => {
            const isCurrent = variant.id === activeVariant?.id;
            const isFinal = variant.id === screen.finalizedVariantId;
            const shortLabel = variant.label.split('—')[0]?.trim() || `Opt ${idx + 1}`;
            return (
              <div
                key={variant.id}
                className={`group flex items-center rounded-md border text-[10px] shrink-0 transition ${
                  isCurrent
                    ? isFinal
                      ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 font-semibold'
                      : 'bg-zinc-800 border-zinc-600 text-zinc-100 font-semibold'
                    : 'bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    selectScreen(screen.id);
                    setActiveVariant(screen.id, variant.id);
                  }}
                  className="px-1.5 py-0.5 flex items-center gap-1 whitespace-nowrap"
                  title={`${variant.label}${isFinal ? ' (FINALIZED)' : ''}`}
                >
                  {isFinal && <Crown className="w-2.5 h-2.5 text-emerald-400 shrink-0" />}
                  <span>{shortLabel}</span>
                </button>
                {visibleVariants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => toggleVariantHidden(screen.id, variant.id)}
                    title="Hide option to reduce cognitive load"
                    className="pr-1 pl-0.5 py-0.5 text-zinc-500 hover:text-zinc-200"
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
              className="px-1.5 py-0.5 rounded-md bg-zinc-900 border border-dashed border-zinc-700 text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 shrink-0 whitespace-nowrap"
              title="Show hidden options"
            >
              <Eye className="w-2.5 h-2.5" />
              {hiddenVariants.length}
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={screen.status !== 'idle'}
          onClick={() => exploreNewVariant(screen.id)}
          title="Explore new AI design alternative"
          className="px-1.5 py-0.5 rounded-md bg-violet-500/15 hover:bg-violet-500/25 disabled:opacity-40 border border-violet-500/35 text-violet-300 text-[10px] font-medium flex items-center gap-0.5 shrink-0"
        >
          <Plus className="w-2.5 h-2.5" /> Alt
        </button>
      </div>

      {/* Floating Hidden Options Restore Popover */}
      {showHiddenDrawer && hiddenVariants.length > 0 && (
        <div
          className="px-2.5 py-1.5 bg-zinc-900 border-b border-zinc-800 space-y-1 max-h-24 overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {hiddenVariants.map((hv) => (
            <div
              key={hv.id}
              className="flex items-center justify-between gap-2 text-[10px] text-zinc-300"
            >
              <span className="truncate">{hv.label}</span>
              <button
                type="button"
                onClick={() => toggleVariantHidden(screen.id, hv.id)}
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-300 flex items-center gap-1 text-[9px] shrink-0"
              >
                <Eye className="w-2.5 h-2.5" /> Show
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Live Artboard Viewport */}
      <div className="p-2">
        <div
          className={`relative rounded-xl overflow-hidden border bg-zinc-950 ${
            activeTool === 'point'
              ? 'border-blue-500/70 ring-1 ring-blue-500/30'
              : 'border-zinc-800'
          }`}
          style={{ width: viewportW, height: viewportH }}
        >
          {/* Live Async Status Overlay on Screen */}
          {screen.status !== 'idle' && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-violet-600/95 text-white px-2.5 py-1 text-[10px] font-semibold flex items-center justify-center gap-1.5 shadow">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>
                {screen.status === 'generating'
                  ? 'Iterating UI with Gemini 4...'
                  : 'Evaluating UX with Gemini 4...'}
              </span>
            </div>
          )}

          {isViewingFinalized && screen.status === 'idle' && (
            <div className="pointer-events-none absolute top-1.5 right-1.5 z-25 px-1.5 py-0.5 rounded-md bg-emerald-600/95 text-white text-[9px] font-bold tracking-wide flex items-center gap-1 shadow">
              <CheckCircle2 className="w-2.5 h-2.5" /> FINALIZED
            </div>
          )}

          {activeVariant?.fidelity === 'skeleton' || !activeVariant?.html ? (
            <div
              onClick={(e) => {
                if (activeTool === 'point' && activeVariant) {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  selectScreen(screen.id);
                  setPendingPinDraft({
                    screenId: screen.id,
                    variantId: activeVariant.id,
                    xPercent: Math.round(((e.clientX - rect.left) / rect.width) * 100),
                    yPercent: Math.round(((e.clientY - rect.top) / rect.height) * 100),
                    selector: 'skeleton-screen',
                    tagName: 'section',
                    textSnippet: screen.title,
                    boundingBox: { x: 0, y: 0, w: 400, h: 250 },
                  });
                }
              }}
              className="w-full h-full bg-[#16161b] p-4 flex flex-col justify-between overflow-y-auto"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-amber-400 font-semibold">
                    Progressive Skeleton
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">~700 tok</span>
                </div>
                <div className="text-sm font-semibold text-zinc-100">{screen.title}</div>
                <ul className="space-y-1.5">
                  {(
                    activeVariant?.skeletonBullets ?? [
                      screen.description,
                      'Primary action wired to downstream flow',
                    ]
                  ).map((b, i) => (
                    <li
                      key={i}
                      className="text-[11px] text-zinc-300 flex items-start gap-2 bg-zinc-900/90 border border-zinc-800 rounded-lg px-2.5 py-1.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                disabled={screen.status !== 'idle'}
                onClick={(e) => {
                  e.stopPropagation();
                  exploreNewVariant(screen.id, 'Expand skeleton into full interactive UI');
                }}
                className="w-full py-2 mt-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg transition shrink-0"
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
                if (!activeVariant) return;
                selectScreen(screen.id);
                setPendingPinDraft({
                  screenId: screen.id,
                  variantId: activeVariant.id,
                  xPercent: payload.xPercent,
                  yPercent: payload.yPercent,
                  selector: payload.selector,
                  tagName: payload.tagName,
                  textSnippet: payload.textSnippet,
                  boundingBox: payload.boundingBox,
                });
              }}
            />
          )}

          {/* Pulsing Target Crosshair for Pending Pin Draft */}
          {activeDraftOnThisScreen && (
            <div
              style={{
                left: `${activeDraftOnThisScreen.xPercent}%`,
                top: `${activeDraftOnThisScreen.yPercent}%`,
              }}
              className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full border-2 border-blue-300 bg-blue-500/40 animate-ping"
            />
          )}

          {/* Point Pins & Paint Region Overlays */}
          <AnnotationLayer
            annotations={screen.annotations}
            activeVariantId={activeVariant?.id ?? null}
            onToggleIncludeInAi={(annId) => toggleAnnotationIncludeInAi(screen.id, annId)}
            onSelectScreen={() => selectScreen(screen.id)}
            onMentionInChat={(versionedToken) => appendToChatDraft(versionedToken)}
          />

          {/* Active Paint & Speak Mode Overlay (B) */}
          {activeTool === 'paint' && isSelected && activeVariant && (
            <PaintOverlay
              width={viewportW}
              height={viewportH}
              onCancel={() => setActiveTool('select')}
              onSaveMask={async (mask) => {
                const saved = addAnnotation(screen.id, {
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
                    intersectingSelectors: [
                      `region(${mask.boundingBoxPercent.x}%,${mask.boundingBoxPercent.y}%)`,
                    ],
                  },
                  category: mask.category,
                  severity: 'warning',
                  comment: mask.comment,
                });
                setActiveTool('select');
                if (!saved) return;
                const versionedRef = formatVersionedRef(saved, 1);
                if (mask.sendImmediately && mask.includeInAiFeedback) {
                  await sendIncludedFeedbackToAI(
                    screen.id,
                    `Refine painted region ${versionedRef} on @${screen.slug}: ${mask.comment}`
                  );
                } else {
                  appendToChatDraft(versionedRef);
                }
              }}
            />
          )}
        </div>
      </div>

      {/* Footer Telemetry Bar */}
      <div className="h-7 px-3 flex items-center justify-between text-[10px] text-zinc-400">
        <div className="flex items-center gap-2 min-w-0">
          {screen.evaluation && (
            <span
              className={`font-mono font-semibold shrink-0 ${
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
          <span title="Thompson Sampling empirical win rate" className="font-mono text-zinc-300 shrink-0">
            β {winRate}%
          </span>
          {openAnnotations.length > 0 && (
            <span
              title={`${includedCount} of ${openAnnotations.length} open annotations opted into AI feedback`}
              className="px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-300 font-mono shrink-0"
            >
              {includedCount}/{openAnnotations.length} → AI
            </span>
          )}
        </div>
        <span className="font-mono text-zinc-500 shrink-0">{formatTokens(screenTokens)} tok</span>
      </div>
    </div>
  );
};
