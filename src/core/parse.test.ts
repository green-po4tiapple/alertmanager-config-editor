import { describe, expect, it } from 'vitest';
import { dict } from '../i18n/dict';
import { findRouteBlock, parseConfig } from './parse';
import { serializeRoute, spliceRouteBlock } from './serialize';

const WHOLE_FILE = `---
route:
  receiver: "null"
  group_by:
    - alertname
    - cluster
  routes:
    - receiver: "null"
      matchers:
        - cluster=~"staging|dev|pci-test"
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
    - receiver: telegram
      matchers:
        - product!~".+"
      continue: true
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 1d
inhibit_rules:
  - source_matchers:
      - severity="critical"
    target_matchers:
      - severity=~"warning|info"
receivers:
  - name: "null"
  - name: telegram
    telegram_configs:
      - bot_token: SUPER-SECRET-TOKEN
        chat_id: -100500
  - name: checkout_oncall_critical
    webhook_configs:
      - url: https://internal.example/hook?token=secret
`;

function ok(text: string) {
  const r = parseConfig(text);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('parseConfig: shapes of input', () => {
  it('a whole file: finds route: and the receiver names', () => {
    const r = ok(WHOLE_FILE);
    expect(r.wholeFile).toBe(true);
    expect(r.root.isRoot).toBe(true);
    expect(r.root.routes).toHaveLength(3);
    expect(r.receiverNames).toEqual(['null', 'telegram', 'checkout_oncall_critical']);
  });

  it('ONLY names are taken from receivers — tokens never reach the model', () => {
    const r = ok(WHOLE_FILE);
    const asJson = JSON.stringify({ root: r.root, receiverNames: r.receiverNames });
    expect(asJson).not.toContain('SUPER-SECRET-TOKEN');
    expect(asJson).not.toContain('token=secret');
    expect(asJson).not.toContain('bot_token');
  });

  it('the route: block alone', () => {
    const r = ok(`route:
  receiver: "null"
  routes:
    - receiver: x
      matchers:
        - a="1"
`);
    expect(r.wholeFile).toBe(true);
    expect(r.root.routes).toHaveLength(1);
  });

  it('the innards of a route block without the key itself', () => {
    const r = ok(`receiver: "null"
routes:
  - receiver: x
    matchers:
      - a="1"
`);
    expect(r.wholeFile).toBe(false);
    expect(r.root.receiver).toBe('null');
    expect(r.root.routes).toHaveLength(1);
  });

  it('a route-list fragment ("- matchers:") is attached under the root', () => {
    const r = ok(`- matchers:
    - product=~".+"
  routes:
    - receiver: x
      matchers:
        - severity="critical"
- receiver: y
  matchers:
    - a="1"
`);
    expect(r.root.routes).toHaveLength(2);
    expect(r.root.routes[0].routes[0].receiver).toBe('x');
  });

  it('an indented paste (copied from mid-file) has its indent stripped', () => {
    const r = ok(`      - matchers:
          - product=~".+"
        routes:
          - receiver: checkout_oncall_critical
            matchers:
              - severity="critical"
`);
    expect(r.root.routes).toHaveLength(1);
    expect(r.root.routes[0].routes[0].receiver).toBe('checkout_oncall_critical');
  });

  it('garbage is rejected with a clear error', () => {
    expect(parseConfig('').ok).toBe(false);
    expect(parseConfig('global:\n  smtp_from: a@b.c\n').ok).toBe(false);
    expect(parseConfig('route:\n  receiver: [broken\n').ok).toBe(false);
  });
});

describe('parseConfig: a config nested inside a wrapper', () => {
  // This is how an Alertmanager config commonly lives in a GitOps repo: a Flux
  // HelmRelease, values encrypted with sops, route: indented by 16 spaces.
  const HELM_RELEASE = `apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
    name: kube-prometheus-stack
spec:
    values:
        alertmanager:
            config:
                global:
                    telegram_api_url: https://api.telegram.org
                route:
                    receiver: "null"
                    group_by:
                        - alertname
                    routes:
                        - receiver: telegram
                          matchers:
                              - product!~".+"
                          continue: true
                        - matchers:
                              - product=~"(?i)^checkout$"
                          routes:
                              - receiver: checkout_oncall_critical
                                matchers:
                                    - severity="critical"
                receivers:
                    - name: "null"
                    - name: telegram
                      telegram_configs:
                          - bot_token: ENC[AES256_GCM,data:SECRET,iv:XX,tag:YY,type:str]
                    - name: checkout_oncall_critical
sops:
    age: []
`;

  it('finds route: inside a HelmRelease and picks up the neighbouring receivers', () => {
    const r = ok(HELM_RELEASE);
    expect(r.wholeFile).toBe(true);
    expect(r.root.receiver).toBe('null');
    expect(r.root.routes).toHaveLength(2);
    expect(r.root.routes[0].continue).toBe(true);
    expect(r.receiverNames).toEqual(['null', 'telegram', 'checkout_oncall_critical']);
    expect(r.warnings.join(' ')).toContain('spec.values.alertmanager.config.route');
  });

  it('sops ciphertexts never reach the model', () => {
    const r = ok(HELM_RELEASE);
    const json = JSON.stringify({ root: r.root, names: r.receiverNames });
    expect(json).not.toContain('ENC[');
    expect(json).not.toContain('bot_token');
  });

  it('splicing the block preserves the wrapper and the ciphertexts', () => {
    const r = ok(HELM_RELEASE);
    const merged = spliceRouteBlock(HELM_RELEASE, r.routeBlock!, serializeRoute(r.root));
    expect(merged).toContain('kind: HelmRelease');
    expect(merged).toContain('ENC[AES256_GCM');
    expect(merged).toContain('sops:');
    // The block landed back in place — and the result parses again.
    const again = ok(merged);
    expect(again.root.routes).toHaveLength(2);
    expect(again.receiverNames).toEqual(r.receiverNames);
  });

  it('a config held as a YAML string inside a ConfigMap', () => {
    const r = ok(`apiVersion: v1
kind: ConfigMap
metadata:
    name: alertmanager
data:
    alertmanager.yml: |
        route:
          receiver: "null"
          routes:
            - receiver: team
              matchers:
                - team="sre"
        receivers:
          - name: "null"
          - name: team
`);
    expect(r.root.routes).toHaveLength(1);
    expect(r.root.routes[0].receiver).toBe('team');
    expect(r.receiverNames).toEqual(['null', 'team']);
  });
});

describe('parseConfig: dialect specifics', () => {
  it('a "- key:" list item opens a nested block; sibling keys sit at dash_indent+2', () => {
    const r = ok(`      - matchers:
          - product=~".+"
        routes:
          - matchers:
              - product=~"(?i)^checkout$"
            routes:
              - receiver: checkout_oncall_critical
                matchers:
                  - severity="critical"
`);
    const productNode = r.root.routes[0];
    expect(productNode.matchers.map((m) => m.raw)).toEqual(['product=~".+"']);
    expect(productNode.routes).toHaveLength(1);
    expect(productNode.routes[0].matchers[0].raw).toBe('product=~"(?i)^checkout$"');
  });

  it('matcher strings are taken whole, inner quotes included', () => {
    const r = ok(WHOLE_FILE);
    expect(r.root.routes[0].matchers.map((m) => m.raw)).toEqual([
      'cluster=~"staging|dev|pci-test"',
      'product!~".+"',
    ]);
  });

  it('receiver: "null" is a name, not a YAML null; a missing key is null', () => {
    const r = ok(WHOLE_FILE);
    expect(r.root.receiver).toBe('null');
    expect(r.root.routes[1].receiver).toBeNull();
  });

  it('an unquoted receiver: null reads as "not set", with a warning', () => {
    const r = ok(`route:
  receiver: null
`);
    expect(r.root.receiver).toBeNull();
    expect(r.warnings.join(' ')).toContain(dict().parse.receiverYamlNull('route'));
  });

  it('legacy match/match_re turn into matchers', () => {
    const r = ok(`route:
  routes:
    - receiver: legacy
      match:
        severity: critical
      match_re:
        cluster: prod-.+
`);
    expect(r.root.routes[0].matchers.map((m) => [m.origin, m.raw])).toEqual([
      ['match', 'severity="critical"'],
      ['match_re', 'cluster=~"prod-.+"'],
    ]);
  });

  it('unknown route keys are preserved in extra', () => {
    const r = ok(`route:
  routes:
    - receiver: x
      matchers:
        - a="1"
      some_future_key:
        nested: 42
`);
    expect(r.root.routes[0].extra).toEqual({ some_future_key: { nested: 42 } });
  });
});

describe('findRouteBlock / spliceRouteBlock', () => {
  it('finds the bounds of the route: block in the source text', () => {
    const block = findRouteBlock(WHOLE_FILE)!;
    const lines = WHOLE_FILE.split('\n');
    expect(lines[block.start]).toBe('route:');
    expect(lines[block.end]).toBe('inhibit_rules:');
  });

  it('splicing the block leaves the rest of the file untouched, secrets included', () => {
    const r = ok(WHOLE_FILE);
    const yaml = serializeRoute(r.root);
    const merged = spliceRouteBlock(WHOLE_FILE, r.routeBlock!, yaml);
    expect(merged).toContain('SUPER-SECRET-TOKEN');
    expect(merged).toContain('inhibit_rules:');
    expect(merged.startsWith('---\nroute:')).toBe(true);
    // The resulting file parses again and the tree matches structurally.
    const again = ok(merged);
    expect(again.root.routes).toHaveLength(3);
    expect(again.receiverNames).toEqual(r.receiverNames);
  });
});
