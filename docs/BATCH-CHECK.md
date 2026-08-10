# Batch check: where every alert goes, and why

Batch mode runs a dump of alerts through the current (already edited) tree and shows
an "alert → receiver → why" table. This document covers where the data comes from,
why some answers are deliberately withheld, and how to fix that.

## Sources

The easiest route is **pulling over the API from inside the interface**: enter the
Prometheus and Alertmanager addresses in the "Connections" block, then use the two
buttons:

- **↓ Rules from Prometheus** — `GET /api/v1/rules?type=alert`, every alerting rule;
- **↓ Firing alerts from Alertmanager** — `GET /api/v2/alerts`, what is burning now.

No `kubectl`, no intermediate files. An API dump is not put into the textarea (it
runs to hundreds of kilobytes) — the buttons report where it came from instead.

A pasted file or drag-and-drop works the same way; the format is detected
automatically:

| What | How to get it | Label completeness |
|---|---|---|
| `PrometheusRule` dump | `kubectl get prometheusrule -A -o yaml > rules.yaml` | static `labels:` only |
| Prometheus rule file | from your repository (`groups:` at the top level) | static only |
| `/api/v1/rules` | the button, or `curl -s prom/api/v1/rules?type=alert` | static only |
| `/api/v2/alerts` (Alertmanager) | the button, or `curl -s alertmanager/api/v2/alerts` | **complete and real** |
| `/api/v1/alerts` (Prometheus) | `curl -s prom/api/v1/alerts > alerts.json` | **complete and real** |
| CSV | by hand: the header row holds label names | exactly what you typed |

Basic authentication is configured in the same place and applies to every request —
both to the dumps and to enrichment.

A dump of **firing** alerts gives exact answers with no caveats, but only covers
what is firing right now. A rule dump covers everything, but a rule only knows its
static labels — see the next section.

## A rule is not an alert

Alertmanager routing is deterministic: for a given label set there is exactly one
route. There is no "maybe" in it, and a tool has no business inventing one.

But **a Prometheus rule is a template, not an alert**. It has only static `labels:`;
`namespace`, `job`, `pod`, `job_name` appear the moment it fires, from the series
behind its expression. Asking "where does this rule go" is like asking what a
function returns without calling it.

So a route is shown **only when the label set is fully known**, and every row is in
one of three states:

| State | When | What the receiver column shows |
|---|---|---|
| `resolved` | labels are complete: a firing alert, CSV, or an expanded rule | the route and the path through the tree |
| `no series` | the rule was expanded but has no series: no alerts exist from it right now | `—`, there is nothing to route |
| `series labels needed` | the rule was never expanded (no TSDB configured) | `—` plus the **exact list of labels** the tree asks this alert about |

The third state is not "I don't know" — it is a checkable statement: "the tree
decides on `product`, `team`, `namespace`, `job_name`; the template has none of
them, they appear only at fire time." No receiver is shown alongside it. The tool
does not guess.

A rule is expanded with the "expand them all via Prometheus" button, or one row at
a time from an expanded row.

## Diagnostics for unresolved rules

At routing time an alert's labels come from three places:

1. the rule's `labels:` — `severity`, sometimes `team`/`product`;
2. **series labels from `expr`** — `namespace`, `job`, `pod`, `job_name`. These do
   not exist statically;
3. Prometheus `externalLabels` — `cluster`, `location`.

How much that matters is measurable. On one real production Prometheus with **348**
rules, `product` was present on **2** of them, `team` on 151, and **195 had
neither** — while the routing tree branched on `namespace`, `cluster` and
`job_name`. Without expansion, most of that tree simply cannot be evaluated.

So that the "labels needed" list is a concrete statement rather than a general
observation, `explainRoute` walks the tree exactly as Alertmanager would and marks
the routes whose verdict hinges on unknown labels:

| Mark | Meaning |
|---|---|
| `could-match` | the route failed *only* because of unknown labels: with real values it would have intercepted the alert |
| `could-unmatch` | the route passed *because* a label was absent (`product!~".+"` and similar); a real value would have cancelled it |

This is **diagnostics, not an answer**: it explains why the route is undefined and
points at the specific routes (click to jump to one in the tree). No route is
published meanwhile. Matchers that are true for any value (`label=~".*"`) never
enter the diagnostics — there is a test for that.

An unresolved row looks like this:

```
DeploymentImageUnavailable        receiver: —      series labels needed
  the tree asks about: cluster, job, job_name, namespace, product, team
  blocked on routes:  job_name=~"import-.*" & namespace="shop-prod"
                      namespace=~"shop-.*"
```

After expanding through Prometheus, that single row turns into several rows with
real series labels and exact routes.

### Why labels cannot be inferred from `by (...)`

The idea looks sound: `sum by (namespace, pod)(...)` seems to declare the resulting
label set. It was measured against real data and it **does not work**: of 348 rules
only 33 were predictable this way, and when cross-checked against a live Prometheus
2 of 16 disagreed:

```
AlertmanagerConfigInconsistent   by() promised: cluster, namespace, service
                                 actually:      namespace, service
KubePodNotReady                  by() promised: cluster, job, namespace, pod
                                 actually:      job, namespace, pod
```

`by (cluster, ...)` does not create a label, it only preserves an existing one: if
the series has no `cluster`, the result will not have one either. Inferring from
syntax is a guess, so the tool does not do it. **Do not add it back.**

## Regression: what your edit changed

If the tree has been edited, every resolved row is also routed through **the tree as
it was at load time** (`baselineRoot`). Rows whose receiver or outcome changed are
marked "route changed", and a filter keeps only those. In the receiver column the
old value is struck through above the new one; an expanded row shows both paths,
before and after.

This is a **behaviour** diff, not a YAML diff: before a merge you see not "4 lines
of config changed" but "65 of 332 alerts were re-routed".

Unresolved rows never enter the regression: there is nothing to compare, since no
route exists either before or after.

## Diagnostics: which queries were made

Every expanded row shows exactly what was asked of the TSDB and what came back:

```
EXPRESSION AS-IS           series: 0     sum by (...) (http_requests_total{...}) > 25
WITHOUT FINAL THRESHOLD    series: 0     sum by (...) (http_requests_total{...})
DOES THE METRIC EXIST      series: 0     http_requests_total
→ metric http_requests_total does not exist in this TSDB at all
```

The third attempt (`/api/v1/series` by metric name) separates two completely
different situations that would otherwise both read as "empty":

| Status | Meaning | What to do |
|---|---|---|
| `no-data` | the metric is absent from this TSDB | the exporter is silent, or the data lives in another Prometheus |
| `no-match` | the metric exists, but no series matched the expression filters | check the matchers in `expr` |

Next to them are "↗ Open in Prometheus" and "↗ Without threshold" links: the same
expression opens in the Prometheus graph so it can be re-checked by hand.

## External labels and running across clusters

The "external labels" field supplies what Prometheus adds itself. Several
comma-separated values (`prod, staging`) produce one run each, so a divergence
between clusters is immediately visible. This is not cosmetic: a `severity=warning`
alert with no product can land in an on-call receiver on `prod` and in `"null"` on
`staging`, because of a drop route matching `cluster=~"staging|…"`.

Variants are capped at 8, table rows at 500 (the rest goes to CSV), and total rows
at 20,000.

## Enrichment from Prometheus / VictoriaMetrics

Off by default. Switched on, it closes the gap described above: for each rule the
TSDB is asked which series sit behind it.

Strategy per rule (`src/core/enrich.ts`):

1. `/api/v1/query?query=<expr>` — if the rule is firing, this returns **exactly**
   the label sets the alert will carry; aggregations (`sum by (...)`) are already
   applied. Status `exact`.
2. Otherwise the same query without its final threshold (`... > 5` → `...`, via
   `stripFinalComparison`) — the rule is not firing, but its series carry the same
   labels. Status `approx`.
3. Otherwise only static labels remain and the row is marked accordingly. Statuses
   `no-data` (metric absent) or `no-match` (metric present, filters matched nothing).

Rule labels win over series labels, exactly as Prometheus does when building an
alert.

### What leaves the browser

Requests go only to addresses the user entered, and only the ones they triggered by
pressing a button: `/api/v1/rules`, `/api/v2/alerts`, `/api/v1/status/buildinfo`,
`/api/v2/status`, and — with enrichment on — `/api/v1/query` carrying rule
expressions.

**The routing tree and the pasted config are never sent anywhere.** Cookies are not
sent (`credentials: 'omit'`), and basic auth is available behind the
"authentication required" flag.

For these requests the CSP widens `connect-src 'self'` to
`connect-src 'self' https: http:`, both in `nginx.conf` and in the meta tag injected
into the production build. If you do not need the network features, narrow it back
to `'self'` — everything else (file input, parsing, the table) keeps working.

### What the TSDB has to provide

- **CORS.** The request comes from a browser, so `Access-Control-Allow-Origin` is
  required. Prometheus allows everything by default (`--web.cors.origin`), and
  Alertmanager returns `*`. Verified against live services: the "Check" button
  answers `✅ version 3.11.3`.
- An ingress in front of the TSDB must not strip CORS headers.
- Request concurrency is 6, the timeout is 15 s, and the number of series per rule
  is configurable (20 by default).

## Outcomes, and what to look at first

| Outcome | Meaning |
|---|---|
| `delivered` | there is a real receiver name |
| `dropped (explicit null)` | `receiver: "null"` — silenced on purpose |
| `lost` | **no route on the path had a receiver** — the alert disappears silently |
| `series labels needed` | the answer depends on labels that are not known yet |

The **lost** column is the one that matters. On a real dump of 322 firing alerts it
found **66 lost**: one team's route had children for `severity` critical/warning/
disaster but none for `info`, while neighbouring teams did have one. Info alerts for
that team reached the team route, matched no child, and — since the route had no
receiver of its own — vanished. Nothing in the config looked wrong; nothing was
logged.

The bundled example config reproduces exactly this defect, so the behaviour can be
seen without connecting anything.

## Where this lives in the code

```
src/core/alertSources.ts      parsing every dump format → AlertSpec[]
src/core/promql.ts            selectors from expr, stripping the final threshold
src/core/enrich.ts            Prometheus/VM client, basic auth, concurrency
src/core/batch.ts             explainRoute (ambiguity) + evaluateBatch + summary
src/components/BatchView.tsx  UI: source, external labels, enrichment, table
```

Tests live in `src/core/batch.test.ts`: dump formats, `could-match`/`could-unmatch`,
external-label variants, enriched label sets, row limits. PromQL parsing is tested
against the traps found on a real rule corpus: `offset 1d` (the time unit was read
as a metric) and `by (namespace, pod)` (label names were read as metrics).
