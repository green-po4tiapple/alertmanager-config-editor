import { describe, expect, it } from 'vitest';
import { parseConfig } from './parse';
import { matcherScalar, serializeRoute, yamlScalar } from './serialize';
import { matchTree } from './routing';
import type { RouteNode } from './types';

function roundtrip(text: string): { root: RouteNode; yaml: string; again: RouteNode } {
  const first = parseConfig(text);
  if (!first.ok) throw new Error(first.error);
  const yaml = serializeRoute(first.root);
  const second = parseConfig(yaml);
  if (!second.ok) throw new Error(`the export did not parse back: ${second.error}`);
  return { root: first.root, yaml, again: second.root };
}

/** Structural comparison ignoring ids — ids never reach the YAML. */
function shape(node: RouteNode): unknown {
  return {
    receiver: node.receiver,
    matchers: node.matchers.map((m) => [m.origin, m.raw]),
    continue: node.continue,
    repeatInterval: node.repeatInterval,
    groupWait: node.groupWait,
    groupInterval: node.groupInterval,
    groupBy: node.groupBy,
    mute: node.muteTimeIntervals,
    active: node.activeTimeIntervals,
    extra: node.extra,
    routes: node.routes.map(shape),
  };
}

const SAMPLE = `route:
  receiver: "null"
  group_by:
    - alertname
    - cluster
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 1d
  routes:
    - receiver: "null"
      matchers:
        - cluster=~"staging|dev|"
        - job!="node-exporter"
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
        - receiver: ops_oncall_warning
          repeat_interval: 30m
          matchers:
            - severity=~"warning|critical"
    - receiver: telegram
      matchers:
        - product!~".+"
      continue: true
    - receiver: with_intervals
      matchers:
        - a="1"
      mute_time_intervals:
        - night
      active_time_intervals:
        - workday
`;

describe('serializeRoute', () => {
  it('round trip: parse → serialize → parse yields the same tree', () => {
    const { root, again } = roundtrip(SAMPLE);
    expect(shape(again)).toEqual(shape(root));
  });

  it('matcher strings go out character for character, never re-quoted', () => {
    const { yaml } = roundtrip(SAMPLE);
    expect(yaml).toContain('- product=~"(?i)^checkout$"');
    expect(yaml).toContain('- cluster=~"staging|dev|"');
    expect(yaml).not.toContain('\\"');
  });

  it('receiver "null" stays a quoted string', () => {
    const { yaml, again } = roundtrip(SAMPLE);
    expect(yaml).toContain('receiver: "null"');
    expect(again.receiver).toBe('null');
  });

  it('a missing receiver does not appear in the output', () => {
    const { yaml } = roundtrip(SAMPLE);
    const productBranch = yaml.split('\n').slice(
      yaml.split('\n').findIndex((l) => l.includes('product=~".+"')) - 1,
    );
    // The product=~".+" route has no receiver:, so its first line is matchers:
    expect(productBranch[0].trim()).toBe('- matchers:');
  });

  it('continue: true is written only where it is actually set', () => {
    const { yaml } = roundtrip(SAMPLE);
    expect(yaml.match(/continue: true/g)).toHaveLength(1);
  });

  it('route order is preserved', () => {
    const { again } = roundtrip(SAMPLE);
    expect(again.routes.map((r) => r.receiver)).toEqual([
      'null',
      null,
      'telegram',
      'with_intervals',
    ]);
  });

  it('legacy match/match_re go back into their original keys', () => {
    const src = `route:
  routes:
    - receiver: legacy
      match:
        severity: critical
      match_re:
        cluster: prod-.+
`;
    const { yaml, again, root } = roundtrip(src);
    expect(yaml).toContain('match:');
    expect(yaml).toContain('severity: critical');
    expect(yaml).toContain('match_re:');
    // A value containing "+" gets quoted — still the same string to Alertmanager.
    expect(yaml).toContain('cluster: "prod-.+"');
    expect(yaml).not.toContain('matchers:');
    expect(shape(again)).toEqual(shape(root));
  });

  it('unknown keys are not lost', () => {
    const src = `route:
  routes:
    - receiver: x
      matchers:
        - a="1"
      some_future_key:
        nested: 42
        list:
          - one
`;
    const { yaml, again } = roundtrip(src);
    expect(yaml).toContain('some_future_key:');
    expect(again.routes[0].extra).toEqual({ some_future_key: { nested: 42, list: ['one'] } });
  });

  it('the export routes identically to the source', () => {
    const first = parseConfig(SAMPLE);
    if (!first.ok) throw new Error(first.error);
    const second = parseConfig(serializeRoute(first.root));
    if (!second.ok) throw new Error(second.error);

    const cases: Array<Record<string, string>> = [
      { product: 'checkout', severity: 'critical' },
      { product: 'checkout', severity: 'info' },
      { product: 'other', severity: 'warning' },
      { severity: 'warning' },
      { cluster: 'staging', job: 'kube-state' },
      {},
    ];
    for (const labels of cases) {
      const a = matchTree(first.root, labels).map((m) => m.node.receiver);
      const b = matchTree(second.root, labels).map((m) => m.node.receiver);
      expect(b, JSON.stringify(labels)).toEqual(a);
    }
  });
});

describe('scalar quoting', () => {
  it('risky values get quoted, safe ones do not', () => {
    expect(yamlScalar('ops_oncall_warning')).toBe('ops_oncall_warning');
    expect(yamlScalar('billing_oncall_critical')).toBe('billing_oncall_critical');
    expect(yamlScalar('null')).toBe('"null"');
    expect(yamlScalar('true')).toBe('"true"');
    expect(yamlScalar('yes')).toBe('"yes"');
    expect(yamlScalar('30')).toBe('"30"');
    expect(yamlScalar('')).toBe('""');
    expect(yamlScalar('name with a space')).toBe('"name with a space"');
    expect(yamlScalar('30m')).toBe('30m');
  });

  it('a matcher is quoted only when a plain scalar is impossible', () => {
    expect(matcherScalar('severity="critical"')).toBe('severity="critical"');
    expect(matcherScalar('product=~"(?i)^checkout$"')).toBe('product=~"(?i)^checkout$"');
    expect(matcherScalar('msg=~"a: b"')).toBe('"msg=~\\"a: b\\""');
    expect(matcherScalar('{a="b"}')).toBe('"{a=\\"b\\"}"');
  });
});
