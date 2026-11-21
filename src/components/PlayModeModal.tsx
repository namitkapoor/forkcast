import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  MousePointerClick,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import type { TraversalStep } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';
import { ScreenIframe } from '../canvas/ScreenIframe';

export const PlayModeModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isPlayModeOpen);
  const project = useStudioStore((s) => s.project);
  const setPlayModeOpen = useStudioStore((s) => s.setPlayModeOpen);
  const recordTraversalTrace = useStudioStore((s) => s.recordTraversalTrace);

  const screens = Object.values(project.screens);
  const initialScreen =
    screens.find((s) => s.id === 'landing') ??
    screens.find((s) => s.isInFinalFlow) ??
    screens[0];

  const [currentScreenId, setCurrentScreenId] = useState<string>(initialScreen?.id ?? '');
  const [steps, setSteps] = useState<TraversalStep[]>([]);
  const [enteredAt, setEnteredAt] = useState<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [deadClicks, setDeadClicks] = useState<number>(0);
  const [previousScreenId, setPreviousScreenId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialScreen) {
      setCurrentScreenId(initialScreen.id);
      setSteps([]);
      setEnteredAt(Date.now());
      setElapsedMs(0);
      setDeadClicks(0);
      setPreviousScreenId(null);
    }
  }, [isOpen, initialScreen?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - enteredAt);
    }, 250);
    return () => clearInterval(interval);
  }, [isOpen, enteredAt]);

  if (!isOpen) return null;

  const currentScreen = project.screens[currentScreenId];
  if (!currentScreen) return null;

  const activeVariant =
    currentScreen.variants.find((v) => v.id === currentScreen.finalizedVariantId) ??
    currentScreen.variants.find((v) => v.id === currentScreen.activeVariantId) ??
    currentScreen.variants[0];

  const outgoingEdges = Object.values(project.edges).filter(
    (e) => e.sourceScreenId === currentScreen.id && project.screens[e.targetScreenId]
  );

  const hesitated = elapsedMs > 10_000 || deadClicks >= 2;

  const transitionViaEdge = (edgeId: string) => {
    const edge = project.edges[edgeId];
    if (!edge) return;
    const now = Date.now();
    const dwell = now - enteredAt;
    const backtracked = edge.edgeType === 'back' || edge.targetScreenId === previousScreenId;

    const completedStep: TraversalStep = {
      screenId: currentScreen.id,
      variantId: activeVariant?.id ?? '',
      edgeIdTaken: edge.id,
      enteredAt,
      dwellMs: dwell,
      deadClicks,
      hesitated: dwell > 10_000 || deadClicks >= 2,
      backtracked,
    };

    setSteps((prev) => [...prev, completedStep]);
    setPreviousScreenId(currentScreen.id);
    setCurrentScreenId(edge.targetScreenId);
    setEnteredAt(now);
    setElapsedMs(0);
    setDeadClicks(0);
  };

  const finishTrace = (completed: boolean) => {
    const now = Date.now();
    const finalStep: TraversalStep = {
      screenId: currentScreen.id,
      variantId: activeVariant?.id ?? '',
      enteredAt,
      dwellMs: now - enteredAt,
      deadClicks,
      hesitated,
      backtracked: false,
    };
    recordTraversalTrace({
      id: `trace-manual-${Date.now().toString(36)}`,
      actor: 'designer',
      startedAt: steps[0]?.enteredAt ?? enteredAt,
      completed,
      steps: [...steps, finalStep],
    });
    setPlayModeOpen(false);
  };

  const isDesktop = project.devicePreset === 'desktop';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6">
      <div className="bg-[#18181d] border border-zinc-700 rounded-2xl shadow-2xl flex flex-col max-w-5xl w-full max-h-[92vh] overflow-hidden">
        {/* Header Telemetry Bar */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-1.5">
              <Play className="w-3 h-3" /> Play / Traversal Unit Test
            </span>
            <span className="text-sm font-semibold text-zinc-100">
              @{currentScreen.slug} — {currentScreen.title}
            </span>
            <span className="text-xs text-zinc-400 hidden sm:inline">
              ({activeVariant?.label})
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono">
            <span
              className={`flex items-center gap-1 px-2 py-0.5 rounded ${
                elapsedMs > 10_000
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-zinc-900 text-zinc-300'
              }`}
            >
              <Clock className="w-3 h-3" /> {(elapsedMs / 1000).toFixed(1)}s
            </span>
            <span
              className={`flex items-center gap-1 px-2 py-0.5 rounded ${
                deadClicks > 0 ? 'bg-rose-500/20 text-rose-300' : 'bg-zinc-900 text-zinc-300'
              }`}
            >
              <MousePointerClick className="w-3 h-3" /> {deadClicks} dead clicks
            </span>
            {hesitated && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/25 text-amber-200">
                <AlertCircle className="w-3 h-3" /> Hesitation
              </span>
            )}
            <button
              type="button"
              onClick={() => setPlayModeOpen(false)}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Live Clickable Screen Stage */}
        <div className="flex-1 overflow-auto bg-[#111114] p-6 flex items-center justify-center">
          {activeVariant?.html ? (
            <div className="rounded-xl overflow-hidden shadow-2xl border border-zinc-700">
              <ScreenIframe
                screenId={currentScreen.id}
                html={activeVariant.html}
                devicePreset={project.devicePreset}
                displayWidth={isDesktop ? 860 : 340}
                displayHeight={isDesktop ? 538 : 660}
                mode="play"
                onPlayClick={(ev) => {
                  if (ev.edgeId && project.edges[ev.edgeId]) {
                    transitionViaEdge(ev.edgeId);
                  } else if (ev.isDeadClick) {
                    setDeadClicks((c) => c + 1);
                  }
                }}
              />
            </div>
          ) : (
            <div className="max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-8 text-center space-y-4">
              <div className="text-xs uppercase tracking-widest text-amber-400 font-semibold">
                Progressive Skeleton Terminal Screen
              </div>
              <h3 className="text-xl font-bold text-zinc-100">{currentScreen.title}</h3>
              <ul className="text-left text-xs text-zinc-300 space-y-2">
                {(activeVariant?.skeletonBullets ?? [currentScreen.description]).map((b, i) => (
                  <li key={i} className="bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                    • {b}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => finishTrace(true)}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" /> Complete Flow &amp; Record Trace
              </button>
            </div>
          )}
        </div>

        {/* Bottom Outgoing Transition Triggers & Trace Commit */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-[#151519] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-zinc-400 font-medium">
              Click screen CTAs or trigger edge:
            </span>
            {outgoingEdges.map((edge) => (
              <button
                key={edge.id}
                type="button"
                onClick={() => transitionViaEdge(edge.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1 transition ${
                  edge.isFinalFlowEdge
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25'
                    : edge.edgeType === 'back'
                    ? 'bg-amber-500/10 border-amber-500/35 text-amber-200 hover:bg-amber-500/20'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700'
                }`}
              >
                {edge.edgeType === 'back' && <RotateCcw className="w-3 h-3" />}
                {edge.label}
                <ArrowRight className="w-3 h-3 opacity-60" />@{project.screens[edge.targetScreenId]?.slug}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => finishTrace(false)}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs"
            >
              Record Drop-Off
            </button>
            <button
              type="button"
              onClick={() => finishTrace(true)}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Save Completed Trace ({steps.length + 1} steps)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
