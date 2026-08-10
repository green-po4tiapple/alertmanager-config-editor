import { describe, expect, it } from 'vitest';
import { parseConfig } from './parse';
import { classifyOutcome, matchTree } from './routing';
import type { RouteNode } from './types';

function tree(yaml: string): RouteNode {
  const r = parseConfig(yaml);
  if (!r.ok) throw new Error(r.error);
  return r.root;
}

/** Compact test result: [receiver|<state>, …]. */
function receivers(root: RouteNode, labels: Record<string, string>) {
  return matchTree(root, labels).map((m) => {
    const outcome = classifyOutcome(m.node);
    if (outcome === 'delivered') return m.node.receiver!;
    if (outcome === 'drop-null') return '<null>';
    return '<no-receiver>';
  });
}

const CONFIG = `
route:
  receiver: "null"
  group_by: [alertname]
  routes:
    - receiver: "null"
      matchers:
        - alertname=~"Watchdog|InfoInhibitor"
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

describe('route order and precedence', () => {
  it('the first matching route without continue stops the sibling scan', () => {
    const root = tree(CONFIG);
    // Watchdog matches the first route, so the product route is never reached.
    expect(receivers(root, { alertname: 'Watchdog', product: 'checkout', severity: 'critical' })).toEqual(
      ['<null>'],
    );
  });

  it('descends and picks the leaf by severity', () => {
    const root = tree(CONFIG);
    expect(
      receivers(root, { product: 'Checkout', severity: 'critical', alertname: 'Anything' }),
    ).toEqual(['checkout_oncall_critical']);
    expect(receivers(root, { product: 'checkout', severity: 'warning' })).toEqual([
      'checkout_oncall_warning',
    ]);
  });

  it('a receiver is NOT inherited: an uncovered severity falls through to the fallback sibling', () => {
    const root = tree(CONFIG);
    // product=checkout, severity=info: nothing matched inside the checkout route,
    // and that route has no receiver of its own → it becomes the match itself.
    expect(receivers(root, { product: 'checkout', severity: 'info' })).toEqual(['<no-receiver>']);
  });

  it('a fallback sibling inside a product route catches a warning from an unknown product', () => {
    const root = tree(CONFIG);
    expect(receivers(root, { product: 'unknown-product', severity: 'warning' })).toEqual([
      'ops_oncall_warning',
    ]);
  });

  it('continue: true yields several receivers at once', () => {
    const root = tree(CONFIG);
    // product is absent → the telegram route (continue) plus the next fitting route.
    expect(receivers(root, { team: 'sre', severity: 'critical' })).toEqual([
      'telegram',
      'sre_oncall_critical',
    ]);
  });

  it('after a continue route the scan reaches the last sibling', () => {
    const root = tree(CONFIG);
    expect(receivers(root, { severity: 'warning' })).toEqual(['telegram', 'ops_oncall_warning']);
  });
});

describe('real-world traps found in configs', () => {
  it('label!~".*" never matches, while label!~".+" means "empty or absent"', () => {
    const root = tree(`
route:
  routes:
    - receiver: star
      matchers:
        - product!~".*"
    - receiver: plus
      matchers:
        - product!~".+"
`);
    // .* matches the empty string too, so the negation is false for everything.
    expect(receivers(root, {})).toEqual(['plus']);
    expect(receivers(root, { product: 'payments' })).toEqual(['<no-receiver>']);
  });
});

describe('matchers within one route are AND-ed', () => {
  it('every matcher must pass', () => {
    const root = tree(`
route:
  routes:
    - receiver: data_team_warning
      matchers:
        - severity="critical"
        - paging="false"
    - receiver: data_team_critical
      matchers:
        - severity="critical"
`);
    expect(receivers(root, { severity: 'critical', paging: 'false' })).toEqual([
      'data_team_warning',
    ]);
    expect(receivers(root, { severity: 'critical' })).toEqual(['data_team_critical']);
  });
});

describe('outcome classification', () => {
  it('distinguishes an explicit null, a missing receiver and delivery', () => {
    const root = tree(`
route:
  routes:
    - receiver: "null"
      matchers:
        - a="drop"
    - matchers:
        - a="lost"
      routes:
        - receiver: never
          matchers:
            - b="never"
    - receiver: real
      matchers:
        - a="ok"
`);
    const r1 = matchTree(root, { a: 'drop' });
    expect(classifyOutcome(r1[0].node)).toBe('drop-null');
    expect(r1[0].node.receiver).toBe('null');

    const r2 = matchTree(root, { a: 'lost' });
    expect(classifyOutcome(r2[0].node)).toBe('drop-no-receiver');
    expect(r2[0].node.receiver).toBeNull();

    const r3 = matchTree(root, { a: 'ok' });
    expect(classifyOutcome(r3[0].node)).toBe('delivered');
  });

  it('the root becomes the match when no route fits', () => {
    const root = tree(`
route:
  receiver: "null"
  routes:
    - receiver: x
      matchers:
        - a="1"
`);
    const r = matchTree(root, { a: '2' });
    expect(r).toHaveLength(1);
    expect(r[0].node.isRoot).toBe(true);
    expect(classifyOutcome(r[0].node)).toBe('drop-null');
  });
});

describe('the matched path', () => {
  it('contains every route from the root down to the terminal one', () => {
    const root = tree(CONFIG);
    const r = matchTree(root, { product: 'checkout', severity: 'critical' });
    expect(r).toHaveLength(1);
    expect(r[0].path.map((n) => (n.isRoot ? 'root' : n.matchers.map((m) => m.raw).join('&')))).toEqual(
      ['root', 'product=~".+"', 'product=~"(?i)^checkout$"', 'severity="critical"'],
    );
  });
});
