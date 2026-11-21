import React from 'react';
import {
  Activity,
  GitBranch,
  Hand,
  Layers,
  Link2,
  Loader2,
  Monitor,
  MousePointer2,
  Paintbrush,
  PanelLeft,
  Pin,
  Play,
  Settings,
  Smartphone,
  Sparkles,
  Square,
  Users,
  Workflow,
} from 'lucide-react';
import type { CanvasViewMode, StudioTool } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';
import { computeBudgetSummary, formatTokens } from '../ai/budgetPolicy';

const VIEWS: Array<{ id: CanvasViewMode; label: string }> = [
  { id: 'free', label: 'Free' },
  { id: 'flow', label: 'Flow' },
  { id: 'tree', label: 'Tree' },
  { id: 'compiled', label: 'Compiled' },
];

const TOOLS: Array<{ id: StudioTool; label: string; keyHint: string; icon: React.ReactNode }> = [
  { id: 'select', label: 'Select', keyHint: 'V', icon: <MousePointer2 className="w-3.5 h-3.5" /> },
  { id: 'pan', label: 'Pan', keyHint: 'H', icon: <Hand className="w-3.5 h-3.5" /> },
  { id: 'point', label: 'Pin', keyHint: 'C', icon: <Pin className="w-3.5 h-3.5" /> },
  { id: 'paint', label: 'Paint', keyHint: 'B', icon: <Paintbrush className="w-3.5 h-3.5" /> },
  { id: 'connect', label: 'Wire', keyHint: 'L', icon: <Link2 className="w-3.5 h-3.5" /> },
  { id: 'play', label: 'Play', keyHint: 'P', icon: <Play className="w-3.5 h-3.5" /> },
];

export const TopToolbar: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const settings = useStudioStore((s) => s.settings);
  const activeTool = useStudioStore((s) => s.activeTool);
  const isBusy = useStudioStore((s) => s.isBusy);
  const isLeftSidebarOpen = useStudioStore((s) => s.isLeftSidebarOpen);

  const setActiveTool = useStudioStore((s) => s.setActiveTool);
  const setCanvasView = useStudioStore((s) => s.setCanvasView);
  const setDevicePreset = useStudioStore((s) => s.setDevicePreset);
  const setSettingsOpen = useStudioStore((s) => s.setSettingsOpen);
  const setLeftSidebarOpen = useStudioStore((s) => s.setLeftSidebarOpen);
  const cancelActiveAiJob = useStudioStore((s) => s.cancelActiveAiJob);
  const runUXEval = useStudioStore((s) => s.runUXEval);
  const runPersonaSimulation = useStudioStore((s) => s.runPersonaSimulation);

  const budget = computeBudgetSummary(project);
  const isLive = Boolean(settings.apiKey.trim()) && !settings.useMockFallback;

  return (
    <header className="h-12 px-2.5 bg-[#18181c] border-b border-[#2b2b33] flex items-center justify-between gap-2 shrink-0 z-30 select-none overflow-x-auto">
      {/* Left: Sidebar Toggle, Brand & View Switcher */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setLeftSidebarOpen(!isLeftSidebarOpen)}
          title="Toggle Left Layers & Budget Sidebar"
          className={`p-1.5 rounded-lg border transition ${
            isLeftSidebarOpen
              ? 'bg-zinc-800 border-zinc-700 text-zinc-100'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-violet-500 flex items-center justify-center text-zinc-950 font-black text-xs shadow">
            <Workflow className="w-4 h-4" />
          </div>
          <div className="leading-tight hidden xl:block">
            <div className="text-xs font-bold tracking-tight text-zinc-100">Forkcast Studio</div>
            <div className="text-[10px] text-zinc-400 truncate max-w-[140px]">{project.name}</div>
          </div>
        </div>

        <div className="flex items-center bg-[#121215] border border-zinc-800 rounded-lg p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setCanvasView(v.id)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition flex items-center gap-1 ${
                project.canvasView === v.id
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {v.id === 'compiled' && <GitBranch className="w-3 h-3 text-emerald-400" />}
              {v.id === 'tree' && <Layers className="w-3 h-3 text-violet-400" />}
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex items-center bg-[#121215] border border-zinc-800 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setDevicePreset('desktop')}
            title="Desktop Web Frames (1280×800)"
            className={`p-1 rounded-md transition ${
              project.devicePreset === 'desktop'
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setDevicePreset('mobile')}
            title="Mobile Frames (390×844)"
            className={`p-1 rounded-md transition ${
              project.devicePreset === 'mobile'
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Center: Tool Dock */}
      <div className="flex items-center gap-0.5 bg-[#121215] border border-zinc-800 rounded-xl p-1 shrink-0">
        {TOOLS.map((t) => {
          const isActive = activeTool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTool(t.id)}
              title={`${t.label} (${t.keyHint})`}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition ${
                isActive
                  ? t.id === 'paint'
                    ? 'bg-pink-600 text-white shadow'
                    : t.id === 'point'
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
              }`}
            >
              {t.icon}
              <span className="hidden lg:inline">{t.label}</span>
              <kbd className="text-[9px] font-mono opacity-60 hidden 2xl:inline">{t.keyHint}</kbd>
            </button>
          );
        })}
      </div>

      {/* Right: Budget, Actions, Stop & Settings */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div
          title={`Session token spend: ${budget.totalSpent.toLocaleString()} / ${budget.totalBudget.toLocaleString()} (${budget.coreShareOfSpend}% on Core UX Focus)`}
          className="hidden xl:flex items-center gap-2 px-2 py-1 rounded-lg bg-[#121215] border border-zinc-800"
        >
          <div className="w-12 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 rounded-full transition-all"
              style={{ width: `${Math.max(4, budget.percentUsed)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-zinc-300">
            {formatTokens(budget.totalSpent)}/{formatTokens(budget.totalBudget)}
          </span>
        </div>

        {isBusy && (
          <button
            type="button"
            onClick={cancelActiveAiJob}
            title="Cancel active Gemini 4 call"
            className="px-2 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-[11px] font-semibold flex items-center gap-1"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
            <Square className="w-2.5 h-2.5 fill-current" />
          </button>
        )}

        <button
          type="button"
          disabled={isBusy}
          onClick={runPersonaSimulation}
          title="Simulate 4 User Personas"
          className="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 text-[11px] font-medium flex items-center gap-1 disabled:opacity-40 transition"
        >
          <Users className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden 2xl:inline">Personas</span>
        </button>

        <button
          type="button"
          disabled={isBusy}
          onClick={() => runUXEval(project.selectedScreenId ?? undefined)}
          title="Run Multimodal UX Evaluation"
          className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 shadow transition"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden md:inline">UX Eval</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition ${
            isLive
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
              : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
          }`}
          title="Gemini 4 Models, Thinking Levels & .env Settings"
        >
          <Activity className="w-3 h-3" />
          <span className="hidden md:inline">{isLive ? 'Gemini 4 Live' : 'Demo'}</span>
          <Settings className="w-3.5 h-3.5 opacity-75" />
        </button>
      </div>
    </header>
  );
};
