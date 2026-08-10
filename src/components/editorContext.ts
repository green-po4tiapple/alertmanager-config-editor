import { createContext, useContext } from 'react';
import type { ChangeKind } from '../core/treeDiff';
import type { RouteNode } from '../core/types';

export type MoveDirection = 'up' | 'down' | 'indent' | 'outdent';

export type NodePatch = Partial<Omit<RouteNode, 'id' | 'routes' | 'matchers'>>;

/**
 * One editing API shared by both views. The block list and the graph perform the
 * same operations on the same model — that is what keeps the two views honestly
 * interchangeable rather than two half-implementations.
 */
export interface EditorApi {
  /** Every known receiver name — for autocomplete. */
  knownReceivers: string[];
  /** Names from the pasted config's `receivers:` block, to flag unknown ones. */
  configReceivers: string[];
  selectedId: string | null;
  /** Nodes on the paths walked by the last alert test. */
  pathIds: Set<string>;
  /** Terminal routes of the last alert test. */
  targetIds: Set<string>;
  /** Routes found by the search. */
  searchIds: Set<string>;
  /** What changed relative to the tree as of load time. */
  changes: Map<string, ChangeKind>;
  /** The "changed routes only" filter is on. */
  onlyChanged: boolean;
  /** Nodes to show under that filter (the edits plus their ancestors). */
  changedVisible: Set<string>;
  select: (id: string | null) => void;
  /** Field edit. `session` is the key of a text-editing session. */
  patch: (id: string, patch: NodePatch, session?: string) => void;
  endSession: () => void;
  setMatcher: (id: string, matcherId: string, raw: string, session?: string) => void;
  addMatcher: (id: string) => void;
  removeMatcher: (id: string, matcherId: string) => void;
  move: (id: string, dir: MoveDirection) => void;
  /** Re-attach a route to a new parent (graph drag&drop). */
  reparent: (id: string, newParentId: string) => void;
  addChild: (id: string) => void;
  addSibling: (id: string) => void;
  remove: (id: string) => void;
  toggleCollapse: (id: string) => void;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  // Developer-facing only: this can fire only if a component is rendered outside
  // the provider, which is a wiring bug, never something a user can trigger.
  if (!api) throw new Error('EditorContext is missing above this component');
  return api;
}
