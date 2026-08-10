# Alertmanager routing semantics

Everything this editor claims about routing is checked against Alertmanager's own
source, not against intuition. This document records what was checked and the traps
that show up in real configs.

## The reference: `dispatch/route.go`

```go
func (r *Route) Match(lset model.LabelSet) []*Route {
    if !r.Matchers.Matches(lset) {
        return nil
    }

    var all []*Route
    for _, cr := range r.Routes {
        matches := cr.Match(lset)
        all = append(all, matches...)
        if matches != nil && !cr.Continue {
            break
        }
    }

    // If no child nodes were matches, the current node itself is a match.
    if len(all) == 0 {
        all = append(all, r)
    }

    return all
}
```

`src/core/routing.ts` is a line-by-line translation of this. If you change it,
change it against the Go source — not against what the previous version did.

## Rules that must not be simplified

### 1. `receiver` is NOT inherited from the parent

The single most common misreading. In Alertmanager the effective receiver is the
one on the route that ended up being the match — a parent's receiver is not
inherited by a child, and a child that matched does not fall back to its parent.

Where it bites: a parent route matches, none of its children match, and the parent
has no `receiver` of its own. The parent becomes the match, its receiver is empty,
and **the alert is dropped silently**. No error, no log line, nothing.

```yaml
- matchers:
    - team="payments"
  routes:
    - receiver: payments_pager
      matchers: [severity="critical"]
    - receiver: payments_chat
      matchers: [severity="warning"]
```

An alert with `team=payments, severity=info` reaches the `team="payments"` route,
matches no child, and vanishes. The editor marks such routes with a **no receiver**
badge, and the batch check counts these alerts as **lost**. This is the single most
valuable thing the tool finds.

### 2. Matchers inside one route are AND-ed

Every matcher of a route must pass. There is no way to express OR between matchers —
that is what regex alternation or sibling routes are for.

### 3. A missing label equals the empty string

Alertmanager does not distinguish "the label is absent" from "the label is empty".
Both compare as `""`. So `label!="x"` is **true** for an alert that has no `label`
at all, which is rarely what people expect when they write it.

### 4. Sibling order matters, and `continue` changes the walk

Siblings are evaluated top to bottom. The first one that matches ends the scan —
unless it carries `continue: true`, in which case the scan carries on and the alert
can end up in several receivers at once.

Consequence: moving a route up or down with the ↑/↓ buttons **changes real
behaviour**. Re-run the alert test after every move.

### 5. Regexes match in full

Alertmanager wraps every pattern in `^(?:…)$`, so `product=~"checkout"` does not
match `xcheckoutx`. The editor compiles matcher regexes the same way.

## RE2 (Go) versus RegExp (JS)

Alertmanager uses Go's RE2. The browser has JavaScript RegExp. They are close but
not identical, and the differences are handled explicitly:

| Construct | What the editor does |
|---|---|
| Leading `(?i)` | Stripped from the pattern and moved into the RegExp `i` flag. This is how `product=~"(?i)^checkout$"` works. |
| `(?i)`, `(?s)`, `(?m)` mid-pattern | JS cannot do this. The flag is stripped and applied to the **whole** expression, and the field gets a warning. In Go it would only last until the end of its group. |
| `(?U)` (RE2 greedy swap) | Not supported; the matcher is flagged as an error. |
| Backreferences, lookahead/lookbehind | JS supports them, RE2 does **not**. The editor may therefore report a match where the real Alertmanager would refuse to load the config. Do not use these in matchers. |

## Traps in real configs that the editor makes visible

1. **`label!~".*"` never matches.** `.*` matches any value including the empty
   string, so its negation is false for everything. The route is dead code. What
   was almost certainly meant is `label!~".+"` — "the label is empty or absent".
   The bundled example config contains exactly this mistake on purpose, and there
   is a test pinning the behaviour.

2. **A parent route without `receiver` is a coverage hole.** See rule 1. Both views
   badge these routes.

3. **`receiver: null` without quotes is a YAML null**, not a receiver named
   `"null"`. The editor treats it as "no receiver set" and raises a parse warning —
   the difference matters, because one is a silent loss and the other is a
   deliberate drop.

4. **Order is load-bearing.** A catch-all route such as `alertname=~"Watchdog|…"`
   sits first precisely so it intercepts before the product routes. Verify with the
   alert-test panel after any reordering.
