import { describe, expect, it } from 'vitest';
import { dict } from '../i18n/dict';
import {
  buildHeaders,
  checkAlertmanager,
  fetchAlertmanagerConfig,
  checkConnection,
  enrichAlert,
  fetchAlertsJson,
  fetchRulesJson,
  queryUrl,
  type PromSource,
} from './enrich';
import { parseAlertSource } from './alertSources';
import { parseConfig } from './parse';

const SOURCE: PromSource = {
  url: 'https://prom.example/',
  timeoutMs: 5000,
  maxSeriesPerRule: 10,
};

/** Stub fetch: records the requests and returns canned responses. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: Array<{ url: string; headers: Record<string, string>; credentials?: string }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.credentials ? { credentials: init.credentials } : {}),
    });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => routes[key] } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('addresses and headers', () => {
  it('joins URLs without double slashes and encodes parameters', () => {
    expect(queryUrl(SOURCE, '/api/v1/query', { query: 'up{job="a b"} > 0' })).toBe(
      'https://prom.example/api/v1/query?query=up%7Bjob%3D%22a+b%22%7D+%3E+0',
    );
  });

  it('basic auth is added only when a username is set', () => {
    expect(buildHeaders(SOURCE)).not.toHaveProperty('Authorization');
    const withAuth = buildHeaders({ ...SOURCE, auth: { username: 'u', password: 'p' } }) as Record<
      string,
      string
    >;
    expect(withAuth.Authorization).toBe(`Basic ${btoa('u:p')}`);
  });
});

describe('fetching over the API', () => {
  it('pulls rules from Prometheus and returns parseable JSON', async () => {
    const rules = {
      status: 'success',
      data: {
        groups: [
          {
            name: 'k8s',
            file: 'k8s.yaml',
            rules: [
              { type: 'alerting', name: 'PodCrash', query: 'kube_pod_restarts > 3', labels: { severity: 'warning' } },
            ],
          },
        ],
      },
    };
    const { impl, calls } = fakeFetch({ '/api/v1/rules': rules });

    const json = await fetchRulesJson(SOURCE, impl);
    expect(calls[0].url).toContain('/api/v1/rules?type=alert');
    // No cookies are sent: somebody else's session is none of our business.
    expect(calls[0].credentials).toBe('omit');

    const parsed = parseAlertSource(json);
    expect(parsed.format).toBe('prometheus-rules-api');
    expect(parsed.alerts[0].name).toBe('PodCrash');
  });

  it('pulls firing alerts from Alertmanager, whose labels count as complete', async () => {
    const alerts = [{ labels: { alertname: 'Watchdog', severity: 'none', cluster: 'prod' } }];
    const { impl, calls } = fakeFetch({ '/api/v2/alerts': alerts });

    const json = await fetchAlertsJson({ ...SOURCE, url: 'https://am.example' }, impl);
    expect(calls[0].url).toBe('https://am.example/api/v2/alerts?');

    const parsed = parseAlertSource(json);
    expect(parsed.format).toBe('alerts-api');
    expect(parsed.alerts[0].complete).toBe(true);
  });

  it('fetches the Alertmanager config from /api/v2/status', async () => {
    const original = 'route:\n  receiver: "null"\n  routes:\n    - receiver: telegram\n';
    const { impl, calls } = fakeFetch({ '/api/v2/status': { config: { original } } });

    const text = await fetchAlertmanagerConfig({ ...SOURCE, url: 'https://am.example' }, impl);
    expect(calls[0].url).toBe('https://am.example/api/v2/status?');
    expect(text).toBe(original);
    // And it parses straight away with the main config parser.
    const parsed = parseConfig(text);
    expect(parsed.ok && parsed.root.routes).toHaveLength(1);
  });

  it('an empty config.original gives a clear error, not a silent blank screen', async () => {
    const { impl } = fakeFetch({ '/api/v2/status': { config: {} } });
    await expect(
      fetchAlertmanagerConfig({ ...SOURCE, url: 'https://am.example' }, impl),
    ).rejects.toThrow(dict().enrich.noConfigOriginal);
  });

  it('the connection check reports the version of both services', async () => {
    const prom = fakeFetch({ '/api/v1/status/buildinfo': { status: 'success', data: { version: '3.11.3' } } });
    expect(await checkConnection(SOURCE, prom.impl)).toBe(dict().enrich.version('3.11.3'));

    const am = fakeFetch({ '/api/v2/status': { versionInfo: { version: '0.28.1' } } });
    expect(await checkAlertmanager(SOURCE, am.impl)).toBe(dict().enrich.version('0.28.1'));
  });

  it('an HTTP error becomes a readable message rather than escaping as an exception', async () => {
    const { impl } = fakeFetch({});
    await expect(checkConnection(SOURCE, impl)).rejects.toThrow(/HTTP 404/);
  });
});

describe('enriching a single rule', () => {
  const alert = () =>
    parseAlertSource(`groups:
  - name: g
    rules:
      - alert: PodCrash
        expr: kube_pod_restarts{job="kubelet"} > 3
        labels: {severity: warning}
`).alerts[0];

  it('rule is firing → labels come from the expr itself, status exact', async () => {
    const { impl, calls } = fakeFetch({
      '/api/v1/query': {
        data: {
          result: [
            { metric: { __name__: 'kube_pod_restarts', namespace: 'prod', pod: 'api-1' } },
            { metric: { __name__: 'kube_pod_restarts', namespace: 'dev', pod: 'api-2' } },
          ],
        },
      },
    });

    const e = await enrichAlert(alert(), SOURCE, impl);
    expect(e.status).toBe('exact');
    expect(e.labelSets).toHaveLength(2);
    // __name__ is dropped, and rule labels win over series labels.
    expect(e.labelSets[0]).toEqual({ namespace: 'prod', pod: 'api-1', severity: 'warning', alertname: 'PodCrash' });
    expect(calls).toHaveLength(1);
  });

  it('rule is not firing → retried without the final threshold, status approx', async () => {
    let call = 0;
    const impl = (async (input: RequestInfo | URL) => {
      call += 1;
      const empty = call === 1;
      const url = String(input);
      // The second query must go out without the "> 3" threshold.
      if (!empty) expect(decodeURIComponent(url)).not.toContain('> 3');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: { result: empty ? [] : [{ metric: { namespace: 'prod' } }] } }),
      } as Response;
    }) as unknown as typeof fetch;

    const e = await enrichAlert(alert(), SOURCE, impl);
    expect(e.status).toBe('approx');
    expect(e.labelSets[0].namespace).toBe('prod');
    expect(call).toBe(2);
  });

  it('no series and no metric at all → no-data, with every attempt visible', async () => {
    let call = 0;
    const impl = (async (input: RequestInfo | URL) => {
      call += 1;
      const url = String(input);
      const body = url.includes('/api/v1/series') ? { data: [] } : { data: { result: [] } };
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }) as unknown as typeof fetch;

    const e = await enrichAlert(alert(), SOURCE, impl);
    expect(e.status).toBe('no-data');
    expect(e.note).toContain('kube_pod_restarts');
    // Three attempts: the expression, the same without threshold, then an existence check.
    expect(e.attempts.map((a) => a.kind)).toEqual([
      'expr',
      'expr-without-threshold',
      'series-exists',
    ]);
    expect(call).toBe(3);
  });

  it('metric exists but filters matched nothing → no-match, not merely "empty"', async () => {
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/api/v1/series')
        ? { data: [{ __name__: 'kube_pod_restarts', namespace: 'other' }] }
        : { data: { result: [] } };
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }) as unknown as typeof fetch;

    const e = await enrichAlert(alert(), SOURCE, impl);
    expect(e.status).toBe('no-match');
    expect(e.note).toBe(dict().enrich.metricPresentNoMatch('kube_pod_restarts', 1));
    expect(e.attempts.at(-1)).toMatchObject({ kind: 'series-exists', series: 1 });
  });

  it('network failure → status error, not a crash of the whole run', async () => {
    const impl = (async () => {
      throw new Error('Failed to fetch');
    }) as unknown as typeof fetch;
    const e = await enrichAlert(alert(), SOURCE, impl);
    expect(e.status).toBe('error');
    expect(e.note).toContain('Failed to fetch');
    expect(e.labelSets).toEqual([]);
  });

  it('series are deduplicated and capped by the limit', async () => {
    const { impl } = fakeFetch({
      '/api/v1/query': {
        data: {
          result: [
            { metric: { namespace: 'a' } },
            { metric: { namespace: 'a' } },
            { metric: { namespace: 'b' } },
            { metric: { namespace: 'c' } },
          ],
        },
      },
    });
    const e = await enrichAlert(alert(), { ...SOURCE, maxSeriesPerRule: 2 }, impl);
    expect(e.labelSets.map((l) => l.namespace)).toEqual(['a', 'b']);
  });
});
