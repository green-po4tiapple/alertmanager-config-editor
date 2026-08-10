import { describe, expect, it } from 'vitest';
import { EXAMPLE_CONFIG, demoRequested } from './exampleConfig';
import { parseConfig } from '../core/parse';
import { serializeRoute } from '../core/serialize';
import { classifyOutcome, matchTree } from '../core/routing';
import type { Labels } from '../core/matchers';

function tree() {
  const parsed = parseConfig(EXAMPLE_CONFIG);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
}

/** Receivers an alert reaches, with the outcome of each. */
function route(labels: Labels): string[] {
  return matchTree(tree().root, labels).map(
    (m) => `${classifyOutcome(m.node)}:${m.node.receiver ?? '—'}`,
  );
}

describe('bundled example config', () => {
  it('parses as a whole file and yields the receiver names', () => {
    const parsed = tree();
    expect(parsed.wholeFile).toBe(true);
    expect(parsed.receiverNames).toContain('payments_pager');
    expect(parsed.receiverNames).toContain('null');
    expect(parsed.warnings.length).toBeGreaterThan(0); // legacy match/match_re notes
  });

  it('survives a round trip through the serializer', () => {
    const parsed = tree();
    const again = parseConfig(serializeRoute(parsed.root));
    expect(again.ok).toBe(true);
  });

  /*
   * The next three tests pin the demo's teaching points. If one of them fails
   * because the example was "tidied up", restore the example rather than the test:
   * an example where nothing can go wrong demonstrates nothing.
   */

  it('shows continue: a critical payments alert reaches two receivers', () => {
    expect(route({ alertname: 'DbDown', team: 'payments', severity: 'critical' })).toEqual([
      'delivered:incident_room',
      'delivered:payments_pager',
    ]);
  });

  it('shows a silent loss: payments has no route for severity=info', () => {
    expect(route({ alertname: 'SlowQuery', team: 'payments', severity: 'info' })).toEqual([
      'drop-no-receiver:—',
    ]);
  });

  it('shows a dead route: product!~".*" can never match', () => {
    const withProduct = route({ alertname: 'X', product: 'checkout', severity: 'warning' });
    const withoutProduct = route({ alertname: 'X', team: 'platform', severity: 'warning' });
    expect(withProduct.join(' ')).not.toContain('chatops');
    expect(withoutProduct.join(' ')).not.toContain('chatops');
  });

  it('drops heartbeat alerts deliberately', () => {
    expect(route({ alertname: 'Watchdog' })).toEqual(['drop-null:null']);
  });
});

describe('demoRequested', () => {
  it('reacts only to demo=1', () => {
    expect(demoRequested('?demo=1')).toBe(true);
    expect(demoRequested('?demo=0')).toBe(false);
    expect(demoRequested('?other=1')).toBe(false);
    expect(demoRequested('')).toBe(false);
  });
});
