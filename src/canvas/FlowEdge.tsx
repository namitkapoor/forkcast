import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import type { FlowEdge as FlowEdgeType } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';

interface CustomEdgeData extends Record<string, unknown> {
  flowEdge: FlowEdgeType;
}

export const FlowEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}) => {
  const { flowEdge } = data as CustomEdgeData;
  const project = useStudioStore((s) => s.project);
  const selectEdge = useStudioStore((s) => s.selectEdge);
  const deleteEdge = useStudioStore((s) => s.deleteEdge);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isSelected = project.selectedEdgeId === id;
  const anyScreenSelected = project.selectedScreenId !== null;
  const isFinalHighlight = anyScreenSelected && flowEdge.isFinalFlowEdge;
  const isDimmed = anyScreenSelected && !flowEdge.isFinalFlowEdge && !isSelected;

  const backtrackRate =
    flowEdge.metrics.traversals > 0
      ? Math.round((flowEdge.metrics.backtracks / flowEdge.metrics.traversals) * 100)
      : 0;

  let strokeColor = '#52525b';
  let strokeWidth = 1.8;

  if (isSelected) {
    strokeColor = '#60a5fa';
    strokeWidth = 3;
  } else if (isFinalHighlight) {
    strokeColor = '#10b981';
    strokeWidth = 3.2;
  } else if (flowEdge.edgeType === 'back') {
    strokeColor = '#f59e0b';
    strokeWidth = 1.6;
  } else if (flowEdge.edgeType === 'error') {
    strokeColor = '#f43f5e';
    strokeWidth = 1.8;
  } else if (flowEdge.isFinalFlowEdge) {
    strokeColor = '#34d399';
    strokeWidth = 2.4;
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={isFinalHighlight ? 'final-flow-edge-animated' : undefined}
        style={{
          stroke: strokeColor,
          strokeWidth,
          opacity: isDimmed ? 0.22 : 0.95,
          strokeDasharray:
            flowEdge.edgeType === 'back' && !isFinalHighlight ? '5 4' : undefined,
          filter: isFinalHighlight ? 'drop-shadow(0 0 6px rgba(16,185,129,0.65))' : undefined,
          transition: 'all 180ms ease',
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              selectEdge(id);
            }}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border flex items-center gap-1.5 cursor-pointer transition shadow-md ${
              isSelected
                ? 'bg-blue-600 text-white border-blue-300 scale-105'
                : isFinalHighlight
                ? 'bg-emerald-950/95 text-emerald-200 border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.45)]'
                : isDimmed
                ? 'bg-zinc-900/60 text-zinc-500 border-zinc-800 opacity-35'
                : 'bg-[#1b1b20]/95 text-zinc-300 border-zinc-700 hover:border-zinc-500'
            }`}
          >
            <span>{flowEdge.label}</span>
            {project.canvasView === 'compiled' && flowEdge.metrics.traversals > 0 && (
              <span
                className={`font-mono text-[9px] px-1 rounded ${
                  backtrackRate >= 25
                    ? 'bg-rose-500/25 text-rose-200'
                    : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                {flowEdge.metrics.traversals}x{backtrackRate > 0 ? ` · ${backtrackRate}%↩` : ''}
              </span>
            )}
            {isSelected && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteEdge(id);
                }}
                title="Disconnect screens"
                className="text-blue-100 hover:text-rose-200 ml-0.5"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
