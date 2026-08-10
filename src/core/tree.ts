/**
 * Tree operations. Every mutation follows the same shape — clone, mutate the clone,
 * return a new root — which buys three things:
 *  - React sees a new reference and re-renders;
 *  - an undo snapshot is simply the previous root (the structure is immutable from
 *    the outside);
 *  - `null` in the result means "the operation is impossible", so history is left
 *    untouched.
 */

import { nextId } from './ids';
import { labelNamesFrom } from './matchers';
import type { Matcher, RouteNode } from './types';

export interface Located {
  node: RouteNode;
  parent: RouteNode | null;
  index: number;
  /** Chain of ancestors from the root, excluding the node itself. */
  chain: RouteNode[];
}

export function emptyRoot(): RouteNode {
  return makeNode({ isRoot: true, matchers: [] });
}

export function makeNode(init: Partial<RouteNode> = {}): RouteNode {
  return {
    id: nextId(),
    isRoot: false,
    receiver: null,
    matchers: [],
    continue: false,
    repeatInterval: '',
    groupWait: '',
    groupInterval: '',
    groupBy: null,
    muteTimeIntervals: null,
    activeTimeIntervals: null,
    extra: {},
    routes: [],
    collapsed: false,
    ...init,
  };
}

export function makeMatcher(raw = 'label="value"'): Matcher {
  return { id: nextId('m'), raw, origin: 'matchers' };
}

export function locate(root: RouteNode, id: string): Located | null {
  if (root.id === id) return { node: root, parent: null, index: -1, chain: [] };
  const walk = (node: RouteNode, chain: RouteNode[]): Located | null => {
    for (let i = 0; i < node.routes.length; i += 1) {
      const child = node.routes[i];
      if (child.id === id) return { node: child, parent: node, index: i, chain: [...chain, node] };
      const found = walk(child, [...chain, node]);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []);
}

export function cloneTree(root: RouteNode): RouteNode {
  return structuredClone(root);
}

type Mutator = (clone: RouteNode) => boolean;

function withTree(root: RouteNode, mutate: Mutator): RouteNode | null {
  const clone = cloneTree(root);
  return mutate(clone) ? clone : null;
}

/* ------------------------------- structure ------------------------------- */

export function moveUp(root: RouteNode, id: string): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc?.parent || loc.index <= 0) return false;
    const arr = loc.parent.routes;
    [arr[loc.index - 1], arr[loc.index]] = [arr[loc.index], arr[loc.index - 1]];
    return true;
  });
}

export function moveDown(root: RouteNode, id: string): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc?.parent || loc.index < 0 || loc.index >= loc.parent.routes.length - 1) return false;
    const arr = loc.parent.routes;
    [arr[loc.index + 1], arr[loc.index]] = [arr[loc.index], arr[loc.index + 1]];
    return true;
  });
}

/** Makes the route a child of its previous sibling. */
export function indentNode(root: RouteNode, id: string): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc?.parent || loc.index <= 0) return false;
    const prev = loc.parent.routes[loc.index - 1];
    const [moved] = loc.parent.routes.splice(loc.index, 1);
    prev.routes.push(moved);
    prev.collapsed = false;
    return true;
  });
}

/** Lifts the route one level up, right after its former parent. */
export function outdentNode(root: RouteNode, id: string): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc?.parent || loc.chain.length < 2) return false;
    const grandparent = loc.chain[loc.chain.length - 2];
    const parentIndex = grandparent.routes.indexOf(loc.parent);
    if (parentIndex < 0) return false;
    const [moved] = loc.parent.routes.splice(loc.index, 1);
    grandparent.routes.splice(parentIndex + 1, 0, moved);
    return true;
  });
}

export function addChild(root: RouteNode, id: string): { root: RouteNode; newId: string } | null {
  const created = makeNode({ matchers: [makeMatcher()] });
  const next = withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc) return false;
    loc.node.routes.push(structuredClone(created));
    loc.node.collapsed = false;
    return true;
  });
  return next ? { root: next, newId: created.id } : null;
}

export function addSibling(root: RouteNode, id: string): { root: RouteNode; newId: string } | null {
  const created = makeNode({ matchers: [makeMatcher()] });
  const next = withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc?.parent) return false;
    loc.parent.routes.splice(loc.index + 1, 0, structuredClone(created));
    return true;
  });
  return next ? { root: next, newId: created.id } : null;
}

export function removeNode(root: RouteNode, id: string): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc?.parent) return false;
    loc.parent.routes.splice(loc.index, 1);
    return true;
  });
}

/** Moves a route under a different parent (graph drag&drop / "make child of"). */
export function reparent(
  root: RouteNode,
  id: string,
  newParentId: string,
  position = -1,
): RouteNode | null {
  if (id === newParentId) return null;
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc?.parent) return false;
    // A route can never be moved inside its own subtree.
    if (locate(loc.node, newParentId)) return false;
    const target = locate(t, newParentId);
    if (!target) return false;
    const [moved] = loc.parent.routes.splice(loc.index, 1);
    const at = position < 0 ? target.node.routes.length : position;
    target.node.routes.splice(at, 0, moved);
    target.node.collapsed = false;
    return true;
  });
}

/* ------------------------------ route fields ------------------------------ */

export function patchNode(
  root: RouteNode,
  id: string,
  patch: Partial<Omit<RouteNode, 'id' | 'routes' | 'matchers'>>,
): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc) return false;
    Object.assign(loc.node, patch);
    return true;
  });
}

export function setMatcherRaw(
  root: RouteNode,
  id: string,
  matcherId: string,
  raw: string,
): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    const m = loc?.node.matchers.find((x) => x.id === matcherId);
    if (!m) return false;
    m.raw = raw;
    return true;
  });
}

export function addMatcher(root: RouteNode, id: string): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc) return false;
    loc.node.matchers.push(makeMatcher());
    return true;
  });
}

export function removeMatcher(root: RouteNode, id: string, matcherId: string): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc) return false;
    const i = loc.node.matchers.findIndex((x) => x.id === matcherId);
    if (i < 0) return false;
    loc.node.matchers.splice(i, 1);
    return true;
  });
}

export function toggleCollapsed(root: RouteNode, id: string): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc) return false;
    loc.node.collapsed = !loc.node.collapsed;
    return true;
  });
}

export function setCollapsedAll(root: RouteNode, collapsed: boolean): RouteNode {
  const clone = cloneTree(root);
  const walk = (n: RouteNode, depth: number): void => {
    if (n.routes.length > 0) n.collapsed = collapsed && depth > 0;
    n.routes.forEach((c) => walk(c, depth + 1));
  };
  walk(clone, 0);
  return clone;
}

/** Expands every ancestor so the selected route is actually visible. */
export function expandTo(root: RouteNode, id: string): RouteNode | null {
  return withTree(root, (t) => {
    const loc = locate(t, id);
    if (!loc) return false;
    let changed = false;
    for (const a of loc.chain) {
      if (a.collapsed) {
        a.collapsed = false;
        changed = true;
      }
    }
    return changed;
  });
}

/* -------------------------------- analysis -------------------------------- */

export function walkTree(root: RouteNode, visit: (node: RouteNode, depth: number) => void): void {
  const go = (n: RouteNode, d: number): void => {
    visit(n, d);
    n.routes.forEach((c) => go(c, d + 1));
  };
  go(root, 0);
}

export function countNodes(root: RouteNode): number {
  let n = 0;
  walkTree(root, () => {
    n += 1;
  });
  return n;
}

export function treeDepth(root: RouteNode): number {
  let max = 0;
  walkTree(root, (_n, d) => {
    max = Math.max(max, d);
  });
  return max;
}

/** Receiver names actually used somewhere in the tree. */
export function receiversInTree(root: RouteNode): string[] {
  const out: string[] = [];
  walkTree(root, (n) => {
    if (n.receiver) out.push(n.receiver);
  });
  return [...new Set(out)];
}

/** Label names taken from matchers — autocomplete for the alert-test panel. */
export function labelNamesInTree(root: RouteNode): string[] {
  const out: string[] = [];
  walkTree(root, (n) => out.push(...labelNamesFrom(n.matchers)));
  return [...new Set(out)].sort();
}

export interface InvalidMatcher {
  nodeId: string;
  matcherId: string;
  raw: string;
  error: string;
}
