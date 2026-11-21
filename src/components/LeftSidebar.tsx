import React from 'react';
import {
  AlertTriangle,
  Crown,
  EyeOff,
  GitMerge,
  Layers,
  Lock,
  Plus,
  Sliders,
} from 'lucide-react';
import type { PriorityTier } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';
import { computeBudgetSummary, formatTokens } from '../ai/budgetPolicy';
import { compileWorkflowGraph } from '../graph/compiler';

export const LeftSidebar: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const selectScreen = useStudioStore((s) => s.selectScreen);
  const addBlankScreen = useStudioStore((s) => s.addBlankScreen);
  const updateTierShare = useStudioStore((s) => s.updateTierShare);
  const applyCompiledGraphWinners = useStudioStore((s) => s.applyCompiledGraphWinners);

  const screens = Object.values(project.screens);
  const budget = computeBudgetSummary(project);
  const compiled = compileWorkflowGraph(project);

  const tierMeta: Array<{ tier: PriorityTier; label: string; color: string; hint: string }> = [
    { tier: 'core', label: 'Core Focus (Explore)', color: 'accent-violet-500 text-violet-300', hint: 'Pro + Thinking · 3-4 opts' },
    { tier: 'standard', label: 'Standard Flows', color: 'accent-sky-500 text-sky-300', hint: 'Flash · 2 opts' },
    { tier: 'supporting', label: 'Supporting / Exploit', color: 'accent-zinc-400 text-zinc-300', hint: 'Flash-Lite · Skeleton/1 opt' },
  ];

  return (
    <aside className="w-64 bg-[#18181c] border-r border-[#2b2b33] flex flex-col shrink-0 overflow-hidden select-none">
      {/* Section 1: Flow Screens & Final Flow Tree */}
      <div className="p-3 border-b border-[#2b2b33] flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <Layers className="w-3.5 h-3.5" /> Screens ({screens.length})
        </div>
        <button
          type="button"
          onClick={() => addBlankScreen('Screen')}
          className="px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-medium flex items-center gap-1 transition"
          title="Add a new skeleton screen to canvas"
        >
          <Plus className="w-3 h-3" /> Screen
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {screens.map((sc) => {
          const isSelected = project.selectedScreenId === sc.id;
          const hiddenCount = sc.variants.filter((v) => v.isHidden).length;
          const insight = compiled.insights[sc.id];

          return (
            <button
              key={sc.id}
              type="button"
              onClick={() => selectScreen(sc.id)}
              className={`w-full text-left px-2.5 py-2 rounded-xl border transition space-y-1 ${
                isSelected
                  ? 'bg-emerald-500/12 border-emerald-500/50 text-zinc-100'
                  : 'bg-transparent border-transparent hover:bg-zinc-800/60 text-zinc-300'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      sc.isInFinalFlow ? 'bg-emerald-400' : 'bg-zinc-600'
                    }`}
                    title={sc.isInFinalFlow ? 'In Final Flow' : 'Exploratory branch'}
                  />
                  <span className="text-xs font-medium truncate">{sc.title}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {sc.finalizedVariantId && (
                    <span title="Has Finalized Version">
                      <Crown className="w-3 h-3 text-emerald-400" />
                    </span>
                  )}
                  {sc.policyMode === 'exploit-locked' && (
                    <span title="Exploit-Locked">
                      <Lock className="w-2.5 h-2.5 text-teal-400" />
                    </span>
                  )}
                  {insight?.isBottleneck && (
                    <span title={insight.reason}>
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-zinc-500 pl-3.5">
                <span className="font-mono">@{sc.slug}</span>
                <div className="flex items-center gap-1.5">
                  <span>{sc.variants.length - hiddenCount} vis</span>
                  {hiddenCount > 0 && (
                    <span className="flex items-center gap-0.5 text-zinc-400">
                      <EyeOff className="w-2.5 h-2.5" />
                      {hiddenCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Section 2: Tree -> Graph Compiler Summary */}
      <div className="p-3 border-t border-[#2b2b33] bg-[#151519] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
            <GitMerge className="w-3 h-3 text-emerald-400" /> Workflow Compiler
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {project.traces.length} traces
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5">
            <div className="text-zinc-500">Exploit Ready</div>
            <div className="font-mono font-semibold text-teal-300">
              {compiled.exploitLockedIds.length} screens
            </div>
          </div>
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5">
            <div className="text-zinc-500">Bottlenecks</div>
            <div className="font-mono font-semibold text-amber-300">
              {compiled.bottleneckScreenIds.length} explore
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={applyCompiledGraphWinners}
          className="w-full py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold transition"
        >
          Compile Tree → Lock Winners
        </button>
      </div>

      {/* Section 3: UX Focus & GenAI Token Spend Budget Sliders */}
      <div className="p-3 border-t border-[#2b2b33] space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
            <Sliders className="w-3 h-3 text-violet-400" /> Token Budget Split
          </span>
          <span className="text-[10px] font-mono text-zinc-300">
            {formatTokens(budget.remaining)} left
          </span>
        </div>

        <div className="space-y-2">
          {tierMeta.map(({ tier, label, color, hint }) => {
            const sharePct = Math.round(project.budgetConfig.tierShares[tier] * 100);
            const spent = budget.spentByTier[tier];
            const cap = budget.budgetByTier[tier];
            return (
              <div key={tier} className="space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className={`font-medium ${color.split(' ')[1]}`}>{label}</span>
                  <span className="font-mono text-zinc-400">
                    {sharePct}% · {formatTokens(spent)}/{formatTokens(cap)}
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={85}
                  value={sharePct}
                  onChange={(e) => updateTierShare(tier, Number(e.target.value) / 100)}
                  className={`w-full h-1.5 rounded-lg bg-zinc-800 cursor-pointer ${color.split(' ')[0]}`}
                />
                <div className="text-[9px] text-zinc-500">{hint}</div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
