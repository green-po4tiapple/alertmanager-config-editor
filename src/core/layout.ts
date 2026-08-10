/**
 * Tree layout for the vertical graph view: root on top, children fanning downwards
 * (an org chart).
 *
 * The algorithm is a simplified tidy-tree: leaves are placed left to right along a
 * cursor, and a parent is centred above its children. Row height is the tallest
 * node on that level, so routes with many matchers never overlap each other.
 */

import type { RouteNode } from './types';

export const NODE_WIDTH = 232;
export const MAX_MATCHER_LINES = 4;
const GAP_X = 24;
const GAP_Y = 44;
const NODE_PAD_Y = 30;
const LINE_H = 15;

export interface GraphNode {
  id: string;
  node: RouteNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** How many matchers are shown, and how many are hidden behind "+N". */
  shownMatchers: number;
  hiddenMatchers: number;
  hasChildren: boolean;
  collapsed: boolean;
  hiddenSubtree: number;
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  /** Ready-made SVG path: vertical → horizontal → vertical (orthogonal links). */
  path: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export function nodeHeight(node: RouteNode): number {
  const lines = node.matchers.length === 0 ? 1 : Math.min(node.matchers.length, MAX_MATCHER_LINES);
  const extraLine = node.matchers.length > MAX_MATCHER_LINES ? 1 : 0;
  return NODE_PAD_Y + (lines + extraLine) * LINE_H;
}

function subtreeSize(node: RouteNode): number {
  let n = 0;
  const go = (x: RouteNode): void => {
    n += 1;
    x.routes.forEach(go);
  };
  node.routes.forEach(go);
  return n;
}

export function layoutTree(root: RouteNode): GraphLayout {
  const nodes: GraphNode[] = [];
  const pairs: Array<[string, string]> = [];
  const rowHeight: number[] = [];
  let cursor = 0;

  const walk = (node: RouteNode, depth: number): GraphNode => {
    const h = nodeHeight(node);
    rowHeight[depth] = Math.max(rowHeight[depth] ?? 0, h);

    const visibleChildren = node.collapsed ? [] : node.routes;
    const laidChildren = visibleChildren.map((c) => {
      pairs.push([node.id, c.id]);
      return walk(c, depth + 1);
    });

    let x: number;
    if (laidChildren.length === 0) {
      x = cursor;
      cursor += NODE_WIDTH + GAP_X;
    } else {
      const first = laidChildren[0];
      const last = laidChildren[laidChildren.length - 1];
      x = (first.x + last.x) / 2;
      // The parent may end up to the right of the cursor — move the cursor along so
      // the next subtree does not overlap it.
      cursor = Math.max(cursor, x + NODE_WIDTH + GAP_X);
    }

    const laid: GraphNode = {
      id: node.id,
      node,
      x,
      y: 0,
      w: NODE_WIDTH,
      h,
      depth,
      shownMatchers: Math.min(node.matchers.length, MAX_MATCHER_LINES),
      hiddenMatchers: Math.max(0, node.matchers.length - MAX_MATCHER_LINES),
      hasChildren: node.routes.length > 0,
      collapsed: node.collapsed && node.routes.length > 0,
      hiddenSubtree: node.collapsed ? subtreeSize(node) : 0,
    };
    nodes.push(laid);
    return laid;
  };

  walk(root, 0);

  // Vertical positions of the rows.
  const rowY: number[] = [];
  let acc = 0;
  for (let d = 0; d < rowHeight.length; d += 1) {
    rowY[d] = acc;
    acc += (rowHeight[d] ?? 0) + GAP_Y;
  }
  const byId = new Map<string, GraphNode>();
  for (const n of nodes) {
    n.y = rowY[n.depth];
    byId.set(n.id, n);
  }

  const edges: GraphEdge[] = pairs.map(([fromId, toId]) => {
    const p = byId.get(fromId)!;
    const c = byId.get(toId)!;
    const sx = p.x + p.w / 2;
    const sy = p.y + p.h;
    const tx = c.x + c.w / 2;
    const ty = c.y;
    const my = sy + Math.max(12, (ty - sy) / 2);
    return {
      id: `${fromId}->${toId}`,
      fromId,
      toId,
      path:
        Math.abs(tx - sx) < 0.5
          ? `M ${sx} ${sy} L ${tx} ${ty}`
          : `M ${sx} ${sy} V ${my} H ${tx} V ${ty}`,
    };
  });

  const width = Math.max(NODE_WIDTH, cursor - GAP_X);
  const height = acc - GAP_Y;
  return { nodes, edges, width, height };
}
