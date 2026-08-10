/**
 * Radial tree layout — the same shape as the official
 * https://prometheus.io/webtools/alerting/routing-tree-editor/ :
 * root in the centre, levels fanning out as rings, links drawn as smooth arcs
 * (the equivalent of d3.tree + d3.linkRadial), labels oriented along the radius.
 *
 * Difference from the org-chart layout (`layout.ts`): nodes here are compact (a dot
 * plus a label), so a whole real-world tree fits on screen instead of stretching to
 * 17,000 px.
 */

import { dict } from '../i18n/dict';
import type { RouteNode } from './types';

const TAU = Math.PI * 2;
/** Minimum arc length per leaf, so labels do not overlap. */
const MIN_ARC_PER_LEAF = 24;
const MIN_RING_STEP = 120;
/** Margin around the canvas reserved for labels. */
export const RADIAL_LABEL_SPACE = 210;

export interface RadialNode {
  id: string;
  node: RouteNode;
  depth: number;
  /** Radians; 0 points up, angles increase clockwise. */
  angle: number;
  radius: number;
  /** Cartesian coordinates relative to the centre. */
  x: number;
  y: number;
  hasChildren: boolean;
  collapsed: boolean;
  hiddenSubtree: number;
  isLeaf: boolean;
}

export interface RadialEdge {
  id: string;
  fromId: string;
  toId: string;
  path: string;
}

export interface RadialLayout {
  nodes: RadialNode[];
  edges: RadialEdge[];
  /** Radius of the outermost ring. */
  maxRadius: number;
  /** Side of the square canvas, label margin included. */
  size: number;
  /** Centre of the canvas. */
  center: number;
}

function polar(angle: number, radius: number): [number, number] {
  return [radius * Math.sin(angle), -radius * Math.cos(angle)];
}

function countVisibleLeaves(node: RouteNode): number {
  const children = node.collapsed ? [] : node.routes;
  if (children.length === 0) return 1;
  return children.reduce((sum, c) => sum + countVisibleLeaves(c), 0);
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

function maxVisibleDepth(node: RouteNode, depth = 0): number {
  const children = node.collapsed ? [] : node.routes;
  if (children.length === 0) return depth;
  return Math.max(...children.map((c) => maxVisibleDepth(c, depth + 1)));
}

export function layoutRadial(root: RouteNode): RadialLayout {
  const leafCount = Math.max(1, countVisibleLeaves(root));
  const depth = Math.max(1, maxVisibleDepth(root));

  // Every leaf gets the same angular slot, but arc length grows with radius, so a
  // leaf on an inner ring is the first to suffer: on a real config thirteen "null"
  // routes at level one collapsed into an unreadable smear.
  //
  // Inflating every ring to fix that is the wrong trade: the canvas grows and
  // "fit to screen" drops to an unreadable 43%. So rings stay compact and only the
  // CROWDED LEAVES are pushed out to the first ring where their labels fit. Inner
  // nodes stay exactly at their own depth, so the structure still reads the same.
  const ringStep = Math.max(MIN_RING_STEP, (leafCount * MIN_ARC_PER_LEAF) / TAU / depth);
  const minLeafRing = Math.min(
    depth,
    Math.max(1, Math.ceil((leafCount * MIN_ARC_PER_LEAF) / TAU / ringStep)),
  );
  const maxRadius = ringStep * Math.max(depth, minLeafRing);

  const nodes: RadialNode[] = [];
  const pairs: Array<[string, string]> = [];
  let leafIndex = 0;

  const walk = (node: RouteNode, d: number): RadialNode => {
    const children = node.collapsed ? [] : node.routes;
    const laid = children.map((c) => {
      pairs.push([node.id, c.id]);
      return walk(c, d + 1);
    });

    let angle: number;
    const isLeaf = laid.length === 0;
    if (isLeaf) {
      angle = ((leafIndex + 0.5) / leafCount) * TAU;
      leafIndex += 1;
    } else {
      angle = (laid[0].angle + laid[laid.length - 1].angle) / 2;
    }

    const radius = (isLeaf ? Math.max(d, minLeafRing) : d) * ringStep;
    const [x, y] = polar(angle, radius);
    const entry: RadialNode = {
      id: node.id,
      node,
      depth: d,
      angle,
      radius,
      x,
      y,
      hasChildren: node.routes.length > 0,
      collapsed: node.collapsed && node.routes.length > 0,
      hiddenSubtree: node.collapsed ? subtreeSize(node) : 0,
      isLeaf: children.length === 0,
    };
    nodes.push(entry);
    return entry;
  };

  walk(root, 0);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: RadialEdge[] = pairs.map(([fromId, toId]) => {
    const a = byId.get(fromId)!;
    const b = byId.get(toId)!;
    const mid = (a.radius + b.radius) / 2;
    const [x1, y1] = polar(a.angle, a.radius);
    const [cx1, cy1] = polar(a.angle, mid);
    const [cx2, cy2] = polar(b.angle, mid);
    const [x2, y2] = polar(b.angle, b.radius);
    return {
      id: `${fromId}->${toId}`,
      fromId,
      toId,
      path: `M ${r(x1)} ${r(y1)} C ${r(cx1)} ${r(cy1)} ${r(cx2)} ${r(cy2)} ${r(x2)} ${r(y2)}`,
    };
  });

  const size = (maxRadius + RADIAL_LABEL_SPACE) * 2;
  return { nodes, edges, maxRadius, size, center: size / 2 };
}

function r(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Node label: the receiver name, as in the original tool. */
export function radialLabel(node: RouteNode): { text: string; kind: 'receiver' | 'null' | 'matcher' | 'root' } {
  // The root is labelled by its own receiver — as in the original editor, where
  // "null" sits in the centre.
  if (node.receiver === 'null') return { text: 'null', kind: 'null' };
  if (node.receiver) return { text: node.receiver, kind: 'receiver' };
  if (node.isRoot) return { text: 'route', kind: 'root' };
  const first = node.matchers[0]?.raw ?? dict().batch.noMatchers;
  return { text: first, kind: 'matcher' };
}

/** Label rotation in degrees, plus whether the label must be flipped. */
export function labelTransform(angle: number): { deg: number; flip: boolean } {
  const deg = (angle * 180) / Math.PI - 90;
  return { deg, flip: angle > Math.PI };
}
