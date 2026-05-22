// d3-force-3d ships no published @types; this stub covers only the surface we use.
declare module 'd3-force-3d' {
  interface ForceCollide<NodeType> {
    (alpha: number): void;
    initialize?: (nodes: NodeType[]) => void;
    radius(): (node: NodeType) => number;
    radius(radius: number | ((node: NodeType) => number)): ForceCollide<NodeType>;
  }
  export function forceCollide<NodeType>(radius?: number | ((node: NodeType) => number)): ForceCollide<NodeType>;
}
