import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
// d3-force-3d ships no published @types — typed locally to avoid `any` casts.
import { forceCollide, forceRadial } from 'd3-force-3d';
import type { EntityNode, EntityType } from '../../../main/memory/graph';
import { GraphToolbar } from './GraphToolbar';
import { EntityDetailPanel } from './EntityDetailPanel';
import { GraphEmptyState } from './GraphEmptyState';
import { useMemoryGraphScene } from './useMemoryGraphScene';
import { ScrollFade } from '@/components/ui/scroll-fade';

interface Props {
  threadId: string;
}

const TYPE_COLORS: Record<EntityType, string> = {
  file: '#4d9de0',
  symbol: '#3bb273',
  issue: '#e15554',
  decision: '#9b5de5',
  person: '#f18701',
  concept: '#00b4d8',
};

const DEFAULT_COLOR = '#6b7280';

// Fade by graph distance from hovered node.
// hop 0 (the node itself) → 1.0; 1 hop → 0.6; 2 hops → 0.25; ≥3 → 0.05.
const HOP_OPACITY = [1.0, 0.6, 0.25, 0.05];
const MAX_BFS_DEPTH = HOP_OPACITY.length - 1;

function opacityForHop(hop: number | undefined): number {
  if (hop === undefined) return HOP_OPACITY[HOP_OPACITY.length - 1];
  return HOP_OPACITY[Math.min(hop, HOP_OPACITY.length - 1)];
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ForceNode {
  id: string;
  name: string;
  type: string;
  connections: number;
  entity: EntityNode;
}

interface ForceLink {
  id: string;
  source: string | ForceNode;
  target: string | ForceNode;
  relation: string;
  weight: number;
}

function endpointId(end: string | ForceNode): string {
  return typeof end === 'string' ? end : end.id;
}

function readIsDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState<boolean>(readIsDark);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return isDark;
}

export function MemoryGraphView({ threadId }: Props) {
  const scene = useMemoryGraphScene(threadId);
  const isDark = useIsDark();
  const fgRef = useRef<ForceGraphMethods<ForceNode, ForceLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Cache ForceNode/ForceLink objects across renders so d3-force's attached
  // x/y/z/vx/vy/vz persist when scene.nodes/edges update (pagination, filter
  // toggles). Without this, every state update would reset the layout.
  const nodeCacheRef = useRef<Map<string, ForceNode>>(new Map());
  const linkCacheRef = useRef<Map<string, ForceLink>>(new Map());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.offsetWidth, height: el.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const connCount: Record<string, number> = {};
    for (const e of scene.edges) {
      connCount[e.fromId] = (connCount[e.fromId] ?? 0) + 1;
      connCount[e.toId] = (connCount[e.toId] ?? 0) + 1;
    }

    const seenNodes = new Set<string>();
    const nodes: ForceNode[] = scene.nodes.map((entity) => {
      seenNodes.add(entity.id);
      const cached = nodeCacheRef.current.get(entity.id);
      if (cached) {
        // Mutate in place — preserves x/y/z/vx/vy/vz attached by d3-force.
        cached.name = entity.name;
        cached.type = entity.type;
        cached.entity = entity;
        cached.connections = connCount[entity.id] ?? 0;
        return cached;
      }
      const node: ForceNode = {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        entity,
        connections: connCount[entity.id] ?? 0,
      };
      nodeCacheRef.current.set(entity.id, node);
      return node;
    });
    for (const id of nodeCacheRef.current.keys()) {
      if (!seenNodes.has(id)) nodeCacheRef.current.delete(id);
    }

    const seenLinks = new Set<string>();
    const links: ForceLink[] = scene.edges.map((e) => {
      seenLinks.add(e.id);
      const cached = linkCacheRef.current.get(e.id);
      if (cached) {
        // Keep cached source/target — the library may have replaced the
        // string IDs with node-object references after the first tick.
        cached.relation = e.relation;
        cached.weight = e.weight;
        return cached;
      }
      const link: ForceLink = {
        id: e.id,
        source: e.fromId,
        target: e.toId,
        relation: e.relation,
        weight: e.weight,
      };
      linkCacheRef.current.set(e.id, link);
      return link;
    });
    for (const id of linkCacheRef.current.keys()) {
      if (!seenLinks.has(id)) linkCacheRef.current.delete(id);
    }

    return { nodes, links };
  }, [scene.nodes, scene.edges]);

  // Adjacency over string IDs (stable across force-graph's source/target mutations).
  const adjacency = useMemo(() => {
    const adj = new Map<string, string[]>();
    for (const n of scene.nodes) adj.set(n.id, []);
    for (const e of scene.edges) {
      adj.get(e.fromId)?.push(e.toId);
      adj.get(e.toId)?.push(e.fromId);
    }
    return adj;
  }, [scene.nodes, scene.edges]);

  // BFS hop distance from hovered node, depth-limited.
  const distances = useMemo<Map<string, number> | null>(() => {
    if (!hoveredId) return null;
    const dist = new Map<string, number>();
    dist.set(hoveredId, 0);
    let frontier: string[] = [hoveredId];
    for (let depth = 1; depth <= MAX_BFS_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nbr of adjacency.get(id) ?? []) {
          if (!dist.has(nbr)) {
            dist.set(nbr, depth);
            next.push(nbr);
          }
        }
      }
      frontier = next;
    }
    return dist;
  }, [hoveredId, adjacency]);

  // Fit the camera once the simulation has settled, so the node cloud isn't
  // framed out of view (which manifests as an empty canvas).
  const didFitRef = useRef(false);
  const handleEngineStop = useCallback(() => {
    if (didFitRef.current) return;
    const fg = fgRef.current;
    if (!fg) return;
    didFitRef.current = true;
    fg.zoomToFit?.(600, 60);
  }, []);

  // Re-apply detangle forces whenever the library re-initialises the simulation
  // (i.e. whenever the graphData reference changes — pagination, filter toggle,
  // reindex). Depending on graphData itself rather than its length catches the
  // case where node count stays equal but the set of nodes changes.
  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    let cancelled = false;
    // Defer to a frame so the underlying lib has bootstrapped its simulation
    // before we mutate forces. Without this, d3ReheatSimulation can run
    // against an uninitialised layout and crash inside the lib's tick loop.
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const fg = fgRef.current;
      if (!fg) return;
      const charge = fg.d3Force('charge');
      const link = fg.d3Force('link');
      if (!charge || !link) return;
      charge.strength?.(-20);
      link.distance?.(20);
      fg.d3Force(
        'collide',
        forceCollide((n: ForceNode) => 1.5 + Math.sqrt(n.connections) * 0.5)
      );
      // Pull every node toward the origin so the layout collapses into a
      // compact sphere instead of drifting outward.
      fg.d3Force('radial', forceRadial(0).strength(0.075));
      fg.d3ReheatSimulation();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [graphData]);

  const nodeColor = useCallback(
    (node: ForceNode) => {
      const base = TYPE_COLORS[node.type as EntityType] ?? DEFAULT_COLOR;
      if (!distances) return base;
      return hexToRgba(base, opacityForHop(distances.get(node.id)));
    },
    [distances]
  );

  const nodeVal = useCallback(
    (node: ForceNode) => {
      const base = 1 + node.connections * 0.4;
      return node.id === hoveredId ? base * 2.5 : base;
    },
    [hoveredId]
  );

  // Link base color follows theme so edges stay visible in both modes.
  const linkBase = isDark ? '255, 255, 255' : '0, 0, 0';
  const linkIdle = isDark ? 0.18 : 0.22;
  const linkFar = isDark ? 0.02 : 0.04;

  const linkColor = useCallback(
    (link: ForceLink) => {
      if (!distances) return `rgba(${linkBase}, ${linkIdle})`;
      const srcHop = distances.get(endpointId(link.source));
      const tgtHop = distances.get(endpointId(link.target));
      const minHop = Math.min(srcHop ?? Infinity, tgtHop ?? Infinity);
      if (!Number.isFinite(minHop)) return `rgba(${linkBase}, ${linkFar})`;
      return `rgba(${linkBase}, ${opacityForHop(minHop) * 0.8})`;
    },
    [distances, linkBase, linkIdle, linkFar]
  );

  const handleHover = useCallback((node: ForceNode | null) => {
    setHoveredId(node?.id ?? null);
  }, []);

  const handleSelectEntity = scene.handleSelectEntity;
  const handleClick = useCallback(
    (node: ForceNode) => {
      void handleSelectEntity(node.entity);
    },
    [handleSelectEntity]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GraphToolbar
        activeTypes={scene.activeTypes}
        hideOrphans={scene.hideOrphans}
        totalCount={scene.totalCount}
        typeColors={TYPE_COLORS}
        visibleCount={scene.visibleCount}
        onToggleOrphans={scene.toggleOrphans}
        onToggleType={scene.toggleType}
      />
      {scene.error && <div className="px-4 py-2 text-xs text-status-error">{scene.error}</div>}
      <div
        className="relative grid min-h-0 flex-1"
        style={{ gridTemplateColumns: scene.selectedEntity ? '1fr 260px' : '1fr' }}
      >
        <ScrollFade />
        <div ref={containerRef} className="relative min-h-0 bg-background" style={{ minHeight: 400 }}>
          {!scene.hasData && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <GraphEmptyState
                loading={scene.loading}
                entityCount={scene.totalCount}
                onRebuild={() => void scene.handleReindex()}
              />
            </div>
          )}
          {scene.hasData && size.width > 0 && size.height > 0 && (
            <ForceGraph3D<ForceNode, ForceLink>
              ref={fgRef}
              graphData={graphData}
              width={size.width}
              height={size.height}
              backgroundColor={isDark ? '#0a0a0a' : '#ffffff'}
              showNavInfo={false}
              numDimensions={3}
              cooldownTicks={300}
              d3AlphaDecay={0.015}
              d3VelocityDecay={0.3}
              nodeRelSize={4}
              nodeVal={nodeVal}
              nodeColor={nodeColor}
              nodeLabel={(n: ForceNode) => `${n.name} (${n.type})`}
              linkColor={linkColor}
              linkOpacity={1}
              onNodeHover={handleHover}
              onNodeClick={handleClick}
              onEngineStop={handleEngineStop}
            />
          )}
        </div>
        {scene.selectedEntity && (
          <EntityDetailPanel entity={scene.selectedEntity} chunks={scene.selectedChunks} typeColors={TYPE_COLORS} />
        )}
      </div>
    </div>
  );
}
