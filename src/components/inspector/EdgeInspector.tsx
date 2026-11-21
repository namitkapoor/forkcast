import React from 'react';
import { Trash2 } from 'lucide-react';
import type { FlowEdge, FlowProject } from '../../types/studio';

interface EdgeInspectorProps {
  edge: FlowEdge;
  project: FlowProject;
  onUpdate: (patch: Partial<Pick<FlowEdge, 'label' | 'edgeType' | 'isFinalFlowEdge'>>) => void;
  onDelete: () => void;
}

export const EdgeInspector: React.FC<EdgeInspectorProps> = ({
  edge,
  project,
  onUpdate,
  onDelete,
}) => {
  const src = project.screens[edge.sourceScreenId];
  const dst = project.screens[edge.targetScreenId];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            Transition Edge
          </div>
          <div className="text-sm font-semibold text-zinc-100 mt-0.5 truncate">
            @{src?.slug ?? '?'} → @{dst?.slug ?? '?'}
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 shrink-0"
          title="Disconnect screens"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] text-zinc-400 font-medium">Transition Label</label>
        <input
          value={edge.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-emerald-400"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] text-zinc-400 font-medium">Edge Type</label>
        <select
          value={edge.edgeType}
          onChange={(e) => onUpdate({ edgeType: e.target.value as FlowEdge['edgeType'] })}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100"
        >
          <option value="primary">Primary Forward</option>
          <option value="alternate">Alternate Branch</option>
          <option value="error">Error / Recovery</option>
          <option value="back">Back / Return</option>
        </select>
      </div>

      <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-emerald-300">Part of Final Flow</div>
          <div className="text-[10px] text-zinc-400">
            Highlights brightly when any screen is clicked
          </div>
        </div>
        <input
          type="checkbox"
          checked={edge.isFinalFlowEdge}
          onChange={(e) => onUpdate({ isFinalFlowEdge: e.target.checked })}
          className="accent-emerald-500 w-4 h-4 shrink-0"
        />
      </label>

      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10px] text-zinc-500">Traversals</div>
          <div className="text-sm font-mono font-bold text-zinc-100">
            {edge.metrics.traversals}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500">Completed</div>
          <div className="text-sm font-mono font-bold text-emerald-400">
            {edge.metrics.completions}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500">Backtracks</div>
          <div className="text-sm font-mono font-bold text-amber-400">
            {edge.metrics.backtracks}
          </div>
        </div>
      </div>
    </div>
  );
};
