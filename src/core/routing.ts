/**
 * Alertmanager routing semantics.
 *
 * The reference is `(*Route).Match` from Alertmanager's dispatch/route.go:
 *
 *   func (r *Route) Match(lset model.LabelSet) []*Route {
 *       if !r.Matchers.Matches(lset) { return nil }
 *       var all []*Route
 *       for _, cr := range r.Routes {
 *           matches := cr.Match(lset)
 *           all = append(all, matches...)
 *           if matches != nil && !cr.Continue { break }
 *       }
 *       // If no child nodes were matches, the current node itself is a match.
 *       if len(all) == 0 { all = append(all, r) }
 *       return all
 *   }
 *
 * Key properties (see docs/ROUTING-SEMANTICS.md):
 *  - `receiver` is NOT inherited from the parent;
 *  - matchers within one route are AND-ed;
 *  - sibling order matters: the first matching sibling without `continue` stops
 *    the scan;
 *  - `continue: true` can give a single alert several receivers.
 */

import { dict } from '../i18n/dict';
import { matchersPass, type Labels } from './matchers';
import type { MatchResult, Outcome, RouteNode } from './types';

export function matchTree(root: RouteNode, labels: Labels): MatchResult[] {
  return matchNode(root, labels, []);
}

function matchNode(route: RouteNode, labels: Labels, pathSoFar: RouteNode[]): MatchResult[] {
  if (!matchersPass(route.matchers, labels)) return [];

  const myPath = [...pathSoFar, route];
  const all: MatchResult[] = [];

  for (const child of route.routes) {
    const matched = matchNode(child, labels, myPath);
    if (matched.length > 0) {
      all.push(...matched);
      // First matching sibling without `continue` ends the scan over siblings.
      if (!child.continue) break;
    }
  }

  // No child matched (or there are none): the route itself becomes the match.
  // Unconditionally so — there is no `continue` check here, see route.go above.
  if (all.length === 0) return [{ node: route, path: myPath }];
  return all;
}

/** Where an alert that landed on this route actually ends up. */
export function classifyOutcome(node: RouteNode): Outcome {
  const r = node.receiver;
  if (r === null || r.trim() === '') return 'drop-no-receiver';
  if (r === 'null') return 'drop-null';
  return 'delivered';
}

export function outcomeLabel(outcome: Outcome): string {
  return dict().outcome[outcome].label;
}

export function outcomeNote(outcome: Outcome): string {
  return dict().outcome[outcome].note;
}

/** Every node lying on a matched path — used for highlighting in both views. */
export function collectHighlight(results: MatchResult[]): {
  pathIds: Set<string>;
  targetIds: Set<string>;
} {
  const pathIds = new Set<string>();
  const targetIds = new Set<string>();
  for (const r of results) {
    for (const n of r.path) pathIds.add(n.id);
    targetIds.add(r.node.id);
  }
  return { pathIds, targetIds };
}
