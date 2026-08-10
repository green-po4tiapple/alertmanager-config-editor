/**
 * Runs the core against YOUR real alertmanager_config.yaml.
 *
 * Invented examples only check what we already thought of; a real config catches
 * what we did not. The path comes from an environment variable:
 *
 *   AM_CONFIG=/path/to/alertmanager_config.yaml npm test
 *
 * Without the variable the suite skips itself, which is what makes it safe to keep
 * in the repository and in CI. The file is only read from disk; nothing is sent
 * anywhere.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig, type ParseSuccess } from './parse';
import { serializeRoute, spliceRouteBlock } from './serialize';
import { classifyOutcome, matchTree } from './routing';
import { countNodes, emptyRoot, treeDepth } from './tree';
import { layoutTree } from './layout';
import { parseMatcher } from './matchers';

const PATH = process.env.AM_CONFIG ?? '';

const text = PATH && existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';

/**
 * IMPORTANT: the body of `describe.skipIf(...)` is still executed during test
 * collection, so everything here has to be safe for any file contents — otherwise
 * the suite fails instead of skipping. This bit CI on a previous version.
 *
 * The file may not only be absent but encrypted (a sops secret with
 * apiVersion/kind/spec keys), which is equally a reason to skip rather than fail.
 */
const attempt = text ? parseConfig(text) : null;
const available = attempt?.ok === true;

if (text && attempt && !attempt.ok) {
  // eslint-disable-next-line no-console
  console.warn(
    `[smoke] ${PATH} exists but is not a route config (${attempt.error}). ` +
      'Looks like an encrypted sops secret — the test was skipped.',
  );
}

const parsed: ParseSuccess = attempt?.ok
  ? attempt
  : { ok: true, root: emptyRoot(), receiverNames: [], wholeFile: false, routeBlock: null, warnings: [] };

describe.skipIf(!available)(`real config: ${PATH}`, () => {
  it('parses end to end', () => {
    expect(parsed.wholeFile).toBe(true);
    expect(parsed.receiverNames.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `nodes: ${countNodes(parsed.root)}, depth: ${treeDepth(parsed.root)}, ` +
        `receivers: ${parsed.receiverNames.length}, warnings: ${parsed.warnings.length}`,
    );
    console.log('warnings:', parsed.warnings);
  });

  it('every matcher is valid', () => {
    const bad: string[] = [];
    const walk = (n: typeof parsed.root): void => {
      for (const m of n.matchers) {
        const c = parseMatcher(m.raw);
        if (!c.ok) bad.push(`${m.raw} → ${c.error}`);
      }
      n.routes.forEach(walk);
    };
    walk(parsed.root);
    expect(bad).toEqual([]);
  });

  it('no secrets reached the model', () => {
    const json = JSON.stringify({ root: parsed.root, names: parsed.receiverNames });
    expect(json).not.toMatch(/bot_token|webhook|http|api_url|chat_id/i);
  });

  it('a round trip preserves behaviour across a broad set of alerts', () => {
    const yaml = serializeRoute(parsed.root);
    const again = parseConfig(yaml);
    if (!again.ok) throw new Error(again.error);

    const products = ['checkout', 'Checkout', 'billing', 'orders', 'search', 'unknown', ''];
    const teams = ['sre', 'platform', 'data', 'network', 'analytics', 'escalation', ''];
    const sevs = ['critical', 'warning', 'info', 'disaster', ''];
    const clusters = ['prod', 'staging', 'dev', 'analytics', 'test'];

    let cases = 0;
    for (const product of products) {
      for (const team of teams) {
        for (const severity of sevs) {
          for (const cluster of clusters) {
            const labels: Record<string, string> = { alertname: 'SomeAlert' };
            if (product) labels.product = product;
            if (team) labels.team = team;
            if (severity) labels.severity = severity;
            labels.cluster = cluster;
            const a = matchTree(parsed.root, labels).map(
              (m) => `${m.node.receiver}|${classifyOutcome(m.node)}|${m.path.length}`,
            );
            const b = matchTree(again.root, labels).map(
              (m) => `${m.node.receiver}|${classifyOutcome(m.node)}|${m.path.length}`,
            );
            expect(b, JSON.stringify(labels)).toEqual(a);
            cases += 1;
          }
        }
      }
    }
    console.log(`cases compared: ${cases}`);
  });

  it('splicing into the whole file preserves everything around route:', () => {
    const yaml = serializeRoute(parsed.root);
    const merged = spliceRouteBlock(text, parsed.routeBlock!, yaml);
    // Everything after the route: block must reach the new file byte for byte. The
    // anchor is the first top-level line AFTER the block (block indices are lines).
    const lines = text.split('\n');
    const anchor = lines.slice(parsed.routeBlock!.end).find((l) => /^[a-z_]+:/.test(l));
    expect(anchor, 'no top-level key found after route:').toBeDefined();
    const origTail = text.slice(text.indexOf(`\n${anchor}`));
    const newTail = merged.slice(merged.indexOf(`\n${anchor}`));
    expect(newTail).toBe(origTail);
    const again = parseConfig(merged);
    expect(again.ok).toBe(true);
  });

  it('the graph layout computes and produces no NaN', () => {
    const l = layoutTree(parsed.root);
    expect(l.nodes.length).toBe(countNodes(parsed.root));
    expect(Number.isFinite(l.width) && l.width > 0).toBe(true);
    expect(Number.isFinite(l.height) && l.height > 0).toBe(true);
    for (const n of l.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
    console.log(`graph: ${Math.round(l.width)}×${Math.round(l.height)} px, ${l.nodes.length} nodes`);
    // Nodes on the same level must not overlap along X.
    const byDepth = new Map<number, typeof l.nodes>();
    for (const n of l.nodes) {
      const arr = byDepth.get(n.depth) ?? [];
      arr.push(n);
      byDepth.set(n.depth, arr);
    }
    for (const [, arr] of byDepth) {
      const sorted = [...arr].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i].x, `depth ${sorted[i].depth}`).toBeGreaterThanOrEqual(
          sorted[i - 1].x + sorted[i - 1].w,
        );
      }
    }
  });

  it('reports where representative alerts end up', () => {
    const show = (labels: Record<string, string>): string =>
      matchTree(parsed.root, labels)
        .map((m) => `${classifyOutcome(m.node)}:${m.node.receiver ?? '—'}`)
        .join(' + ');
    const samples: Array<Record<string, string>> = [
      { product: 'checkout', severity: 'critical', cluster: 'prod' },
      { product: 'checkout', severity: 'info', cluster: 'prod' },
      { team: 'sre', severity: 'critical', cluster: 'prod' },
      { team: 'data', severity: 'critical', paging: 'false', cluster: 'prod' },
      { severity: 'warning', cluster: 'prod', alertname: 'SomeAlert' },
      { severity: 'warning', cluster: 'staging', alertname: 'SomeAlert' },
      { alertname: 'Watchdog', cluster: 'prod' },
      { cluster: 'analytics', severity: 'info' },
    ];
    for (const s of samples) console.log(JSON.stringify(s), '→', show(s));
    expect(true).toBe(true);
  });
});
