/**
 * Label enrichment from Prometheus / VictoriaMetrics.
 *
 * Why: a rule only knows its static `labels:`, while routing also looks at series
 * labels. The only way to learn those for certain is to ask the TSDB itself.
 * Strategy per rule:
 *
 *   1. `/api/v1/query?query=<expr>` — if the rule is firing right now, this returns
 *      EXACTLY the label sets the alert will carry (aggregations already applied);
 *   2. otherwise the same query without its final threshold (`... > 5` → `...`) —
 *      the rule is not firing, but the series carry the same labels, so where it
 *      *would* go is still visible;
 *   3. otherwise `/api/v1/series` by metric name — to tell "the exporter is silent,
 *      the metric does not exist" apart from "the metric exists but the filters
 *      matched nothing".
 *
 * Every request made is returned in `attempts`, so the conclusion can be re-checked
 * by hand instead of taken on trust.
 *
 * PRIVACY: the only thing that leaves the browser is rule expressions, and only to
 * the address the user typed in themselves. The routing tree, the config and the
 * pasted YAML are never sent anywhere.
 */

import { dict } from '../i18n/dict';
import type { Labels } from './matchers';
import { stripFinalComparison } from './promql';
import { endpointCandidates } from './urls';
import type { AlertEnrichment, AlertSpec, EnrichAttempt } from './alertSources';

export interface PromSource {
  /** Base URL, e.g. https://prometheus.example.com */
  url: string;
  auth?: { username: string; password: string };
  timeoutMs: number;
  /** Maximum number of label sets per rule. */
  maxSeriesPerRule: number;
}

/** Labels Prometheus adds itself and which an alert will not carry. */
const DROP_LABELS = new Set(['__name__']);

export function buildHeaders(source: PromSource): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (source.auth && source.auth.username !== '') {
    // btoa is enough here: basic-auth credentials are ASCII anyway.
    headers.Authorization = `Basic ${btoa(`${source.auth.username}:${source.auth.password}`)}`;
  }
  return headers;
}

export function queryUrl(source: PromSource, path: string, params: Record<string, string>): string {
  const base = source.url.replace(/\/+$/, '');
  const search = new URLSearchParams(params).toString();
  return `${base}${path}?${search}`;
}

/**
 * The address that ended up working, remembered so that a failed attempt is not
 * repeated on each of the hundreds of requests made while expanding rules.
 */
const resolvedBase = new Map<string, string>();

/** The address actually used last time — for the note shown in the UI. */
export function lastUsedBase(raw: string): string | null {
  return resolvedBase.get(raw.trim()) ?? null;
}

async function requestTo(
  base: string,
  source: PromSource,
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), source.timeoutMs);
  try {
    const response = await fetchImpl(queryUrl({ ...source, url: base }, path, params), {
      headers: buildHeaders(source),
      signal: controller.signal,
      // No cookies: if an oauth2-proxy sits in front of the TSDB that needs a
      // separate conversation, and silently leaking a session is not an option.
      credentials: 'omit',
      mode: 'cors',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Request with address auto-selection: the scheme is filled in, and http is retried
 * over https on failure. From an https page http is not tried at all — the browser
 * blocks it as mixed content before the request is even sent.
 */
async function request(
  source: PromSource,
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const typed = source.url.trim();
  const known = resolvedBase.get(typed);
  const pageProtocol = typeof location === 'undefined' ? 'http:' : location.protocol;
  const candidates = known ? [known] : endpointCandidates(typed, pageProtocol);
  if (candidates.length === 0) throw new Error(dict().enrich.noAddress);

  let lastError: unknown;
  for (const base of candidates) {
    try {
      const doc = await requestTo(base, source, path, params, fetchImpl);
      resolvedBase.set(typed, base);
      return doc;
    } catch (e) {
      lastError = e;
      // An HTTP response came back, so the address works — another scheme will not
      // help and retrying would only hide the real status code.
      if ((e as Error).message?.startsWith('HTTP ')) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Pulls rules straight from Prometheus, so nobody has to dump PrometheusRule by
 * hand. Returns JSON text: it is then parsed by the same `parseAlertSource` that
 * handles a file supplied manually.
 */
export async function fetchRulesJson(
  source: PromSource,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const doc = await request(source, '/api/v1/rules', { type: 'alert' }, fetchImpl);
  return JSON.stringify(doc);
}

/**
 * Firing alerts from Alertmanager (`/api/v2/alerts`). Their labels are real and
 * complete, so the answers come out exact, with nothing left unresolved.
 */
export async function fetchAlertsJson(
  source: PromSource,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const doc = await request(source, '/api/v2/alerts', {}, fetchImpl);
  return JSON.stringify(doc);
}

/** Connection check; also reports the version so it is clear where you landed. */
export async function checkConnection(
  source: PromSource,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const doc = (await request(source, '/api/v1/status/buildinfo', {}, fetchImpl)) as {
    status?: string;
    data?: { version?: string };
  };
  if (doc.status && doc.status !== 'success') throw new Error(dict().enrich.badStatus(doc.status));
  return doc.data?.version ? dict().enrich.version(doc.data.version) : dict().enrich.connected;
}

/**
 * Fetches Alertmanager's own config (`/api/v2/status` → `config.original`), so the
 * YAML does not have to be pasted by hand on first run.
 *
 * Alertmanager returns the config with secrets MASKED: `bot_token: <secret>`,
 * `url: <secret>`. That does not matter for editing the tree (only receiver names
 * are needed), but it does mean such text must never be written back to a cluster
 * as-is — the whole-file export is disabled for this source.
 */
export async function fetchAlertmanagerConfig(
  source: PromSource,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const doc = (await request(source, '/api/v2/status', {}, fetchImpl)) as {
    config?: { original?: string };
  };
  const original = doc.config?.original;
  if (typeof original !== 'string' || original.trim() === '') {
    throw new Error(dict().enrich.noConfigOriginal);
  }
  return original;
}

/** Alertmanager has its own API: build info lives in /api/v2/status. */
export async function checkAlertmanager(
  source: PromSource,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const doc = (await request(source, '/api/v2/status', {}, fetchImpl)) as {
    versionInfo?: { version?: string };
  };
  return doc.versionInfo?.version
    ? dict().enrich.version(doc.versionInfo.version)
    : dict().enrich.connected;
}

function seriesFromQuery(doc: unknown, limit: number): Labels[] {
  const data = (doc as { data?: { result?: unknown[] } }).data;
  const result = data?.result;
  if (!Array.isArray(result)) return [];
  const out: Labels[] = [];
  const seen = new Set<string>();
  for (const item of result) {
    if (out.length >= limit) break;
    const metric = (item as { metric?: Record<string, unknown> }).metric;
    if (!metric || typeof metric !== 'object') continue;
    const labels: Labels = {};
    for (const [k, v] of Object.entries(metric)) {
      if (DROP_LABELS.has(k)) continue;
      labels[k] = String(v);
    }
    const key = JSON.stringify(Object.entries(labels).sort());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(labels);
  }
  return out;
}

/**
 * Enriches one rule. Never throws: failures arrive as a status.
 *
 * The order of attempts, and why it is this order:
 *   1. the expression itself — if the rule fires, the labels are exact;
 *   2. the expression without its final threshold — the rule does not fire, but the
 *      series carry the same labels (aggregations are already applied);
 *   3. an existence check via `/api/v1/series` — this is what separates "the
 *      exporter is silent" from "the metric exists but the filters matched
 *      nothing". Without it both would read as "empty result" and there would be
 *      no way to tell what to do next.
 */
export async function enrichAlert(
  alert: AlertSpec,
  source: PromSource,
  fetchImpl: typeof fetch = fetch,
): Promise<AlertEnrichment> {
  const t = dict().enrich;
  if (!alert.expr) {
    return {
      status: 'no-data',
      note: t.noExpr,
      labelSets: [],
      attempts: [],
    };
  }

  const attempts: EnrichAttempt[] = [];

  try {
    const exact = seriesFromQuery(
      await request(source, '/api/v1/query', { query: alert.expr }, fetchImpl),
      source.maxSeriesPerRule,
    );
    attempts.push({ query: alert.expr, kind: 'expr', series: exact.length });
    if (exact.length > 0) {
      return {
        status: 'exact',
        note: t.firingNow(exact.length),
        labelSets: mergeStatic(exact, alert.labels),
        attempts,
      };
    }

    const relaxed = stripFinalComparison(alert.expr);
    if (relaxed) {
      const approx = seriesFromQuery(
        await request(source, '/api/v1/query', { query: relaxed }, fetchImpl),
        source.maxSeriesPerRule,
      );
      attempts.push({ query: relaxed, kind: 'expr-without-threshold', series: approx.length });
      if (approx.length > 0) {
        return {
          status: 'approx',
          note: t.notFiringUsedRelaxed(approx.length),
          labelSets: mergeStatic(approx, alert.labels),
          attempts,
        };
      }
    }

    // Does the metric exist in this TSDB at all?
    const bare = alert.selectors[0]?.split('{')[0];
    if (bare) {
      const doc = (await request(source, '/api/v1/series', { 'match[]': bare }, fetchImpl)) as {
        data?: unknown[];
      };
      const count = Array.isArray(doc.data) ? doc.data.length : 0;
      attempts.push({ query: bare, kind: 'series-exists', series: count });
      if (count === 0) {
        return {
          status: 'no-data',
          note: t.metricMissing(bare),
          labelSets: [],
          attempts,
        };
      }
      return {
        status: 'no-match',
        note: t.metricPresentNoMatch(bare, count),
        labelSets: [],
        attempts,
      };
    }

    return { status: 'no-data', note: t.noMetricInExpr, labelSets: [], attempts };
  } catch (e) {
    const message = (e as Error).name === 'AbortError' ? t.timeout : (e as Error).message;
    return { status: 'error', note: message, labelSets: [], attempts };
  }
}

/**
 * Rule labels win over series labels — exactly what Prometheus does when it builds
 * the alert.
 */
function mergeStatic(series: Labels[], ruleLabels: Labels): Labels[] {
  return series.map((s) => ({ ...s, ...ruleLabels }));
}

export interface EnrichProgress {
  done: number;
  total: number;
  current: string;
}

/** Enriches a list of rules with a bounded number of parallel requests. */
export async function enrichAll(
  alerts: AlertSpec[],
  source: PromSource,
  options: {
    concurrency?: number;
    onProgress?: (p: EnrichProgress) => void;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<AlertSpec[]> {
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const fetchImpl = options.fetchImpl ?? fetch;
  const queue = [...alerts];
  const total = queue.length;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted) return;
      const alert = queue.shift();
      if (!alert) return;
      alert.enriched = await enrichAlert(alert, source, fetchImpl);
      done += 1;
      options.onProgress?.({ done, total, current: alert.name });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return alerts;
}
