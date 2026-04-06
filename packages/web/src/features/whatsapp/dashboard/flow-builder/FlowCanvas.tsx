import { useState, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { nodeTypes } from "./FlowNodes";
import { NodeSidebar } from "./NodeSidebar";
import { NodeProperties } from "./NodeProperties";
import type { FlowNodeData, FlowDefinition } from "./types";

interface FlowCanvasProps {
  initialData?: FlowDefinition;
  onChange?: (data: FlowDefinition) => void;
}

const DEFAULT_NODE_DATA: Record<string, FlowNodeData> = {
  trigger: { keyword: "", matchType: "contains" },
  condition: { conditionField: "message", conditionOperator: "contains", conditionValue: "" },
  message: { messageText: "" },
  buttons: { buttonText: "", buttonFooter: "", buttons: [] },
  delay: { delaySeconds: 3 },
};

function FlowCanvasInner({ initialData, onChange }: FlowCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialData?.nodes as Node[] ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialData?.edges as Edge[] ?? []);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Sync changes back to parent
  useEffect(() => {
    onChange?.({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type ?? "message",
        position: n.position,
        data: n.data as FlowNodeData,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: typeof e.label === "string" ? e.label : undefined,
      })),
    });
  }, [nodes, edges, onChange]);

  const onConnect = useCallback(
    (connection: Connection) => {
      let label: string | undefined;
      if (connection.sourceHandle === "yes") label = "Yes";
      else if (connection.sourceHandle === "no") label = "No";
      else if (connection.sourceHandle?.startsWith("btn_")) {
        const sourceNode = nodes.find((n) => n.id === connection.source);
        if (sourceNode) {
          const btns = (sourceNode.data as FlowNodeData).buttons ?? [];
          const btnId = connection.sourceHandle.replace("btn_", "");
          const btn = btns.find((b) => b.id === btnId);
          if (btn) label = btn.text;
        }
      }

      const edge: Edge = {
        ...connection,
        id: `e-${connection.source}-${connection.sourceHandle ?? "default"}-${connection.target}`,
        animated: true,
        style: { strokeWidth: 2 },
        ...(label ? { label } : {}),
      };
      setEdges((eds) => addEdge(edge, eds));
    },
    [setEdges, nodes]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type || !reactFlowWrapper.current) return;

      // Use screenToFlowPosition with raw client coordinates
      // React Flow v12 handles the container offset internally
      const position = rf.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: { ...DEFAULT_NODE_DATA[type] },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [rf, setNodes]
  );

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
    // No need to store offset - we'll place the node where the cursor is in the canvas
  };

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleNodeDataChange = useCallback(
    (nodeId: string, data: FlowNodeData) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...data } } : n))
      );
    },
    [setNodes]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
    },
    [setNodes, setEdges]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="flex h-full border rounded-lg overflow-hidden bg-background">
      <NodeSidebar onDragStart={onDragStart} />

      <div ref={reactFlowWrapper} className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[16, 16]}
          defaultEdgeOptions={{ animated: true, style: { strokeWidth: 2 } }}
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Controls />
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <MiniMap
            nodeStrokeWidth={3}
            pannable
            zoomable
            className="!bg-background/80"
          />
        </ReactFlow>
      </div>

      {selectedNode && (
        <NodeProperties
          nodeId={selectedNode.id}
          nodeType={selectedNode.type ?? "message"}
          data={selectedNode.data as FlowNodeData}
          onChange={handleNodeDataChange}
          onClose={() => setSelectedNodeId(null)}
          onDelete={handleDeleteNode}
        />
      )}
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}