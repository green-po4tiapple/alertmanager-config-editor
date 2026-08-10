/**
 * Structural comparison of the tree against its state at load time.
 *
 * The comparison keys off node `id`s rather than YAML text: ids live only in
 * memory and survive edits (mutations clone the tree along with its ids), which is
 * what lets "same route, moved" be distinguished from "brand new route".
 */

import { dict } from '../i18n/dict';
import type { RouteNode } from './types';

export type ChangeKind = 'added' | 'modified' | 'moved' | 'moved-modified';

export interface TreeChanges {
  /** Changed nodes: id → what happened to it. */
  changed: Map<string, ChangeKind>;
  /** Nodes that must stay expanded for the changes to be reachable. */
  keep: Set<string>;
  /** How many routes were deleted (nothing left to highlight for those). */
  removed: number;
  hasChanges: boolean;
}

interface Snapshot {
  node: RouteNode;
  parentId: string | null;
  index: number;
}

function index(root: RouteNode): Map<string, Snapshot> {
  const map = new Map<string, Snapshot>();
  const walk = (node: RouteNode, parentId: string | null, i: number): void => {
    map.set(node.id, { node, parentId, index: i });
    node.routes.forEach((c, ci) => walk(c, node.id, ci));
  };
  walk(root, null, 0);
  return map;
}

/** Fields whose edits show up in the export (`collapsed` is pure UI, ignored). */
function fingerprint(node: RouteNode): string {
  return JSON.stringify([
    node.receiver,
    node.matchers.map((m) => [m.origin, m.raw]),
    node.continue,
    node.repeatInterval,
    node.groupWait,
    node.groupInterval,
    node.groupBy,
    node.muteTimeIntervals,
    node.activeTimeIntervals,
    node.extra,
  ]);
}

export function diffTrees(baseline: RouteNode, current: RouteNode): TreeChanges {
  const before = index(baseline);
  const after = index(current);

  const changed = new Map<string, ChangeKind>();
  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) {
      changed.set(id, 'added');
      continue;
    }
    const fieldsChanged = fingerprint(was.node) !== fingerprint(now.node);
    const positionChanged = was.parentId !== now.parentId || was.index !== now.index;
    if (fieldsChanged && positionChanged) changed.set(id, 'moved-modified');
    else if (fieldsChanged) changed.set(id, 'modified');
    else if (positionChanged) changed.set(id, 'moved');
  }

  let removed = 0;
  for (const id of before.keys()) if (!after.has(id)) removed += 1;

  // Ancestors of changed routes have to stay visible, otherwise the edit itself
  // cannot be reached in the tree.
  const keep = new Set<string>(changed.keys());
  for (const id of changed.keys()) {
    let cursor = after.get(id)?.parentId ?? null;
    while (cursor) {
      keep.add(cursor);
      cursor = after.get(cursor)?.parentId ?? null;
    }
  }

  return { changed, keep, removed, hasChanges: changed.size > 0 || removed > 0 };
}

export function changeLabel(kind: ChangeKind): string {
  return dict().change[kind];
}
