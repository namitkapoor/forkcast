import React from 'react';
import { Bot, Columns2, Loader2, SlidersHorizontal } from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { AgentChatPanel } from './AgentChatPanel';
import { RightInspector } from './RightInspector';

/**
 * Unified Right Studio Rail:
 * - Keeps BOTH `<AgentChatPanel />` and `<RightInspector />` mounted at all times
 *   so switching between Chat and Inspector (or clicking screens on the canvas)
 *   NEVER unmounts, resets, or loses working chat components, scroll position, or drafts!
 * - Uses a clean single-column width (`380px`) by default so the center Figma canvas
 *   never gets crushed on laptop screens, with an optional `Split` view on wide monitors.
 */
export const RightStudioRail: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const settings = useStudioStore((s) => s.settings);
  const rightRailMode = useStudioStore((s) => s.rightRailMode);
  const isBusy = useStudioStore((s) => s.isBusy);
  const setRightRailMode = useStudioStore((s) => s.setRightRailMode);

  const selectedScreen = project.selectedScreenId
    ? project.screens[project.selectedScreenId]
    : null;
  const selectedEdge = project.selectedEdgeId ? project.edges[project.selectedEdgeId] : null;
  const isLive = Boolean(settings.apiKey.trim()) && !settings.useMockFallback;

  const inspectorLabel = selectedScreen
    ? `@${selectedScreen.slug}`
    : selectedEdge
    ? 'Edge'
    : 'Inspect';

  const isSplit = rightRailMode === 'split';

  return (
    <aside
      className={`${
        isSplit ? 'w-[700px] max-w-[55vw]' : 'w-[380px] max-w-[42vw]'
      } bg-[#18181c] border-l border-[#2b2b33] flex flex-col shrink-0 min-h-0 overflow-hidden select-none`}
    >
      {/* Top Dock Mode Switcher */}
      <div className="h-10 px-2.5 border-b border-[#2b2b33] bg-[#141418] flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center bg-[#1c1c22] border border-zinc-800 rounded-lg p-0.5 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setRightRailMode('chat')}
            className={`flex-1 py-1 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1.5 transition min-w-0 ${
              rightRailMode === 'chat'
                ? 'bg-violet-600/25 text-violet-200 border border-violet-500/40'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {isBusy ? (
              <Loader2 className="w-3 h-3 animate-spin text-violet-300 shrink-0" />
            ) : (
              <Bot className="w-3 h-3 text-violet-300 shrink-0" />
            )}
            <span className="truncate">AI Chat</span>
            <span
              className={`px-1 rounded text-[8px] font-mono shrink-0 ${
                isLive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
              }`}
            >
              {isLive ? 'LIVE' : 'DEMO'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRightRailMode('inspector')}
            className={`flex-1 py-1 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1.5 transition min-w-0 ${
              rightRailMode === 'inspector'
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3 text-emerald-400 shrink-0" />
            <span className="truncate">{inspectorLabel}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setRightRailMode(isSplit ? 'chat' : 'split')}
          title="Split Inspector & AI Chat side-by-side (wide displays)"
          className={`hidden 2xl:flex p-1.5 rounded-lg border text-[10px] items-center gap-1 shrink-0 transition ${
            isSplit
              ? 'bg-zinc-800 border-zinc-600 text-zinc-100'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Columns2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mounted Panes (Never unmounted -> Zero state loss!) */}
      <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
        <div
          className={`${
            rightRailMode === 'inspector' || isSplit ? 'flex' : 'hidden'
          } ${isSplit ? 'w-1/2 border-r border-[#2b2b33]' : 'w-full'} min-h-0 min-w-0 flex-col overflow-hidden`}
        >
          <RightInspector />
        </div>

        <div
          className={`${
            rightRailMode === 'chat' || isSplit ? 'flex' : 'hidden'
          } ${isSplit ? 'w-1/2' : 'w-full'} min-h-0 min-w-0 flex-col overflow-hidden`}
        >
          <AgentChatPanel />
        </div>
      </div>
    </aside>
  );
};
