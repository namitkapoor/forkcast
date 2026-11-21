import React, { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStudioStore } from '../store/useStudioStore';
import { ScreenNodeCard } from './ScreenNodeCard';
import { FlowEdge } from './FlowEdge';

const nodeTypes = { screenNode: ScreenNodeCard };
const edgeTypes = { flowEdge: FlowEdge };

const StudioCanvasInner: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const activeTool = useStudioStore((s) => s.activeTool);
  const setActiveTool = useStudioStore((s) => s.setActiveTool);
  const selectScreen = useStudioStore((s) => s.selectScreen);
  const selectEdge = useStudioStore((s) => s.selectEdge);
  const updateScreenPosition = useStudioStore((s) => s.updateScreenPosition);
  const connectScreens = useStudioStore((s) => s.connectScreens);

  const { fitView } = useReactFlow();

  const nodes: Node[] = useMemo(
    () =>
      Object.values(project.screens).map((screen) => ({
        id: screen.id,
        type: 'screenNode',
        position: screen.position,
        data: { screen },
        draggable: activeTool !== 'paint' && activeTool !== 'point',
      })),
    [project.screens, activeTool]
  );

  const edges: Edge[] = useMemo(
    () =>
      Object.values(project.edges)
        .filter(
          (e) => project.screens[e.sourceScreenId] && project.screens[e.targetScreenId]
        )
        .map((edge) => ({
          id: edge.id,
          source: edge.sourceScreenId,
          target: edge.targetScreenId,
          type: 'flowEdge',
          data: { flowEdge: edge },
        })),
    [project.edges, project.screens]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) {
          updateScreenPosition(ch.id, ch.position);
        }
      }
    },
    [updateScreenPosition]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        connectScreens(connection.source, connection.target, 'Transition');
      }
    },
    [connectScreens]
  );

  // Figma-style keyboard shortcuts (V / H / C / B / L / P, Shift+1 Fit, Shift+2 Zoom Selection)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.shiftKey && e.key === '!') {
        e.preventDefault();
        fitView({ padding: 0.16, duration: 350 });
        return;
      }
      if (e.shiftKey && e.key === '@' && project.selectedScreenId) {
        e.preventDefault();
        fitView({ nodes: [{ id: project.selectedScreenId }], padding: 0.35, duration: 350 });
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'v') setActiveTool('select');
      else if (key === 'h') setActiveTool('pan');
      else if (key === 'c') setActiveTool('point');
      else if (key === 'b') setActiveTool('paint');
      else if (key === 'l') setActiveTool('connect');
      else if (key === 'p') setActiveTool('play');
      else if (key === 'escape') {
        setActiveTool('select');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fitView, project.selectedScreenId, setActiveTool]);

  // Refit view cleanly when canvas view mode changes
  useEffect(() => {
    const t = setTimeout(() => {
      fitView({ padding: 0.18, duration: 320 });
    }, 60);
    return () => clearTimeout(t);
  }, [project.canvasView, project.devicePreset, fitView]);

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onPaneClick={() => {
          selectScreen(null);
          selectEdge(null);
        }}
        panOnDrag={activeTool === 'pan' || activeTool === 'select'}
        selectionOnDrag={false}
        minZoom={0.18}
        maxZoom={2.2}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="#2b2b34"
        />
        <Controls position="bottom-left" className="!mb-24 !ml-3" />
        <MiniMap
          position="bottom-right"
          className="!mb-24 !mr-3"
          nodeColor={(n) => {
            const sc = (n.data as { screen?: { isInFinalFlow?: boolean; priority?: string } })
              ?.screen;
            if (sc?.isInFinalFlow) return '#10b981';
            if (sc?.priority === 'core') return '#8b5cf6';
            return '#52525b';
          }}
          maskColor="rgba(12, 12, 15, 0.72)"
        />
      </ReactFlow>

      {/* Active Mode / Final Flow Legend Pill */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-2 flex-wrap">
        {project.selectedScreenId && (
          <div className="px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/50 text-emerald-200 text-[11px] font-medium flex items-center gap-1.5 shadow-lg backdrop-blur">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Final Flow Highlighted · Click canvas to clear
          </div>
        )}
        {activeTool === 'point' && (
          <div className="px-2.5 py-1 rounded-full bg-blue-950/90 border border-blue-400/60 text-blue-200 text-[11px] font-medium shadow-lg backdrop-blur">
            Point Mode (C): Hover &amp; click any UI element inside a screen to pin feedback
          </div>
        )}
        {activeTool === 'paint' && (
          <div className="px-2.5 py-1 rounded-full bg-pink-950/90 border border-pink-400/60 text-pink-200 text-[11px] font-medium shadow-lg backdrop-blur">
            Paint &amp; Speak Mode (B): Click a screen, then brush over any region to target AI
          </div>
        )}
        {activeTool === 'connect' && (
          <div className="px-2.5 py-1 rounded-full bg-zinc-900/95 border border-zinc-600 text-zinc-200 text-[11px] font-medium shadow-lg backdrop-blur">
            Connect Mode (L): Drag from any screen handle dot to connect · Click an edge to disconnect
          </div>
        )}
      </div>
    </div>
  );
};

export const StudioCanvas: React.FC = () => (
  <ReactFlowProvider>
    <StudioCanvasInner />
  </ReactFlowProvider>
);
