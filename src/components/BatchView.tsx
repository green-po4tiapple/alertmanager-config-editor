/**
 * Batch check: an alert dump → a table of "where it goes and why".
 *
 * Four parts: connections, the alert source, external labels (Prometheus's own
 * externalLabels such as cluster), and optional enrichment from Prometheus/VM.
 *
 * The rule this screen lives by: a route is published only when it is proven. A
 * Prometheus rule is a template, not an alert, so until it has been expanded into
 * real series no receiver is shown at all — what is shown instead is the exact list
 * of labels the tree asks about.
 */

import { useMemo, useRef, useState } from 'react';
import type { AlertSourceFormat, AlertSpec } from '../core/alertSources';
import { parseAlertSource } from '../core/alertSources';
import {
  describePath,
  evaluateBatch,
  resolutionLabel,
  summarize,
  type BatchRow,
  type LabelVariant,
} from '../core/batch';
import {
  checkAlertmanager,
  checkConnection,
  enrichAlert,
  lastUsedBase,
  enrichAll,
  fetchAlertsJson,
  fetchRulesJson,
  type PromSource,
} from '../core/enrich';
import { stripFinalComparison } from '../core/promql';
import { endpointCandidates, endpointNote } from '../core/urls';
import { outcomeLabel } from '../core/routing';
import type { Outcome, RouteNode } from '../core/types';
import { Rich } from '../i18n/Rich';
import { useT } from '../i18n/react';
import type { Dict } from '../i18n/dict';

export type BatchFilter =
  | 'all'
  | 'delivered'
  | 'drop-null'
  | 'lost'
  | 'unresolved'
  | 'changed'
  | 'multi';

export interface ExternalLabelRow {
  id: string;
  name: string;
  /** Comma-separated values: each one produces its own run variant. */
  values: string;
}

export interface BatchState {
  sourceText: string;
  alerts: AlertSpec[] | null;
  format: AlertSourceFormat | null;
  parseWarnings: string[];
  error: string | null;
  external: ExternalLabelRow[];
  enrichEnabled: boolean;
  promUrl: string;
  alertmanagerUrl: string;
  authRequired: boolean;
  username: string;
  password: string;
  maxSeriesPerRule: number;
  connectionNote: string | null;
  amNote: string | null;
  /** Where the current dump came from, when it was pulled over the API. */
  fetchedFrom: string | null;
  fetchBusy: boolean;
  enrichNote: string | null;
  enrichBusy: boolean;
  progress: { done: number; total: number } | null;
  filter: BatchFilter;
  query: string;
}

export function initialBatchState(): BatchState {
  return {
    sourceText: '',
    alerts: null,
    format: null,
    parseWarnings: [],
    error: null,
    external: [{ id: 'ex1', name: 'cluster', values: '' }],
    enrichEnabled: false,
    promUrl: '',
    alertmanagerUrl: '',
    authRequired: false,
    username: '',
    password: '',
    maxSeriesPerRule: 20,
    connectionNote: null,
    amNote: null,
    fetchedFrom: null,
    fetchBusy: false,
    enrichNote: null,
    enrichBusy: false,
    progress: null,
    filter: 'all',
    query: '',
  };
}

const MAX_VARIANTS = 8;

/** Cartesian product of the external-label values. */
export function buildVariants(external: ExternalLabelRow[]): LabelVariant[] {
  const active = external
    .map((row) => ({
      name: row.name.trim(),
      values: row.values
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== ''),
    }))
    .filter((row) => row.name !== '' && row.values.length > 0);

  if (active.length === 0) return [];

  let combos: Array<Array<[string, string]>> = [[]];
  for (const { name, values } of active) {
    const next: Array<Array<[string, string]>> = [];
    for (const combo of combos) {
      for (const value of values) {
        if (next.length >= MAX_VARIANTS) break;
        next.push([...combo, [name, value]]);
      }
    }
    combos = next;
  }

  return combos.map((combo, i) => ({
    id: `v${i}`,
    title: combo.map(([k, v]) => `${k}=${v}`).join(', '),
    labels: Object.fromEntries(combo),
  }));
}

export function BatchView({
  root,
  baselineRoot,
  state,
  onChange,
  onSelectNode,
  onToast,
}: {
  root: RouteNode;
  /** The tree as of load time — powers the before/after routing regression. */
  baselineRoot: RouteNode | null;
  state: BatchState;
  onChange: (patch: Partial<BatchState>) => void;
  onSelectNode: (id: string) => void;
  onToast: (message: string) => void;
}): React.JSX.Element {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  /** Counter forcing a recount after enrichment, which mutates alerts in place. */
  const [revision, setRevision] = useState(0);

  const variants = useMemo(() => buildVariants(state.external), [state.external]);

  const evaluated = useMemo(() => {
    if (!state.alerts) return null;
    return evaluateBatch(root, state.alerts, { variants, baselineRoot });
    // revision is in the deps on purpose: enrichment mutates alerts in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, baselineRoot, state.alerts, variants, revision]);

  const summary = useMemo(() => (evaluated ? summarize(evaluated.rows) : null), [evaluated]);

  const rows = useMemo(() => {
    if (!evaluated) return [];
    const query = state.query.trim().toLowerCase();
    return evaluated.rows.filter((row) => {
      if (!passesFilter(row, state.filter)) return false;
      if (query === '') return true;
      const haystack = [
        row.alert.name,
        row.alert.origin,
        row.variant.title,
        ...Object.entries(row.labels).map(([k, v]) => `${k}=${v}`),
        ...row.destinations.map((d) => d.receiver ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [evaluated, state.filter, state.query]);

  const load = (text: string, fetchedFrom: string | null = null): void => {
    try {
      const parsed = parseAlertSource(text);
      onChange({
        // API dumps are not put in the textarea: they run to hundreds of kilobytes.
        sourceText: fetchedFrom ? '' : text,
        fetchedFrom,
        alerts: parsed.alerts,
        format: parsed.format,
        parseWarnings: parsed.warnings,
        error: null,
        enrichNote: null,
        // Otherwise a filter left from the previous dump hides every new row.
        filter: 'all',
        query: '',
      });
      setRevision((r) => r + 1);
      onToast(t.batchUi.loadedAlerts(parsed.alerts.length));
    } catch (e) {
      onChange({ error: (e as Error).message, alerts: null, format: null });
    }
  };

  const sourceFor = (url: string): PromSource => ({
    url: url.trim(),
    ...(state.authRequired && state.username !== ''
      ? { auth: { username: state.username, password: state.password } }
      : {}),
    timeoutMs: 30000,
    maxSeriesPerRule: state.maxSeriesPerRule,
  });

  const promSource = (): PromSource => sourceFor(state.promUrl);

  /**
   * What actually went wrong. The scheme has already been retried on the user's
   * behalf, so the message must not blame CORS for everything — it lists the
   * addresses genuinely tried and only the causes possible under this page's
   * protocol.
   */
  const failureHint = (e: unknown, typedUrl: string): string => {
    const message = (e as Error).message ?? String(e);
    if (message.startsWith('HTTP ')) {
      // A response came back, so address and network are fine: it is the service.
      return `❌ ${t.batchUi.httpAnswered(message)}`;
    }
    const pageProtocol = typeof location === 'undefined' ? 'http:' : location.protocol;
    const tail =
      pageProtocol === 'https:' ? t.batchUi.causesHttps : t.batchUi.causesHttp;
    const tried = endpointCandidates(typedUrl, pageProtocol).join(', ');
    return `❌ ${t.batchUi.requestFailed(message, tried, tail)}`;
  };

  /** A "went to … instead" note when the address differs from what was typed. */
  const usedNote = (typedUrl: string): string => {
    const used = lastUsedBase(typedUrl);
    const note = used ? endpointNote(typedUrl, used) : null;
    return note ? ` (${note})` : '';
  };

  const testConnection = async (): Promise<void> => {
    onChange({ connectionNote: t.batchUi.checking });
    try {
      const version = await checkConnection(promSource());
      onChange({ connectionNote: `✅ ${version}${usedNote(state.promUrl)}` });
    } catch (e) {
      onChange({ connectionNote: failureHint(e, state.promUrl) });
    }
  };

  const testAlertmanager = async (): Promise<void> => {
    onChange({ amNote: t.batchUi.checking });
    try {
      const version = await checkAlertmanager(sourceFor(state.alertmanagerUrl));
      onChange({ amNote: `✅ ${version}${usedNote(state.alertmanagerUrl)}` });
    } catch (e) {
      onChange({ amNote: failureHint(e, state.alertmanagerUrl) });
    }
  };

  /** Pulls rules straight from Prometheus — no manual kubectl needed. */
  const pullRules = async (): Promise<void> => {
    onChange({ fetchBusy: true, error: null });
    try {
      const json = await fetchRulesJson(promSource());
      load(json, `Prometheus ${state.promUrl.trim()}`);
    } catch (e) {
      onChange({ error: failureHint(e, state.promUrl) });
    } finally {
      onChange({ fetchBusy: false });
    }
  };

  /** Expands one rule into real alerts — a single targeted TSDB query. */
  const resolveRow = (row: BatchRow): void => {
    void (async () => {
      onChange({ enrichNote: t.batchUi.expanding(row.alert.name) });
      const enriched = await enrichAlert(row.alert, promSource());
      row.alert.enriched = enriched;
      setRevision((r) => r + 1);
      onChange({ enrichNote: `${row.alert.name}: ${enriched.note}` });
    })();
  };

  /** Firing alerts from Alertmanager: real labels, hence exact answers. */
  const pullAlerts = async (): Promise<void> => {
    onChange({ fetchBusy: true, error: null });
    try {
      const json = await fetchAlertsJson(sourceFor(state.alertmanagerUrl));
      load(json, `Alertmanager ${state.alertmanagerUrl.trim()}`);
    } catch (e) {
      onChange({ error: failureHint(e, state.alertmanagerUrl) });
    } finally {
      onChange({ fetchBusy: false });
    }
  };

  const runEnrichment = async (): Promise<void> => {
    if (!state.alerts) return;
    const withExpr = state.alerts.filter((a) => a.expr);
    if (withExpr.length === 0) {
      onChange({ enrichNote: t.batchUi.noExprInDump });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    onChange({ enrichBusy: true, enrichNote: null, progress: { done: 0, total: withExpr.length } });

    await enrichAll(withExpr, promSource(), {
      concurrency: 6,
      signal: controller.signal,
      onProgress: (p) => onChange({ progress: { done: p.done, total: p.total } }),
    });

    const counts: Record<string, number> = {
      exact: 0,
      approx: 0,
      'no-data': 0,
      'no-match': 0,
      error: 0,
    };
    for (const a of withExpr) if (a.enriched) counts[a.enriched.status] += 1;
    abortRef.current = null;
    setRevision((r) => r + 1);
    onChange({
      enrichBusy: false,
      progress: null,
      enrichNote: t.batchUi.enrichSummary(
        counts.exact,
        counts.approx,
        counts['no-data'],
        counts['no-match'],
        counts.error,
      ),
    });
  };

  return (
    <>
      <div className="pane-head">
        <span className="eyebrow">{t.batchUi.title}</span>
        <span className="hint">
          <Rich text={t.batchUi.intro} />
        </span>
      </div>

      <div className="batch-scroll">
        <section className="batch-block">
          <div className="eyebrow">{t.batchUi.step1}</div>
          <span className="hint">
            <Rich text={t.batchUi.step1Hint} />
          </span>

          <div className="batch-form">
            <label className="field wide">
              <span>Prometheus / VM</span>
              <input
                type="text"
                placeholder="https://prometheus.example.com"
                value={state.promUrl}
                spellCheck={false}
                onChange={(e) => onChange({ promUrl: e.target.value, connectionNote: null })}
              />
            </label>
            <button
              type="button"
              className="btn tiny"
              disabled={!state.promUrl.trim()}
              onClick={testConnection}
            >
              {t.batchUi.check}
            </button>
            {state.connectionNote && <span className="hint">{state.connectionNote}</span>}
          </div>

          <div className="batch-form">
            <label className="field wide">
              <span>Alertmanager</span>
              <input
                type="text"
                placeholder="https://alertmanager.example.com"
                value={state.alertmanagerUrl}
                spellCheck={false}
                onChange={(e) => onChange({ alertmanagerUrl: e.target.value, amNote: null })}
              />
            </label>
            <button
              type="button"
              className="btn tiny"
              disabled={!state.alertmanagerUrl.trim()}
              onClick={testAlertmanager}
            >
              {t.batchUi.check}
            </button>
            {state.amNote && <span className="hint">{state.amNote}</span>}
          </div>

          <label className="chk">
            <input
              type="checkbox"
              checked={state.authRequired}
              onChange={(e) => onChange({ authRequired: e.target.checked })}
            />
            {t.batchUi.authRequired}
          </label>

          {state.authRequired && (
            <div className="batch-form">
              <label className="field">
                <span>{t.load.username}</span>
                <input
                  type="text"
                  value={state.username}
                  autoComplete="off"
                  onChange={(e) => onChange({ username: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t.load.password}</span>
                <input
                  type="password"
                  value={state.password}
                  autoComplete="off"
                  onChange={(e) => onChange({ password: e.target.value })}
                />
              </label>
              <span className="hint">{t.batchUi.credentialsNote}</span>
            </div>
          )}
        </section>

        <section className="batch-block">
          <div className="eyebrow">{t.batchUi.step2}</div>
          <span className="hint">
            <Rich text={t.batchUi.step2Hint} />
          </span>

          <div className="load-actions">
            <button
              type="button"
              className="btn"
              disabled={!state.promUrl.trim() || state.fetchBusy}
              title={t.batchUi.pullRulesTitle}
              onClick={pullRules}
            >
              ↓ {t.batchUi.pullRules}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!state.alertmanagerUrl.trim() || state.fetchBusy}
              title={t.batchUi.pullAlertsTitle}
              onClick={pullAlerts}
            >
              ↓ {t.batchUi.pullAlerts}
            </button>
            {state.fetchBusy && <span className="hint">{t.batchUi.fetching}</span>}
            {state.fetchedFrom && !state.fetchBusy && (
              <span className="hint">{t.batchUi.sourceIs(state.fetchedFrom)}</span>
            )}
          </div>
          <textarea
            className="batch-input"
            value={state.sourceText}
            spellCheck={false}
            placeholder={
              'kubectl get prometheusrule -A -o yaml > rules.yaml\n' +
              'curl -s prometheus/api/v1/rules?type=alert > rules.json\n' +
              'curl -s alertmanager/api/v2/alerts > alerts.json'
            }
            onChange={(e) => onChange({ sourceText: e.target.value })}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => load(String(reader.result ?? ''));
              reader.readAsText(file);
            }}
          />
          <div className="load-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!state.sourceText.trim()}
              onClick={() => load(state.sourceText)}
            >
              {t.batchUi.loadDump}
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              {t.load.openFile}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".yaml,.yml,.json,.csv,.txt"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => load(String(reader.result ?? ''));
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
            {state.format && state.alerts && (
              <span className="hint">
                {t.batchUi.format[state.format]} · {t.batchUi.alertCount(state.alerts.length)}
              </span>
            )}
          </div>
          {state.error && <div className="load-error">{state.error}</div>}
          {state.parseWarnings.length > 0 && (
            <ul className="warn-list">
              {state.parseWarnings.slice(0, 5).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="batch-block">
          <div className="eyebrow">{t.batchUi.step3}</div>
          <span className="hint">
            <Rich text={t.batchUi.step3Hint} />
          </span>
          <div className="label-rows">
            {state.external.map((row) => (
              <div className="label-row" key={row.id}>
                <input
                  placeholder="cluster"
                  value={row.name}
                  spellCheck={false}
                  onChange={(e) =>
                    onChange({
                      external: state.external.map((r) =>
                        r.id === row.id ? { ...r, name: e.target.value } : r,
                      ),
                    })
                  }
                />
                <input
                  placeholder="prod, staging"
                  value={row.values}
                  spellCheck={false}
                  onChange={(e) =>
                    onChange({
                      external: state.external.map((r) =>
                        r.id === row.id ? { ...r, values: e.target.value } : r,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-btn"
                  title={t.batchUi.remove}
                  onClick={() =>
                    onChange({ external: state.external.filter((r) => r.id !== row.id) })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              onChange({
                external: [
                  ...state.external,
                  { id: `ex${Date.now()}`, name: '', values: '' },
                ],
              })
            }
          >
            {t.batchUi.addExternalLabel}
          </button>
          {variants.length > 1 && (
            <span className="hint">
              {t.batchUi.variantCount(variants.length, variants.map((v) => v.title).join(' | '))}
            </span>
          )}
        </section>

        <section className="batch-block">
          <div className="eyebrow">{t.batchUi.step4}</div>
          <span className="hint">
            <Rich text={t.batchUi.step4Hint} />
          </span>
          <label className="chk">
            <input
              type="checkbox"
              checked={state.enrichEnabled}
              onChange={(e) => onChange({ enrichEnabled: e.target.checked })}
            />
            {t.batchUi.enableEnrichment}
          </label>

          {state.enrichEnabled && (
            <div className="batch-form">
              <label className="field">
                <span>{t.batchUi.seriesPerRule}</span>
                <input
                  type="number"
                  className="narrow"
                  min={1}
                  max={200}
                  value={state.maxSeriesPerRule}
                  onChange={(e) =>
                    onChange({ maxSeriesPerRule: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </label>

              <div className="load-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!state.alerts || !state.promUrl.trim() || state.enrichBusy}
                  onClick={runEnrichment}
                >
                  {state.enrichBusy
                    ? t.batchUi.enriching(state.progress?.done ?? 0, state.progress?.total ?? 0)
                    : t.batchUi.enrichLabels}
                </button>
                {state.enrichBusy && (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      abortRef.current?.abort();
                      onChange({
                        enrichBusy: false,
                        progress: null,
                        enrichNote: t.batchUi.aborted,
                      });
                    }}
                  >
                    {t.batchUi.abort}
                  </button>
                )}
              </div>
              {!state.promUrl.trim() && (
                <span className="hint">{t.batchUi.needPromUrl}</span>
              )}
              {state.enrichNote && <span className="hint">{state.enrichNote}</span>}
            </div>
          )}
        </section>

        {summary && evaluated && (
          <section className="batch-block">
            <div className="eyebrow">
              <span>{t.batchUi.result}</span>
              <span className="hint">
                {t.batchUi.resultCounts(summary.rows, summary.alerts)}
                {evaluated.truncated > 0 ? t.batchUi.notShown(evaluated.truncated) : ''}
              </span>
            </div>

            <div className="batch-stats">
              <Stat label={t.batchUi.statDelivered} value={summary.delivered} kind="delivered" />
              <Stat label={t.batchUi.statDropNull} value={summary.dropNull} kind="drop-null" />
              <Stat label={t.batchUi.statLost} value={summary.lost} kind="lost" />
              {summary.unresolved > 0 && (
                <Stat label={t.batchUi.statUnresolved} value={summary.unresolved} kind="unresolved" />
              )}
              {summary.noSeries > 0 && (
                <Stat label={t.batchUi.statNoSeries} value={summary.noSeries} kind="no-series" />
              )}
              {summary.routeChanged > 0 && (
                <Stat label={t.batchUi.statChanged} value={summary.routeChanged} kind="changed" />
              )}
              {summary.multi > 0 && (
                <Stat label={t.batchUi.statMulti} value={summary.multi} kind="multi" />
              )}
            </div>

            {summary.routeChanged > 0 && (
              <div className="hint">
                <Rich text={t.batchUi.regressionNote(summary.routeChanged, summary.rows)} />
              </div>
            )}

            {summary.unresolved > 0 && (
              <div className="hint">
                {t.batchUi.unresolvedNote(summary.unresolved)}
                {state.promUrl.trim() ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="link-btn"
                      disabled={state.enrichBusy}
                      onClick={runEnrichment}
                    >
                      {t.batchUi.expandAllViaProm}
                    </button>
                  </>
                ) : (
                  ` ${t.batchUi.unresolvedNeedProm}`
                )}
              </div>
            )}

            {summary.byReceiver.length > 0 && (
              <div className="chips">
                {summary.byReceiver.slice(0, 24).map((r) => (
                  <span className="chip used" key={r.receiver ?? '\u0000lost'}>
                    {r.receiver === null ? t.batchUi.noReceiverBucket : r.receiver || t.batchUi.emptyName}{' '}
                    · {r.count}
                  </span>
                ))}
              </div>
            )}

            <div className="batch-toolbar">
              <div className="segmented">
                {(
                  [
                    ['all', t.batchUi.filterAll],
                    ['delivered', t.batchUi.statDelivered],
                    ['drop-null', 'null'],
                    ['lost', t.batchUi.statLost],
                    ['unresolved', t.batchUi.filterUnresolved],
                    ['changed', t.batchUi.statChanged],
                    ['multi', t.batchUi.filterMulti],
                  ] as Array<[BatchFilter, string]>
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={state.filter === value ? 'active' : ''}
                    onClick={() => onChange({ filter: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                className="batch-search"
                type="search"
                placeholder={t.batchUi.searchPlaceholder}
                value={state.query}
                onChange={(e) => onChange({ query: e.target.value })}
              />
              <button
                type="button"
                className="btn tiny"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(toCsv(rows))
                    .then(() => onToast(t.batchUi.copiedRows(rows.length)))
                    .catch(() => onToast(t.exportDialog.copyFailed));
                }}
              >
                {t.batchUi.copyCsv}
              </button>
              <button
                type="button"
                className="btn tiny"
                onClick={() => download(toCsv(rows), 'routing-report.csv')}
              >
                {t.batchUi.downloadCsv}
              </button>
              <button
                type="button"
                className="btn tiny"
                onClick={() => download(toMarkdown(rows, t), 'routing-report.md')}
              >
                {t.batchUi.downloadMarkdown}
              </button>
            </div>

            <table className="batch-table">
              <thead>
                <tr>
                  <th>{t.batchUi.colAlert}</th>
                  <th>{t.batchUi.colLabels}</th>
                  <th>Receiver</th>
                  <th>{t.batchUi.colOutcome}</th>
                  <th>{t.batchUi.colWhy}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((row) => (
                  <RowView
                    key={row.id}
                    row={row}
                    open={openRow === row.id}
                    onToggle={() => setOpenRow(openRow === row.id ? null : row.id)}
                    onSelectNode={onSelectNode}
                    onResolveRow={state.promUrl.trim() ? resolveRow : undefined}
                    promUrl={state.promUrl}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
            {rows.length > 500 && (
              <span className="hint">{t.batchUi.truncatedTable(rows.length)}</span>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function passesFilter(row: BatchRow, filter: BatchFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unresolved':
      return row.resolution !== 'exact';
    case 'changed':
      return row.routeChanged;
    case 'multi':
      return row.destinations.length > 1;
    case 'delivered':
      return row.destinations.some((d) => d.outcome === 'delivered');
    case 'drop-null':
      return row.destinations.some((d) => d.outcome === 'drop-null');
    case 'lost':
      return row.destinations.some((d) => d.outcome === 'drop-no-receiver');
    default:
      return true;
  }
}

function Stat({
  label,
  value,
  kind,
}: {
  label: string;
  value: number;
  kind: string;
}): React.JSX.Element {
  return (
    <div className={`batch-stat ${kind}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** Link to the Prometheus graph for this expression. */
export function promGraphUrl(promUrl: string, expr: string): string {
  const base = promUrl.trim().replace(/\/+$/, '');
  return `${base}/graph?g0.expr=${encodeURIComponent(expr)}&g0.tab=1&g0.range_input=1h`;
}

function RowView({
  row,
  open,
  onToggle,
  onSelectNode,
  onResolveRow,
  promUrl,
  t,
}: {
  row: BatchRow;
  open: boolean;
  onToggle: () => void;
  onSelectNode: (id: string) => void;
  /** Expand just this rule into alerts (one TSDB query). */
  onResolveRow?: ((row: BatchRow) => void) | undefined;
  /** Prometheus address for graph links. Empty means no links. */
  promUrl: string;
  t: Dict;
}): React.JSX.Element {
  const labelText = Object.entries(row.labels)
    .filter(([k]) => k !== 'alertname')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

  const exact = row.resolution === 'exact';

  return (
    <>
      <tr
        className={!exact ? 'unresolved' : row.routeChanged ? 'route-changed' : undefined}
        onClick={onToggle}
      >
        <td>
          <b>{row.alert.name}</b>
          <div className="cell-sub">
            {row.alert.origin}
            {row.variant.labels && Object.keys(row.variant.labels).length > 0
              ? ` · ${row.variant.title}`
              : ''}
            {row.labelSet ? ` · ${t.batchUi.seriesOf(row.labelSet.index, row.labelSet.total)}` : ''}
          </div>
        </td>
        <td>
          <code>{labelText || '—'}</code>
          {row.alert.enriched && (
            <div className="cell-sub">
              {t.batchUi.enrichmentLabel}: {row.alert.enriched.status} — {row.alert.enriched.note}
            </div>
          )}
        </td>
        <td>
          {exact ? (
            <>
              {row.routeChanged && row.before && (
                // Regression: what it was, struck through above what it is now.
                <div className="route-before">
                  {row.before.length === 0
                    ? t.batchUi.didNotMatchBefore
                    : row.before.map((d) => d.receiver ?? '—').join(', ')}
                </div>
              )}
              {row.destinations.map((d, i) => (
                <div key={i} className="receiver-name">
                  {d.receiver === null ? '—' : d.receiver}
                </div>
              ))}
            </>
          ) : (
            // The route is not proven, so no receiver is shown at all.
            <span className="cell-sub">—</span>
          )}
        </td>
        <td>
          {exact ? (
            <>
              {row.destinations.map((d, i) => (
                <span key={i} className={`pill ${d.outcome}`}>
                  {outcomeLabel(d.outcome as Outcome)}
                </span>
              ))}
              {row.routeChanged && <span className="pill changed">{t.batchUi.statChanged}</span>}
            </>
          ) : (
            <span className={`pill ${row.resolution}`}>{resolutionLabel(row.resolution)}</span>
          )}
        </td>
        <td>
          {exact ? (
            <div className="cell-sub path">{describePath(row.destinations[0]?.path ?? [])}</div>
          ) : row.resolution === 'no-series' ? (
            <div className="cell-sub">{t.batchUi.whyNoSeries}</div>
          ) : (
            <div className="cell-sub">
              <Rich text={t.batchUi.whyUnresolved(row.neededLabels.join(', ') || '—')} />
            </div>
          )}
        </td>
      </tr>

      {open && (
        <tr className="batch-detail">
          <td colSpan={5}>
            <div className="detail-grid">
              {row.routeChanged && row.before && (
                <div>
                  <b>{t.batchUi.detailBefore}</b>
                  {row.before.length === 0 ? (
                    <span className="hint">{t.batchUi.noRouteMatched}</span>
                  ) : (
                    row.before.map((d, i) => (
                      <div className="path-list" key={i}>
                        <div className="cell-sub path">{describePath(d.path)}</div>
                        <div className="hint">
                          → {d.receiver ?? t.tester.receiverUnset} · {outcomeLabel(d.outcome as Outcome)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              <div>
                <b>{row.routeChanged ? t.batchUi.detailAfter : t.batchUi.detailPath}</b>
                {row.destinations.map((d, i) => (
                  <div className="path-list" key={i}>
                    {d.path.map((n, depth) => (
                      <button
                        type="button"
                        className="path-step"
                        key={`${n.id}-${depth}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectNode(n.id);
                        }}
                      >
                        <span className="dot">{depth === 0 ? '⌂' : '→'}</span>
                        <span>
                          {n.isRoot
                            ? t.tester.rootRoute
                            : n.matchers.map((m) => <code key={m.id}>{m.raw}</code>)}
                        </span>
                      </button>
                    ))}
                    <div className="hint">
                      → {d.receiver === null ? t.tester.receiverUnset : d.receiver} ·{' '}
                      {outcomeLabel(d.outcome as Outcome)}
                    </div>
                  </div>
                ))}
              </div>

              {!exact && row.blockers.length > 0 && (
                <div>
                  <b>{t.batchUi.detailBlockers}</b>
                  <span className="hint">{t.batchUi.detailBlockersHint}</span>
                  <ul className="warn-list">
                    {row.blockers.map((a, i) => (
                      <li key={i}>
                        {a.matchers.map((m) => (
                          <code key={m}>{m}</code>
                        ))}{' '}
                        <button
                          type="button"
                          className="link-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectNode(a.nodeId);
                          }}
                        >
                          {t.batchUi.showRoute}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {onResolveRow && (
                    <button
                      type="button"
                      className="btn tiny primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onResolveRow(row);
                      }}
                    >
                      ↓ {t.batchUi.expandViaProm}
                    </button>
                  )}
                </div>
              )}

              {row.alert.expr && (
                <div>
                  <b>expr</b>
                  <pre className="detail-expr">{row.alert.expr}</pre>
                  {promUrl && (
                    <div className="load-actions">
                      <a
                        className="btn tiny"
                        href={promGraphUrl(promUrl, row.alert.expr)}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                      >
                        ↗ {t.batchUi.openInProm}
                      </a>
                      {stripFinalComparison(row.alert.expr) && (
                        <a
                          className="btn tiny"
                          href={promGraphUrl(promUrl, stripFinalComparison(row.alert.expr)!)}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={t.batchUi.withoutThresholdTitle}
                          onClick={(e) => e.stopPropagation()}
                        >
                          ↗ {t.batchUi.withoutThreshold}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {row.alert.enriched && row.alert.enriched.attempts.length > 0 && (
                <div>
                  <b>{t.batchUi.detailAttempts}</b>
                  <ul className="warn-list">
                    {row.alert.enriched.attempts.map((a, i) => (
                      <li key={i}>
                        <span className="badge">{t.batchUi.attempt[a.kind]}</span>{' '}
                        {t.batchUi.seriesCount(a.series)}
                        <div className="cell-sub path">{a.query}</div>
                      </li>
                    ))}
                  </ul>
                  <span className="hint">{row.alert.enriched.note}</span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* -------------------------------- exports -------------------------------- */

function csvCell(value: string): string {
  return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: BatchRow[]): string {
  const head = [
    'alert',
    'origin',
    'variant',
    'labels',
    'receivers_before',
    'receivers',
    'outcomes',
    'route_changed',
    'resolution',
    'needed_labels',
    'path',
  ];
  const lines = [head.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.alert.name,
        row.alert.origin,
        row.variant.title,
        Object.entries(row.labels)
          .map(([k, v]) => `${k}=${v}`)
          .join(' '),
        row.before ? row.before.map((d) => d.receiver ?? '').join(' | ') : '',
        row.destinations.map((d) => d.receiver ?? '').join(' | '),
        row.destinations.map((d) => d.outcome).join(' | '),
        row.routeChanged ? 'yes' : 'no',
        row.resolution,
        row.neededLabels.join(' '),
        describePath(row.destinations[0]?.path ?? []),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function toMarkdown(rows: BatchRow[], t: Dict): string {
  const lines = [
    `| ${t.batchUi.colAlert} | ${t.batchUi.colLabels} | Receiver | ${t.batchUi.colOutcome} |`,
    '|---|---|---|---|',
  ];
  for (const row of rows) {
    const labels = Object.entries(row.labels)
      .filter(([k]) => k !== 'alertname')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    const receiver =
      row.resolution === 'exact' ? row.destinations.map((d) => d.receiver ?? '—').join(', ') : '—';
    const outcome =
      row.resolution === 'exact'
        ? row.destinations.map((d) => outcomeLabel(d.outcome as Outcome)).join(', ')
        : `${resolutionLabel(row.resolution)}${
            row.neededLabels.length > 0 ? ` (${row.neededLabels.join(', ')})` : ''
          }`;
    lines.push(`| ${row.alert.name} | \`${labels}\` | ${receiver} | ${outcome} |`);
  }
  return `${lines.join('\n')}\n`;
}

function download(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
