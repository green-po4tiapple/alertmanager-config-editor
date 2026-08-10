import { describe, expect, it } from 'vitest';
import { dict } from '../i18n/dict';
import { parseAlertSource } from './alertSources';
import { evaluateBatch, explainRoute, summarize, NO_VARIANT } from './batch';
import { extractSelectors, labelNamesInExpr, stripFinalComparison } from './promql';
import { parseConfig } from './parse';
import type { RouteNode } from './types';

function tree(yaml: string): RouteNode {
  const r = parseConfig(yaml);
  if (!r.ok) throw new Error(r.error);
  return r.root;
}

/** A trimmed-down real-world tree: products, teams, drops by namespace/cluster. */
const CONFIG = `route:
  receiver: "null"
  routes:
    - receiver: "null"
      matchers:
        - alertname=~"Watchdog|InfoInhibitor"
    - receiver: "null"
      matchers:
        - namespace=~"shop.*"
        - namespace!="shop-prod"
    - receiver: "null"
      matchers:
        - cluster=~"staging|dev"
        - product!~".+"
    - matchers:
        - product=~".+"
      routes:
        - matchers:
            - product=~"(?i)^checkout$"
          routes:
            - receiver: checkout_oncall_critical
              matchers:
                - severity="critical"
            - receiver: checkout_oncall_warning
              matchers:
                - severity="warning"
    - matchers:
        - team=~".+"
      routes:
        - receiver: sre_oncall_critical
          matchers:
            - team="sre"
            - severity="critical"
    - receiver: ops_oncall_warning
      matchers:
        - severity=~"warning|critical"
`;

describe('promql', () => {
  it('extracts selectors and does not mistake functions for metrics', () => {
    expect(extractSelectors('rate(http_requests_total{job="api"}[5m]) > 0.5')).toEqual([
      'http_requests_total{job="api"}',
    ]);
    expect(
      extractSelectors('max by (namespace, deployment) (kube_deployment_status{image!~"cr.yandex.*"}) == 0'),
    ).toEqual(['kube_deployment_status{image!~"cr.yandex.*"}']);
    expect(extractSelectors('up == 0')).toEqual(['up']);
  });

  it('does not confuse string contents with metric names', () => {
    expect(extractSelectors('foo{msg="rate(bar) sum"} > 1')).toEqual(['foo{msg="rate(bar) sum"}']);
  });

  it('does not treat time units or grouping labels as metrics', () => {
    // Found on a real rule corpus: `offset 1d` used to yield a "metric" named d.
    expect(extractSelectors('max(pg_replication offset 1d) > 0')).toEqual(['pg_replication']);
    expect(extractSelectors('sum(rate(container_oom[5m])) by (namespace, pod) > 0')).toEqual([
      'container_oom',
    ]);
    expect(extractSelectors('avg_over_time(up[1h:1m]) < 0.5')).toEqual(['up']);
  });

  it('collects label names from selectors and grouping', () => {
    const names = labelNamesInExpr('sum by (namespace, pod) (kube_pod_status{job="kubelet"}) > 0');
    expect(names.sort()).toEqual(['job', 'namespace', 'pod']);
  });

  it('strips the final threshold but leaves a series-to-series comparison alone', () => {
    expect(stripFinalComparison('rate(x[5m]) > 0.5')).toBe('rate(x[5m])');
    expect(stripFinalComparison('sum(a) == 0')).toBe('sum(a)');
    expect(stripFinalComparison('a > b')).toBeNull();
    expect(stripFinalComparison('foo{x=~"a>b"}')).toBeNull();
  });
});

describe('parseAlertSource', () => {
  it('parses a PrometheusRule dump', () => {
    const r = parseAlertSource(`apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: shop-rules
  namespace: monitoring
spec:
  groups:
    - name: shop
      rules:
        - alert: CheckoutDown
          expr: up{job="checkout"} == 0
          labels:
            severity: critical
            product: checkout
        - record: job:up:sum
          expr: sum(up)
        - alert: KubeJobFailed
          expr: kube_job_failed > 0
          labels:
            severity: warning
`);
    expect(r.format).toBe('prometheus-rule-crd');
    expect(r.alerts.map((a) => a.name)).toEqual(['CheckoutDown', 'KubeJobFailed']);
    expect(r.alerts[0].labels).toEqual({
      severity: 'critical',
      product: 'checkout',
      alertname: 'CheckoutDown',
    });
    expect(r.alerts[0].selectors).toEqual(['up{job="checkout"}']);
    // record rules are not alerts and must stay out of the selection.
    expect(r.alerts).toHaveLength(2);
  });

  it('parses an /api/v1/rules response', () => {
    const r = parseAlertSource(
      JSON.stringify({
        status: 'success',
        data: {
          groups: [
            {
              name: 'k8s',
              file: '/etc/rules/k8s.yaml',
              rules: [
                { type: 'alerting', name: 'PodCrash', query: 'kube_pod_restarts > 3', labels: { severity: 'warning' } },
                { type: 'recording', name: 'job:up', query: 'sum(up)' },
              ],
            },
          ],
        },
      }),
    );
    expect(r.format).toBe('prometheus-rules-api');
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].expr).toBe('kube_pod_restarts > 3');
  });

  it('parses Alertmanager firing alerts and marks their labels complete', () => {
    const r = parseAlertSource(
      JSON.stringify([
        { labels: { alertname: 'Watchdog', severity: 'none', cluster: 'analytics' } },
        { labels: { alertname: 'PodCrash', severity: 'warning', namespace: 'shop-dev' } },
      ]),
    );
    expect(r.format).toBe('alerts-api');
    expect(r.alerts.every((a) => a.complete)).toBe(true);
    expect(r.alerts[1].labels.namespace).toBe('shop-dev');
  });

  it('parses CSV', () => {
    const r = parseAlertSource('alertname,product,severity\nFoo,checkout,critical\nBar,billing,warning');
    expect(r.format).toBe('csv');
    expect(r.alerts).toHaveLength(2);
    expect(r.alerts[0].labels).toEqual({
      alertname: 'Foo',
      product: 'checkout',
      severity: 'critical',
    });
  });

  it('fails with a comprehensible message on garbage', () => {
    // Compared against the dictionary rather than a literal, so rewording a message
    // does not silently turn these into assertions about nothing.
    expect(() => parseAlertSource('')).toThrow(dict().source.emptyInput);
    expect(() => parseAlertSource('{"foo": 1}')).toThrow(dict().source.unknownJson);
    expect(() => parseAlertSource('just: text')).toThrow(dict().source.noAlertingRules);
  });
});

describe('explainRoute: what is known and what is not', () => {
  const root = tree(CONFIG);

  it('with a complete label set the answer is exact', () => {
    const e = explainRoute(
      root,
      { alertname: 'X', product: 'checkout', severity: 'critical', cluster: 'prod' },
      { known: null },
    );
    expect(e.certain).toBe(true);
    expect(e.results[0].node.receiver).toBe('checkout_oncall_critical');
  });

  it('spots a route that would have caught the alert under a different namespace', () => {
    // Only severity is known here: namespace and cluster are not.
    const labels = { alertname: 'KubeJobFailed', severity: 'warning' };
    const e = explainRoute(root, labels, {
      known: new Set(Object.keys(labels)),
    });
    expect(e.certain).toBe(false);
    expect(e.missingLabels).toContain('namespace');
    const couldMatch = e.ambiguities.filter((a) => a.kind === 'could-match');
    expect(couldMatch.some((a) => a.matchers.some((m) => m.includes('shop')))).toBe(true);
    // An answer is still produced, as if those labels simply did not exist.
    expect(e.results[0].node.receiver).toBe('ops_oncall_warning');
  });

  it('spots the reverse case: a route passed only because a label was absent', () => {
    // product!~".+" passes precisely because product is not set.
    const labels = { alertname: 'X', cluster: 'staging' };
    const e = explainRoute(root, labels, {
      known: new Set(Object.keys(labels)),
    });
    expect(e.results[0].node.receiver).toBe('null');
    const couldUnmatch = e.ambiguities.filter((a) => a.kind === 'could-unmatch');
    expect(couldUnmatch.some((a) => a.matchers.includes('product!~".+"'))).toBe(true);
    expect(e.missingLabels).toContain('product');
  });

  it('a label=~".*" matcher creates no uncertainty — it is always true', () => {
    const root2 = tree(`route:
  routes:
    - receiver: catch_all
      matchers:
        - whatever=~".*"
`);
    const e = explainRoute(root2, { alertname: 'X' }, { known: new Set(['alertname']) });
    expect(e.certain).toBe(true);
    expect(e.results[0].node.receiver).toBe('catch_all');
  });
});

describe('evaluateBatch', () => {
  const root = tree(CONFIG);
  const source = parseAlertSource(`groups:
  - name: demo
    rules:
      - alert: CheckoutDown
        expr: up{job="checkout"} == 0
        labels: {severity: critical, product: checkout}
      - alert: KubeJobFailed
        expr: kube_job_failed > 0
        labels: {severity: warning}
      - alert: Watchdog
        expr: vector(1)
        labels: {severity: none}
`);

  it('an unexpanded rule gets NO route, only the list of labels it needs', () => {
    const { rows } = evaluateBatch(root, source.alerts, {
      variants: [NO_VARIANT],
    });
    expect(rows).toHaveLength(3);

    // A rule is a template, not an alert: no route is computed for it at all.
    for (const row of rows) {
      expect(row.resolution).toBe('unresolved');
      expect(row.destinations).toEqual([]);
    }
    const kube = rows.find((r) => r.alert.name === 'KubeJobFailed')!;
    expect(kube.neededLabels).toContain('namespace');
    expect(kube.blockers.length).toBeGreaterThan(0);
  });

  it('a rule with no series means "no alerts", not "unknown route"', () => {
    const alerts = parseAlertSource(`groups:
  - name: demo
    rules:
      - alert: NeverFires
        expr: never_used_metric > 0
        labels: {severity: warning}
`).alerts;
    alerts[0].enriched = {
      status: 'no-data',
      note: 'metric never_used_metric does not exist in this TSDB at all',
      labelSets: [],
      attempts: [],
    };

    const { rows } = evaluateBatch(root, alerts, { variants: [NO_VARIANT] });
    expect(rows[0].resolution).toBe('no-series');
    expect(rows[0].destinations).toEqual([]);
  });

  it('a complete label set (CSV, firing alerts) always yields one definite route', () => {
    const csv = parseAlertSource(
      'alertname,product,severity\nCheckoutDown,checkout,critical\nWatchdog,,none',
    ).alerts;
    const { rows } = evaluateBatch(root, csv, { variants: [NO_VARIANT] });

    expect(rows.every((r) => r.resolution === 'exact')).toBe(true);
    expect(rows.every((r) => r.neededLabels.length === 0)).toBe(true);
    expect(rows[0].destinations[0].receiver).toBe('checkout_oncall_critical');
    expect(rows[1].destinations[0].outcome).toBe('drop-null');
  });

  it('external labels produce one row per variant', () => {
    const csv = parseAlertSource('alertname,severity\nKubeJobFailed,warning').alerts;
    const { rows } = evaluateBatch(root, csv, {
      variants: [
        { id: 'prod', title: 'cluster=prod', labels: { cluster: 'prod' } },
        { id: 'dev', title: 'cluster=staging', labels: { cluster: 'staging' } },
      ],
    });
    expect(rows).toHaveLength(2);

    const prod = rows.find((r) => r.variant.id === 'prod')!;
    const dev = rows.find((r) => r.variant.id === 'dev')!;
    // On the non-production cluster the same alert is swallowed by a drop route —
    // which is the whole point of running several variants.
    expect(prod.destinations[0].receiver).toBe('ops_oncall_warning');
    expect(dev.destinations[0].outcome).toBe('drop-null');
  });

  it('an expanded rule yields one row per series with an exact route', () => {
    const enriched = parseAlertSource(`groups:
  - name: demo
    rules:
      - alert: KubeJobFailed
        expr: kube_job_failed > 0
        labels: {severity: warning}
`).alerts;
    enriched[0].enriched = {
      status: 'exact',
      note: '',
      attempts: [],
      labelSets: [
        { namespace: 'shop-dev', severity: 'warning', alertname: 'KubeJobFailed' },
        { namespace: 'warehouse', severity: 'warning', alertname: 'KubeJobFailed' },
      ],
    };

    const { rows } = evaluateBatch(root, enriched, { variants: [NO_VARIANT] });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.resolution === 'exact')).toBe(true);
    expect(rows.every((r) => r.neededLabels.length === 0)).toBe(true);
    // shop-dev falls under the drop route, warehouse does not.
    expect(rows[0].destinations[0].outcome).toBe('drop-null');
    expect(rows[1].destinations[0].receiver).toBe('ops_oncall_warning');
    expect(rows[0].labelSet).toEqual({ index: 1, total: 2 });
  });

  it('summary: routes are counted only from resolved rows', () => {
    const csv = parseAlertSource(
      'alertname,product,severity\nCheckoutDown,checkout,critical\nWatchdog,,none',
    ).alerts;
    const s = summarize(
      evaluateBatch(root, csv, { variants: [NO_VARIANT] }).rows,
    );
    expect(s.delivered).toBe(1);
    expect(s.dropNull).toBe(1);
    expect(s.unresolved).toBe(0);
    expect(s.byReceiver.find((x) => x.receiver === 'checkout_oncall_critical')?.count).toBe(1);

    // Unexpanded rules do not enter the routing statistics at all.
    const rules = summarize(
      evaluateBatch(root, source.alerts, { variants: [NO_VARIANT] }).rows,
    );
    expect(rules.unresolved).toBe(3);
    expect(rules.delivered + rules.dropNull + rules.lost).toBe(0);
  });

  it('regression: shows which alerts an edit re-routed', () => {
    const before = tree(CONFIG);
    // The edit: add a severity="info" child to the checkout route.
    const after = tree(`route:
  receiver: "null"
  routes:
    - matchers:
        - product=~".+"
      routes:
        - matchers:
            - product=~"(?i)^checkout$"
          routes:
            - receiver: checkout_oncall_critical
              matchers:
                - severity="critical"
            - receiver: checkout_info
              matchers:
                - severity="info"
    - receiver: ops_oncall_warning
      matchers:
        - severity=~"warning|critical"
`);

    const csv = parseAlertSource(
      'alertname,product,severity\nA,checkout,critical\nB,checkout,info',
    ).alerts;
    const { rows } = evaluateBatch(after, csv, {
      variants: [NO_VARIANT],
      baselineRoot: before,
    });

    const [critical, info] = rows;
    // The critical alert's route did not change.
    expect(critical.routeChanged).toBe(false);
    expect(critical.before?.[0].receiver).toBe('checkout_oncall_critical');

    // The info alert used to be lost (the checkout route had no receiver of its own),
    // and now goes to a new receiver — which is exactly what the regression shows.
    expect(info.routeChanged).toBe(true);
    expect(info.before?.[0].outcome).toBe('drop-no-receiver');
    expect(info.destinations[0].receiver).toBe('checkout_info');

    expect(summarize(rows).routeChanged).toBe(1);
  });

  it('without a baseline tree no regression is computed and nothing is invented', () => {
    const csv = parseAlertSource('alertname,product,severity\nA,checkout,critical').alerts;
    const { rows } = evaluateBatch(tree(CONFIG), csv, {
      variants: [NO_VARIANT],
    });
    expect(rows[0].before).toBeNull();
    expect(rows[0].routeChanged).toBe(false);
  });

  it('unresolved rows stay out of the regression', () => {
    const { rows } = evaluateBatch(tree(CONFIG), source.alerts, {
      variants: [NO_VARIANT],
      baselineRoot: tree(CONFIG),
    });
    expect(rows.every((r) => r.before === null && !r.routeChanged)).toBe(true);
  });

  it('the maxRows cap keeps a huge dump from blowing up the table', () => {
    const { rows, truncated } = evaluateBatch(root, source.alerts, {
      variants: [NO_VARIANT],
      maxRows: 2,
    });
    expect(rows).toHaveLength(2);
    expect(truncated).toBe(1);
  });
});
