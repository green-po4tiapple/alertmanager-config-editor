/**
 * Writes real Alertmanager configs produced by our serializer into `amtool-out/`.
 * In CI the next step runs `amtool check-config` over them, which means the export
 * is validated by the REAL Alertmanager parser and not only by our own tests.
 *
 * The same thing locally:
 *   npm test && docker run --rm -v "$PWD/amtool-out:/cfg" --entrypoint amtool \
 *     prom/alertmanager:v0.28.1 check-config /cfg/*.yaml
 */

import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CONFIG } from '../demo/exampleConfig';
import { parseConfig } from './parse';
import { serializeRoute } from './serialize';
import { receiversInTree } from './tree';
import { yamlScalar } from './serialize';
import type { RouteNode } from './types';

const OUT_DIR = 'amtool-out';

/** Configs covering every construct we support. */
const FIXTURES: Record<string, string> = {
  'basic.yaml': `route:
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
`,
  'legacy-match.yaml': `route:
  receiver: default_rcv
  routes:
    - receiver: legacy_rcv
      match:
        severity: critical
      match_re:
        cluster: prod-.+
`,
  'time-intervals.yaml': `route:
  receiver: default_rcv
  routes:
    - receiver: night_rcv
      matchers:
        - severity="warning"
      mute_time_intervals:
        - night
`,
  'tricky-names.yaml': `route:
  receiver: "null"
  routes:
    - receiver: "billing_oncall_critical"
      matchers:
        - product=~"(?i)^billing$"
        - severity="critical"
    - receiver: team_a.b
      matchers:
        - msg=~"a|b"
`,
};

/** Minimal scaffolding so amtool accepts the file: receivers + time intervals. */
function wrap(routeYaml: string, root: RouteNode): string {
  const names = new Set(receiversInTree(root));
  names.add('default_rcv');
  const receivers = [...names]
    .map((n) => `  - name: ${yamlScalar(n)}`)
    .join('\n');
  return `${routeYaml}receivers:
${receivers}
time_intervals:
  - name: night
    time_intervals:
      - times:
          - start_time: '00:00'
            end_time: '06:00'
`;
}

describe('fixtures for amtool check-config', () => {
  it('writes configs produced by our own serializer', () => {
    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });

    for (const [name, source] of Object.entries(FIXTURES)) {
      const parsed = parseConfig(source);
      if (!parsed.ok) throw new Error(`${name}: ${parsed.error}`);

      const routeYaml = serializeRoute(parsed.root);
      // The export must parse back with our own parser…
      const again = parseConfig(routeYaml);
      expect(again.ok, `${name} did not parse back`).toBe(true);

      writeFileSync(`${OUT_DIR}/${name}`, wrap(routeYaml, parsed.root), 'utf8');
    }

    // The bundled example is a complete config in its own right, so it goes to
    // amtool as-is: the demo everyone sees first must be a config Alertmanager
    // would actually accept.
    writeFileSync(`${OUT_DIR}/example.yaml`, EXAMPLE_CONFIG, 'utf8');

    // …while the real validation is done by amtool in a separate CI step.
    expect(readdirSync(OUT_DIR).sort()).toEqual(
      [...Object.keys(FIXTURES), 'example.yaml'].sort(),
    );
  });
});
