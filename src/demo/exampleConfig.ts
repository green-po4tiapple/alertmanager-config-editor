/**
 * A synthetic Alertmanager config used by the "Load example" button and by
 * `?demo=1`.
 *
 * It is not a toy: every route here exists to show one thing the editor is for.
 * Two of them are deliberately *wrong* in ways that are common in real configs and
 * nearly invisible when reading YAML —
 *
 *   - the `team="payments"` route has children for critical and warning but none
 *     for info, and no receiver of its own, so info alerts for that team vanish
 *     silently (the batch check reports these as "lost");
 *   - the chatops route matches on `product!~".*"`, which is false for every value
 *     including the empty string, so the route can never fire. `!~".+"` was meant.
 *
 * Keep both defects. They are what makes the demo worth looking at, and the test
 * in `exampleConfig.test.ts` pins them so nobody "fixes" them by accident.
 */

export const EXAMPLE_CONFIG = `# Example Alertmanager configuration — synthetic, safe to share.
global:
  resolve_timeout: 5m
  smtp_smarthost: smtp.example.com:587
  smtp_from: alertmanager@example.com

route:
  receiver: fallback_email
  group_by:
    - alertname
    - cluster
    - service
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    # Heartbeat alerts must never reach a human.
    - receiver: "null"
      matchers:
        - alertname=~"Watchdog|InfoInhibitor"

    # Non-production clusters are muted on purpose.
    - receiver: "null"
      matchers:
        - cluster=~"staging|dev"

    # Mirror every critical into the incident room, then keep matching:
    # this is what continue: true is for.
    - receiver: incident_room
      continue: true
      matchers:
        - severity="critical"

    # Payments. Note there is no branch for severity="info" and no receiver
    # on this route itself, so info alerts for this team are lost silently.
    - matchers:
        - team="payments"
      routes:
        - receiver: payments_pager
          matchers:
            - severity="critical"
        - receiver: payments_chat
          matchers:
            - severity="warning"

    # Checkout, matched case-insensitively; legacy match/match_re on purpose.
    - matchers:
        - product=~"(?i)^checkout$"
      routes:
        - receiver: checkout_oncall
          match:
            severity: critical
        - receiver: checkout_chat
          match_re:
            severity: warning|info

    # Dead route: !~".*" is false for every value, the empty string included,
    # so nothing can ever match it. The intended matcher was product!~".+".
    - receiver: chatops
      continue: true
      matchers:
        - product!~".*"

    # Catch-all by team, deliberately last: order decides who wins.
    - receiver: platform_chat
      matchers:
        - team=~".+"

receivers:
  - name: fallback_email
    email_configs:
      - to: alerts@example.com
  - name: "null"
  - name: incident_room
  - name: payments_pager
  - name: payments_chat
  - name: checkout_oncall
  - name: checkout_chat
  - name: chatops
  - name: platform_chat

inhibit_rules:
  - source_matchers:
      - severity="critical"
    target_matchers:
      - severity="warning"
    equal:
      - alertname
      - cluster
      - service
`;

/**
 * True when the page was opened with `?demo=1`. Used to hand someone a single link
 * that lands on a populated tree instead of an empty paste box.
 */
export function demoRequested(search: string): boolean {
  return new URLSearchParams(search).get('demo') === '1';
}
