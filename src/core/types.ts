/**
 * The routing-tree model. The very same model backs both the block view and the
 * graph view — see docs/ARCHITECTURE.md.
 */

export type MatcherOp = '=' | '!=' | '=~' | '!~';

/** Where a matcher came from: modern `matchers:` or legacy `match:` / `match_re:`. */
export type MatcherOrigin = 'matchers' | 'match' | 'match_re';

export interface Matcher {
  id: string;
  /** Exactly the text that will go back into the YAML (for origin === 'matchers'). */
  raw: string;
  origin: MatcherOrigin;
}

export interface RouteNode {
  id: string;
  isRoot: boolean;
  /**
   * `null` — the route has no `receiver:` key at all (the alert is lost silently if
   * no child matched). The string `'null'` is a receiver NAME (a deliberate drop).
   * An empty string is normalised to `null` while editing.
   */
  receiver: string | null;
  matchers: Matcher[];
  /** `continue: true` — after a match, processing moves on to the next siblings. */
  continue: boolean;
  /** '' means the key is absent. */
  repeatInterval: string;
  groupWait: string;
  groupInterval: string;
  /** `null` means there is no `group_by:` key. */
  groupBy: string[] | null;
  muteTimeIntervals: string[] | null;
  activeTimeIntervals: string[] | null;
  /** Route keys the editor does not know — kept verbatim for the export. */
  extra: Record<string, unknown>;
  routes: RouteNode[];
  /** UI only: whether the route is collapsed in the view. */
  collapsed: boolean;
}

/** One match: the terminal route plus the path from the root down to it. */
export interface MatchResult {
  node: RouteNode;
  path: RouteNode[];
}

export type Outcome =
  /** The route carries a real receiver name. */
  | 'delivered'
  /** receiver: "null" — a deliberate drop. */
  | 'drop-null'
  /** The route has no receiver of its own (key absent or empty) — silent loss. */
  | 'drop-no-receiver';
