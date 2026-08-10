/**
 * Parsing of alert dumps for the batch check. The format is detected automatically.
 *
 * Supported:
 *   1. A `PrometheusRule` dump from a cluster (multi-doc YAML) — every rule,
 *      including ones that have never fired;
 *   2. A plain Prometheus rule file (`groups:` at the top level);
 *   3. `curl prometheus/api/v1/rules` — the same, as Prometheus sees it;
 *   4. `curl alertmanager/api/v2/alerts` or `prometheus/api/v1/alerts` — alerts
 *      actually firing, with FULL labels;
 *   5. CSV: header row of label names, data rows of values.
 *
 * The important caveat for (1)–(3): a rule only knows its static `labels:`. Series
 * labels (`namespace`, `job`, `pod`, `resource_id`) appear only when it fires —
 * they are either fetched by enrichment (see `enrich.ts`) or stay unknown, which is
 * reported honestly instead of being guessed.
 */

import { loadAll } from 'js-yaml';
import { dict } from '../i18n/dict';
import { nextId } from './ids';
import type { Labels } from './matchers';
import { extractSelectors } from './promql';

export type AlertSourceFormat =
  | 'prometheus-rule-crd'
  | 'prometheus-rule-file'
  | 'prometheus-rules-api'
  | 'alerts-api'
  | 'csv';

export interface EnrichAttempt {
  /** What exactly was asked of the TSDB. */
  query: string;
  /** Why: full expression, the same without the threshold, metric existence check. */
  kind: 'expr' | 'expr-without-threshold' | 'series-exists';
  /** How many series came back. */
  series: number;
}

export interface AlertEnrichment {
  /**
   * `exact`      — labels obtained by running the expr itself (the rule fires now);
   * `approx`     — the rule does not fire; expr was run without its final threshold;
   * `no-data`    — the metric does not exist in this TSDB at all (the exporter is
   *                silent, or the data lives in a different Prometheus);
   * `no-match`   — the metric exists, but no series matched the expression filters;
   * `error`      — the query failed.
   */
  status: 'exact' | 'approx' | 'no-data' | 'no-match' | 'error';
  note: string;
  /** Real label sets of the series. */
  labelSets: Labels[];
  /** What was asked, and in what order, so the result can be re-checked by hand. */
  attempts: EnrichAttempt[];
}

export interface AlertSpec {
  id: string;
  /** Alert name (also the `alertname` label). */
  name: string;
  /** Known labels: static ones from the rule, or real ones from an alert dump. */
  labels: Labels;
  /** The label set is complete (a dump of firing alerts), not partial. */
  complete: boolean;
  expr?: string;
  /** Selectors extracted from expr — used to enrich with series labels. */
  selectors: string[];
  /** Where it came from: file/group/namespace — for the context column. */
  origin: string;
  /** Result of enrichment from Prometheus/VM, when it was enabled. */
  enriched?: AlertEnrichment;
}

export interface AlertSourceResult {
  format: AlertSourceFormat;
  alerts: AlertSpec[];
  warnings: string[];
}

export function parseAlertSource(text: string): AlertSourceResult {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(dict().source.emptyInput);

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJson(trimmed);
  }
  // CSV: first line has no ":" but does have commas or semicolons.
  const firstLine = trimmed.split('\n')[0];
  if (!firstLine.includes(':') && /[,;]/.test(firstLine)) {
    return parseCsv(trimmed);
  }
  return parseYaml(trimmed);
}

/* -------------------------------- YAML -------------------------------- */

function parseYaml(text: string): AlertSourceResult {
  const t = dict().source;
  const warnings: string[] = [];
  let docs: unknown[];
  try {
    docs = loadAll(text);
  } catch (e) {
    throw new Error(t.yamlFailed((e as Error).message));
  }

  const alerts: AlertSpec[] = [];
  let format: AlertSourceFormat = 'prometheus-rule-file';

  for (const doc of docs) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
    const obj = doc as Record<string, unknown>;

    if (obj.kind === 'PrometheusRule') {
      format = 'prometheus-rule-crd';
      const meta = (obj.metadata ?? {}) as Record<string, unknown>;
      const origin = [meta.namespace, meta.name].filter(Boolean).join('/') || 'PrometheusRule';
      const spec = (obj.spec ?? {}) as Record<string, unknown>;
      alerts.push(...readGroups(spec.groups, origin, warnings));
      continue;
    }

    if (Array.isArray(obj.groups)) {
      alerts.push(...readGroups(obj.groups, 'rules', warnings));
      continue;
    }

    // A Kubernetes list object (kubectl get prometheusrule -o yaml).
    if (obj.kind === 'List' && Array.isArray(obj.items)) {
      format = 'prometheus-rule-crd';
      for (const item of obj.items) {
        if (!item || typeof item !== 'object') continue;
        const it = item as Record<string, unknown>;
        const meta = (it.metadata ?? {}) as Record<string, unknown>;
        const origin = [meta.namespace, meta.name].filter(Boolean).join('/') || 'PrometheusRule';
        const spec = (it.spec ?? {}) as Record<string, unknown>;
        alerts.push(...readGroups(spec.groups, origin, warnings));
      }
    }
  }

  if (alerts.length === 0) {
    throw new Error(t.noAlertingRules);
  }
  return { format, alerts, warnings };
}

function readGroups(groups: unknown, origin: string, warnings: string[]): AlertSpec[] {
  if (!Array.isArray(groups)) return [];
  const out: AlertSpec[] = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const g = group as Record<string, unknown>;
    const groupName = typeof g.name === 'string' ? g.name : '';
    const rules = g.rules;
    if (!Array.isArray(rules)) continue;

    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') continue;
      const r = rule as Record<string, unknown>;
      // A `record:` is not an alert — skip it silently.
      if (typeof r.alert !== 'string') continue;
      const expr = typeof r.expr === 'string' ? r.expr : undefined;
      out.push(makeSpec(r.alert, readLabels(r.labels, `${origin}/${r.alert}`, warnings), expr, [
        origin,
        groupName,
      ]));
    }
  }
  return out;
}

/* -------------------------------- JSON -------------------------------- */

function parseJson(text: string): AlertSourceResult {
  const t = dict().source;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Error(t.jsonFailed((e as Error).message));
  }
  const warnings: string[] = [];

  // Alertmanager /api/v2/alerts — just an array of objects carrying labels.
  if (Array.isArray(doc)) {
    const alerts = doc
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((a) => fromFiringAlert(a, warnings));
    if (alerts.length === 0) throw new Error(t.emptyArray);
    return { format: 'alerts-api', alerts, warnings };
  }

  if (!doc || typeof doc !== 'object') throw new Error(t.expectedObjectOrArray);
  const obj = doc as Record<string, unknown>;
  const data = (obj.data ?? obj) as Record<string, unknown>;

  // Prometheus /api/v1/alerts
  if (Array.isArray(data.alerts)) {
    const alerts = (data.alerts as unknown[])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((a) => fromFiringAlert(a, warnings));
    return { format: 'alerts-api', alerts, warnings };
  }

  // Prometheus /api/v1/rules
  if (Array.isArray(data.groups)) {
    const alerts: AlertSpec[] = [];
    for (const group of data.groups as unknown[]) {
      if (!group || typeof group !== 'object') continue;
      const g = group as Record<string, unknown>;
      const origin = String(g.file ?? g.name ?? 'rules');
      const groupName = typeof g.name === 'string' ? g.name : '';
      for (const rule of (g.rules as unknown[]) ?? []) {
        if (!rule || typeof rule !== 'object') continue;
        const r = rule as Record<string, unknown>;
        if (r.type !== undefined && r.type !== 'alerting') continue;
        const name = typeof r.name === 'string' ? r.name : typeof r.alert === 'string' ? r.alert : '';
        if (!name) continue;
        const expr = typeof r.query === 'string' ? r.query : typeof r.expr === 'string' ? r.expr : undefined;
        alerts.push(
          makeSpec(name, readLabels(r.labels, `${origin}/${name}`, warnings), expr, [origin, groupName]),
        );
      }
    }
    if (alerts.length === 0) throw new Error(t.noAlertingRulesInApi);
    return { format: 'prometheus-rules-api', alerts, warnings };
  }

  throw new Error(t.unknownJson);
}

function fromFiringAlert(raw: Record<string, unknown>, warnings: string[]): AlertSpec {
  const labels = readLabels(raw.labels, 'alert', warnings);
  const name = labels.alertname ?? dict().source.noAlertname;
  const spec = makeSpec(name, labels, undefined, [dict().source.firingAlert]);
  // A dump of firing alerts carries the real, complete label set.
  spec.complete = true;
  return spec;
}

/* --------------------------------- CSV --------------------------------- */

function parseCsv(text: string): AlertSourceResult {
  const t = dict().source;
  const warnings: string[] = [];
  const rows = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  if (rows.length < 2) throw new Error(t.csvNeedsHeaderAndRow);

  const sep = rows[0].includes(';') ? ';' : ',';
  const header = rows[0].split(sep).map((h) => h.trim());
  const alerts: AlertSpec[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i].split(sep).map((c) => c.trim());
    const labels: Labels = {};
    header.forEach((h, idx) => {
      if (h && cells[idx] !== undefined && cells[idx] !== '') labels[h] = cells[idx];
    });
    const name = labels.alertname ?? t.csvRow(i);
    const spec = makeSpec(name, labels, undefined, ['CSV']);
    // In CSV the user listed exactly what they wanted checked.
    spec.complete = true;
    alerts.push(spec);
  }
  if (alerts.length === 0) throw new Error(t.csvNoDataRows);
  return { format: 'csv', alerts, warnings };
}

/* -------------------------------- shared -------------------------------- */

function makeSpec(name: string, labels: Labels, expr: string | undefined, origin: string[]): AlertSpec {
  const merged: Labels = { ...labels };
  // Rules do not carry `alertname` in labels, but routing always sees it.
  if (merged.alertname === undefined) merged.alertname = name;
  return {
    id: nextId('a'),
    name,
    labels: merged,
    complete: false,
    ...(expr ? { expr } : {}),
    selectors: expr ? extractSelectors(expr) : [],
    origin: origin.filter(Boolean).join(' · '),
  };
}

function readLabels(raw: unknown, where: string, warnings: string[]): Labels {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(dict().source.labelsNotMapping(where));
    return {};
  }
  const out: Labels = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[k] = String(v);
  }
  return out;
}
