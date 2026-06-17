import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import type { Blueprint } from "../types";

export interface BlueprintGraphNode {
  id: string;
  label: string;
  layer: string;
  kind?: string;
}

export interface BlueprintGraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  confidence?: number;
  status?: string;
  color?: string;
}

export interface BlueprintGraphData {
  nodes: BlueprintGraphNode[];
  edges: BlueprintGraphEdge[];
}

export function BlueprintGraph({
  blueprint,
  graph,
  selectedNodeId,
  onNodeClick,
}: {
  blueprint?: Blueprint;
  graph?: BlueprintGraphData;
  selectedNodeId?: string;
  onNodeClick?: (nodeId: string) => void;
}) {
  const graphNodes = graph?.nodes?.length
    ? graph.nodes
    : (blueprint?.nodes?.length ? blueprint.nodes.map((node): BlueprintGraphNode => ({ id: node.id, label: node.label, layer: node.layer, kind: node.layer })) : fallbackNodes);
  const graphEdges: BlueprintGraphEdge[] = graph?.nodes?.length
    ? graph.edges
    : (blueprint?.edges?.length ? blueprint.edges.map((edge): BlueprintGraphEdge => ({ ...edge })) : fallbackEdges);
  const nodes = layoutBlueprintGraphNodes(graphNodes, selectedNodeId);
  const edges: Edge[] = graphEdges.map((edge) => ({
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
    animated: edge.status !== "confirmed",
    className: (edge.confidence ?? 0.5) > 0.7 ? "edge-high" : "edge-low",
    style: edge.color ? { stroke: edge.color, strokeWidth: 1.8 } : undefined,
  }));
  return (
    <div className="blueprint-graph">
      <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={(_, node) => onNodeClick?.(node.id)}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function layoutBlueprintGraphNodes(graphNodes: BlueprintGraphNode[], selectedNodeId?: string): Node[] {
  const layerIndexes = new Map<string, number>();
  const dataNodes = graphNodes.map((node) => {
    const layerIndex = layerIndexes.get(node.layer) ?? 0;
    layerIndexes.set(node.layer, layerIndex + 1);
    return {
      id: node.id,
      data: { label: displayBlueprintGraphNodeLabel(node) },
      position: layerPosition(node.layer, layerIndex),
      className: `flow-node flow-${flowClass(node.kind ?? node.layer)} ${selectedNodeId === node.id ? "selected" : ""}`,
    };
  });
  return [...layoutBlueprintColumnHeaders(graphNodes), ...dataNodes];
}

function layerPosition(layer: string, index: number) {
  const dynamicMatch = /^dynamic_(\d+)$/i.exec(layer);
  if (dynamicMatch) {
    return { x: (Number(dynamicMatch[1]) + 1) * BLUEPRINT_GRAPH_COLUMN_WIDTH, y: BLUEPRINT_GRAPH_NODE_TOP + index * BLUEPRINT_GRAPH_ROW_HEIGHT };
  }
  const x = {
    group: 0,
    sample: BLUEPRINT_GRAPH_COLUMN_WIDTH,
    biological_replicate: BLUEPRINT_GRAPH_COLUMN_WIDTH * 2,
    pool: BLUEPRINT_GRAPH_COLUMN_WIDTH * 3,
    label: BLUEPRINT_GRAPH_COLUMN_WIDTH * 4,
    preparation: BLUEPRINT_GRAPH_COLUMN_WIDTH * 5,
    fractionation: BLUEPRINT_GRAPH_COLUMN_WIDTH * 5,
    acquisition_method: BLUEPRINT_GRAPH_COLUMN_WIDTH * 6,
    technical_replicate: BLUEPRINT_GRAPH_COLUMN_WIDTH * 7,
    assay: BLUEPRINT_GRAPH_COLUMN_WIDTH * 8,
    file: BLUEPRINT_GRAPH_COLUMN_WIDTH * 9,
  }[layer as "sample"] ?? 0;
  return { x, y: BLUEPRINT_GRAPH_NODE_TOP + index * BLUEPRINT_GRAPH_ROW_HEIGHT };
}

function layoutBlueprintColumnHeaders(graphNodes: BlueprintGraphNode[]): Node[] {
  const lanes = new Map<string, { layer: string; kind: string; label: string; x: number }>();
  for (const node of graphNodes) {
    const kind = node.kind ?? node.layer;
    const title = blueprintColumnHeader(kind);
    if (!title) continue;
    const x = layerPosition(node.layer, 0).x;
    const key = `${x}:${title}`;
    if (!lanes.has(key)) lanes.set(key, { layer: node.layer, kind, label: title, x });
  }
  return [...lanes.values()]
    .sort((left, right) => left.x - right.x || left.label.localeCompare(right.label))
    .map((lane) => ({
      id: `column-head-${flowClass(lane.layer)}-${flowClass(lane.kind)}`,
      data: { label: lane.label },
      position: { x: lane.x, y: 20 },
      selectable: false,
      draggable: false,
      className: "flow-node flow-column-head",
    }));
}

export function displayBlueprintGraphNodeLabel(node: BlueprintGraphNode): string {
  const label = node.label.trim();
  const kind = flowClass(node.kind ?? node.layer);
  const cleanLabel = kind === "group"
    ? label.split("\n")[0] ?? label
    : label.replace(/^(Sample|Bio rep|Biological replicate|Pool|Pool members|Label|Fractionation|Fraction|Preparation|Acquisition|Tech rep|Technical replicate|Assay|Assay name|Raw file):\s*/i, "");
  return compactBlueprintGraphNodeLabel(cleanLabel, kind);
}

function compactBlueprintGraphNodeLabel(label: string, kind: string): string {
  const maxLength = kind === "file" || kind === "assay" || kind === "data-file" || kind === "datafile" ? 50 : 42;
  if (label.length <= maxLength) return label;
  const tailLength = kind === "file" || kind === "assay" || kind === "data-file" || kind === "datafile" ? 16 : 12;
  const headLength = Math.max(12, maxLength - tailLength - 3);
  return `${label.slice(0, headLength).trimEnd()}...${label.slice(-tailLength).trimStart()}`;
}

function blueprintColumnHeader(kind: string): string {
  const normalized = flowClass(kind);
  if (normalized === "group") return "Sample group";
  if (normalized === "sample") return "Sample";
  if (normalized === "biological-replicate" || normalized === "biologicalreplicate") return "Biological replicate";
  if (normalized === "pool" || normalized === "aggregation") return "Pool";
  if (normalized === "label" || normalized === "label-channel" || normalized === "labelchannel") return "Label";
  if (normalized === "preparation" || normalized === "fractionation") return "Fractionation";
  if (normalized === "acquisition-method" || normalized === "acquisitionmethod") return "Acquisition";
  if (normalized === "technical-replicate" || normalized === "technicalreplicate") return "Technical replicate";
  if (normalized === "assay") return "Assay";
  if (normalized === "file" || normalized === "data-file" || normalized === "datafile") return "Raw file";
  return "";
}

function flowClass(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "node";
}

const BLUEPRINT_GRAPH_COLUMN_WIDTH = 270;
const BLUEPRINT_GRAPH_NODE_TOP = 104;
const BLUEPRINT_GRAPH_ROW_HEIGHT = 82;

const fallbackNodes: BlueprintGraphNode[] = [
  { id: "sample-control", layer: "sample", kind: "sample", label: "Control samples" },
  { id: "sample-disease", layer: "sample", kind: "sample", label: "Disease samples" },
  { id: "prep-fraction", layer: "preparation", kind: "fractionation", label: "Fractionation F1-F3" },
  { id: "assay-runs", layer: "assay", kind: "assay", label: "Assay runs" },
  { id: "file-raw", layer: "file", kind: "file", label: "Raw files" },
];

const fallbackEdges: BlueprintGraphEdge[] = [
  { id: "e1", source_id: "sample-control", target_id: "prep-fraction", confidence: 0.8, status: "suggested" },
  { id: "e2", source_id: "sample-disease", target_id: "prep-fraction", confidence: 0.7, status: "suggested" },
  { id: "e3", source_id: "prep-fraction", target_id: "assay-runs", confidence: 0.65, status: "suggested" },
  { id: "e4", source_id: "assay-runs", target_id: "file-raw", confidence: 0.55, status: "suggested" },
];
