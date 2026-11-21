import { Background, BackgroundVariant, ReactFlow, type NodeMouseHandler, type EdgeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SectionNode, type SectionFlowNode } from "./SectionNode";
import { NoodleEdge, type NoodleFlowEdge } from "./NoodleEdge";
import type { Tool } from "./context";

const nodeTypes = { section: SectionNode };
const edgeTypes = { noodle: NoodleEdge };

interface Props {
  nodes: SectionFlowNode[];
  edges: NoodleFlowEdge[];
  tool: Tool;
  panning: boolean;
  onNodeClick: (id: string) => void;
  onEdgeClick: (id: string) => void;
  onPaneClick: () => void;
}

export function Canvas({ nodes, edges, tool, panning, onNodeClick, onEdgeClick, onPaneClick }: Props) {
  const handleNode: NodeMouseHandler<SectionFlowNode> = (_, n) => onNodeClick(n.id);
  const handleEdge: EdgeMouseHandler<NoodleFlowEdge> = (_, e) => onEdgeClick(e.id);
  const hand = tool === "hand" || panning;

  return (
    <ReactFlow
      className={`canvas canvas--${hand ? "hand" : tool}`}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      forceColorMode="dark"
      minZoom={0.08}
      maxZoom={4}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      edgesFocusable={false}
      nodesFocusable={false}
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      zoomOnDoubleClick={false}
      panOnScroll
      zoomOnPinch
      panOnDrag
      onNodeClick={hand ? undefined : handleNode}
      onEdgeClick={hand ? undefined : handleEdge}
      onPaneClick={onPaneClick}
      attributionPosition="bottom-center"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#2b2b31" />
    </ReactFlow>
  );
}
