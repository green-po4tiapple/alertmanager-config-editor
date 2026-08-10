/**
 * Batch check: a list of alerts → where each one ends up.
 *
 * Alertmanager routing is deterministic: for a given label set there is exactly
 * one route. So a route is shown ONLY when the label set is fully known:
 *
 *   - firing alerts and CSV — the labels are real;
 *   - Prometheus rules — first expanded into real series by querying the TSDB
 *     (`enrich.ts`), and only then routed.
 *
 * A rule on its own is not an alert but a template: it carries only static
 * `labels:`, while `namespace`, `job`, `pod` appear at fire time. Computing a route
 * for it "as if those labels did not exist" would be guesswork, so unresolved rules
 * get no route at all. What they get instead is a precise statement of which labels
 * the tree asks about and without which the question has no answer
 * (`neededLabels`).
 */

import { dict } from '../i18n/dict';
import { evalMatcher, parseMatcher, type Labels } from './matchers';
import { classifyOutcome } from './routing';
import type { MatchResult, Matcher, Outcome, RouteNode } from './types';
import type { AlertSpec } from './alertSources';

export interface Ambiguity {
  nodeId: string;
  kind: 'could-match' | 'could-unmatch';
  /** The route's matchers that caused the uncertainty. */
  matchers: string[];
  /** Unknown labels that were missing for a definite answer. */
  labels: string[];
}

/**
 * Row state. Only `exact` carries a route.
 *
 *   `exact`      — the label set is complete, the route is unambiguous;
 *   `no-series`  — the rule currently yields no series at all: there are no alerts
 *                  from it, so there is nothing to route (this is "empty", not
 *                  "unknown");
 *   `unresolved` — the rule was never expanded into alerts (no TSDB configured, or
 *                  the query failed), so a route neither exists nor can be guessed.
 */
export type Resolution = 'exact' | 'no-series' | 'unresolved';

export function resolutionLabel(resolution: Resolution): string {
  return dict().resolution[resolution];
}

export interface RouteExplanation {
  results: MatchResult[];
  ambiguities: Ambiguity[];
  /** The answer is exact: unknown labels affected nothing. */
  certain: boolean;
  /** Every unknown label that influenced the decision. */
  missingLabels: string[];
}

export interface ExplainOptions {
  /**
   * Names of labels whose presence or absence is known for certain.
   * `null` means the label set is complete (firing alerts, CSV, enrichment).
   */
  known: Set<string> | null;
}

/** Runs one label set through the tree, recording why the answer is what it is. */
export function explainRoute(
  root: RouteNode,
  labels: Labels,
  options: ExplainOptions,
): RouteExplanation {
  const ambiguities: Ambiguity[] = [];
  const missing = new Set<string>();

  const isKnown = (name: string): boolean => options.known === null || options.known.has(name);

  /** Inspects a route's matchers: did it pass, and what in that verdict is shaky. */
  const inspect = (node: RouteNode): { pass: boolean } => {
    const unknownPassed: Matcher[] = [];
    const unknownFailed: Matcher[] = [];
    const unknownNames = new Set<string>();
    let knownFailed = false;
    let pass = true;

    for (const m of node.matchers) {
      const check = parseMatcher(m.raw);
      const evaluated = evalMatcher(m.raw, labels);
      if (!evaluated.pass) pass = false;

      const label = check.parsed?.label;
      if (!label || isKnown(label)) {
        if (!evaluated.pass) knownFailed = true;
        continue;
      }
      unknownNames.add(label);
      if (evaluated.pass) {
        if (canFlip(m.raw)) unknownPassed.push(m);
      } else {
        unknownFailed.push(m);
      }
    }

    if (pass && unknownPassed.length > 0) {
      ambiguities.push({
        nodeId: node.id,
        kind: 'could-unmatch',
        matchers: unknownPassed.map((m) => m.raw),
        labels: [...unknownNames],
      });
      unknownNames.forEach((n) => missing.add(n));
    }

    if (!pass && !knownFailed && unknownFailed.length > 0) {
      ambiguities.push({
        nodeId: node.id,
        kind: 'could-match',
        matchers: unknownFailed.map((m) => m.raw),
        labels: [...unknownNames],
      });
      unknownNames.forEach((n) => missing.add(n));
    }

    return { pass };
  };

  const walk = (node: RouteNode, pathSoFar: RouteNode[]): MatchResult[] => {
    if (!inspect(node).pass) return [];

    const myPath = [...pathSoFar, node];
    const all: MatchResult[] = [];
    for (const child of node.routes) {
      const matched = walk(child, myPath);
      if (matched.length > 0) {
        all.push(...matched);
        if (!child.continue) break;
      }
    }
    if (all.length === 0) return [{ node, path: myPath }];
    return all;
  };

  const results = walk(root, []);
  return {
    results,
    ambiguities,
    certain: ambiguities.length === 0,
    missingLabels: [...missing].sort(),
  };
}

/**
 * Could a real label value flip the verdict of a matcher that currently passes on
 * an "empty" value? `label=~".*"` cannot — it is true for anything, including "".
 */
function canFlip(raw: string): boolean {
  const check = parseMatcher(raw);
  if (!check.ok || !check.parsed) return false;
  const { op, value } = check.parsed;
  if (op === '=~' && (value === '.*' || value === '(.*)' || value === '^.*$')) return false;
  if (op === '!~' && (value === '.*' || value === '(.*)' || value === '^.*$')) return false;
  return true;
}

/* -------------------------------- batch run -------------------------------- */

export interface LabelVariant {
  id: string;
  /** Column/row caption, e.g. "cluster=prod". */
  title: string;
  labels: Labels;
}

export interface Destination {
  receiver: string | null;
  outcome: Outcome;
  path: RouteNode[];
}

export interface BatchRow {
  id: string;
  alert: AlertSpec;
  variant: LabelVariant;
  /** The final label set the route was computed from. */
  labels: Labels;
  /** Which label set this is, when a rule expanded into several series. */
  labelSet?: { index: number; total: number };
  resolution: Resolution;
  /** Routes. Non-empty only when resolution === 'exact'. */
  destinations: Destination[];
  /**
   * Route through the tree as it was at load time — the before/after regression.
   * `null` when there is nothing to compare against (no edits, or an unresolved row).
   */
  before: Destination[] | null;
  /** The route changed relative to the tree as loaded. */
  routeChanged: boolean;
  /**
   * Labels the tree asks this alert about and which we do not know. These are
   * exactly what is missing for the routing question to have one answer.
   */
  neededLabels: string[];
  /** Diagnostics: which routes hinge on the unknown labels. */
  blockers: Ambiguity[];
}

export interface BatchOptions {
  variants: LabelVariant[];
  /** Row cap — protection against a dump that expands into tens of thousands of series. */
  maxRows?: number;
  /**
   * The tree as of load time. When given, every resolved row also gets its "before"
   * route, which is what makes an edit's blast radius visible.
   */
  baselineRoot?: RouteNode | null;
}

/** Route comparison: receiver, outcome and their order all matter. */
function sameRoute(a: Destination[], b: Destination[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((d, i) => d.receiver === b[i].receiver && d.outcome === b[i].outcome);
}

/**
 * The variant used when no external labels were entered. `title` is a getter so the
 * caption follows the UI language without turning this constant into a function.
 */
export const NO_VARIANT: LabelVariant = {
  id: 'plain',
  get title(): string {
    return dict().batch.noExternalLabels;
  },
  labels: {},
};

export function evaluateBatch(
  root: RouteNode,
  alerts: AlertSpec[],
  options: BatchOptions,
): { rows: BatchRow[]; truncated: number } {
  const variants = options.variants.length > 0 ? options.variants : [NO_VARIANT];
  const maxRows = options.maxRows ?? 20000;
  const rows: BatchRow[] = [];
  let truncated = 0;

  for (const alert of alerts) {
    const resolvedSets = alert.enriched?.labelSets ?? [];
    const labelSets = resolvedSets.length > 0 ? resolvedSets : [alert.labels];
    const complete = alert.complete || resolvedSets.length > 0;
    // A rule that was expanded but yielded no series means "there are no alerts",
    // not "the route is unknown".
    const enrichedStatus = alert.enriched?.status;
    const resolution: Resolution = complete
      ? 'exact'
      : enrichedStatus === 'no-data' || enrichedStatus === 'no-match'
        ? 'no-series'
        : 'unresolved';

    for (const variant of variants) {
      labelSets.forEach((set, index) => {
        if (rows.length >= maxRows) {
          truncated += 1;
          return;
        }
        // Same order as Prometheus: series labels → rule labels → external labels.
        const labels: Labels = { ...set, ...variant.labels };
        if (labels.alertname === undefined) labels.alertname = alert.name;

        const known = complete ? null : new Set(Object.keys(labels));
        const explanation = explainRoute(root, labels, { known });

        const destinations: Destination[] =
          resolution === 'exact'
            ? explanation.results.map((r) => ({
                receiver: r.node.receiver,
                outcome: classifyOutcome(r.node),
                path: r.path,
              }))
            : [];

        // The "before" route is computed only where a route is defined at all.
        let before: Destination[] | null = null;
        if (resolution === 'exact' && options.baselineRoot) {
          before = explainRoute(options.baselineRoot, labels, { known }).results.map((r) => ({
            receiver: r.node.receiver,
            outcome: classifyOutcome(r.node),
            path: r.path,
          }));
        }

        rows.push({
          id: `${alert.id}:${variant.id}:${index}`,
          alert,
          variant,
          labels,
          ...(labelSets.length > 1 ? { labelSet: { index: index + 1, total: labelSets.length } } : {}),
          resolution,
          // A route is published only when it is unambiguous.
          destinations,
          before,
          routeChanged: before !== null && !sameRoute(before, destinations),
          neededLabels: resolution === 'exact' ? [] : explanation.missingLabels,
          blockers: resolution === 'exact' ? [] : explanation.ambiguities,
        });
      });
    }
  }

  return { rows, truncated };
}

/**
 * One bucket of the "where did alerts go" histogram.
 *
 * `receiver: null` is the silent-loss bucket — no route on the path had a receiver.
 * It is kept as `null` rather than as a caption so that this module produces no
 * display text of its own.
 */
export interface ReceiverCount {
  receiver: string | null;
  count: number;
}

export interface BatchSummary {
  rows: number;
  alerts: number;
  delivered: number;
  dropNull: number;
  lost: number;
  /** Rules that were never expanded into alerts: no route was computed. */
  unresolved: number;
  /** Rules with no series: there are currently no alerts from them. */
  noSeries: number;
  /** Rows whose route changed because of an edit to the tree. */
  routeChanged: number;
  multi: number;
  byReceiver: ReceiverCount[];
}

export function summarize(rows: BatchRow[]): BatchSummary {
  const byReceiver = new Map<string | null, number>();
  let delivered = 0;
  let dropNull = 0;
  let lost = 0;
  let unresolved = 0;
  let noSeries = 0;
  let routeChanged = 0;
  let multi = 0;

  for (const row of rows) {
    if (row.resolution === 'unresolved') unresolved += 1;
    if (row.resolution === 'no-series') noSeries += 1;
    if (row.routeChanged) routeChanged += 1;
    if (row.destinations.length > 1) multi += 1;
    for (const d of row.destinations) {
      const bump = (key: string | null): void => {
        byReceiver.set(key, (byReceiver.get(key) ?? 0) + 1);
      };
      if (d.outcome === 'delivered') {
        delivered += 1;
        bump(d.receiver ?? '');
      } else if (d.outcome === 'drop-null') {
        dropNull += 1;
        bump('null');
      } else {
        lost += 1;
        bump(null);
      }
    }
  }

  return {
    rows: rows.length,
    alerts: new Set(rows.map((r) => r.alert.id)).size,
    delivered,
    dropNull,
    lost,
    unresolved,
    noSeries,
    routeChanged,
    multi,
    byReceiver: [...byReceiver.entries()]
      .map(([receiver, count]) => ({ receiver, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Short path description — for the "why" column and for exports. */
export function describePath(path: RouteNode[]): string {
  return path
    .map((n) =>
      n.isRoot ? 'route' : n.matchers.map((m) => m.raw).join(' & ') || dict().batch.noMatchers,
    )
    .join(' → ');
}
