# Parsing and serialising the `route:` block

## Where the config comes from

Besides pasting and opening a file, the config can be fetched straight from a
running Alertmanager: `GET /api/v2/status` → `config.original`. That is both easier
and safer — Alertmanager masks the secrets itself (`bot_token: <secret>`,
`url: <secret>`), so tokens never reach the application at all.

The price of that masking: **such text must never be written back to a cluster
whole**. So the source is tagged (`LoadedSource.origin === 'api'`), the whole-file
export tab is disabled for it, and the "Original" dialog says where the config came
from. The `route:` block itself holds no secrets and exports normally.

## What the parser accepts

`parseConfig` (`src/core/parse.ts`) understands six shapes of input:

1. **A whole `alertmanager_config.yaml`** — the top-level `route:` key is located.
   Additionally, **only** the names are taken from `receivers:`, and the bounds of
   the `route:` block in the source text are remembered for the whole-file export.
2. **Just the `route:` block.**
3. **The innards of the block** — `receiver:` / `matchers:` / `routes:` /
   `group_by:` … without the `route:` key itself.
4. **A fragment of a route list** — text starting with `- `. It is wrapped in
   `routes:` and attached under an empty root.
5. **A Flux HelmRelease, or any other wrapper** — `route:` is searched for at any
   depth (BFS, up to 14 levels). This is how the config commonly lives in a GitOps
   repository: `spec.values.alertmanager.config.route`, with `receivers:` nearby
   holding sops ciphertexts `ENC[AES256_GCM,...]`. Receiver names are taken from
   the mapping next to the `route:` that was found; ciphertexts are never read.
6. **A ConfigMap holding YAML as a string** — if a field's value looks like YAML
   containing `route:` (`alertmanager.yml: |`), it is parsed separately.

In every wrapper case the whole-file export still works: the block is spliced back
into its own place with the original indentation, and the wrapper and its secrets
are untouched (covered by a HelmRelease test and by the real-config smoke test).

Before parsing, the input is normalised:

- `\r\n` → `\n`, tabs → 4 spaces;
- a common leading indent is stripped — the frequent case of copying a chunk out of
  the middle of a file together with its indentation, which no YAML parser accepts;
- either normalisation raises a note in "Parse notes".

## Dialect specifics that are easy to miss

| Case | How it is handled |
|---|---|
| `- matchers:` (a list item with no value on the line) opens a nested block, while sibling keys of the same item (`routes:`) sit at `dash_indent + 2` | this is ordinary YAML and `js-yaml` reads it correctly — which is exactly why a real parser is used instead of a line-by-line one |
| Matcher strings contain quotes: `product=~"(?i)^checkout$"` | that is a plain scalar (the quotes are not leading), and `js-yaml` returns it verbatim without unquoting |
| `receiver: "null"` | the string `null` is a receiver **name**. On export the quotes are restored unconditionally |
| `receiver: null` (unquoted) | a YAML null → treated as "no receiver set", plus a warning |
| `match:` / `match_re:` (legacy) | turned into `label="value"` / `label=~"value"` matchers tagged with their `origin`, and written back into the original keys on export. If the user rewrites such a matcher into `!=`/`!~`, it moves to the modern `matchers:` list |
| Unknown route keys | collected into `RouteNode.extra` and emitted on export through `js-yaml.dump` |
| `routes:` is not a list, or an item is not a mapping | the route is skipped and a line appears in "Parse notes" |

## Serialisation

`serializeRoute` (`src/core/serialize.ts`) assembles YAML by hand rather than via
`yaml.dump`, to keep control of three things: key order, quoting, and the verbatim
text of matcher strings.

Key order inside a route:

```
receiver → group_by → matchers → match / match_re → continue →
group_wait → group_interval → repeat_interval →
mute_time_intervals → active_time_intervals → (unknown keys) → routes
```

`routes:` always comes last, so nesting reads top to bottom.

### Quoting rules

- **A matcher string** is written as a plain scalar, unchanged, so that
  `product=~"(?i)^checkout$"` reaches the file character for character. The whole
  string is quoted (JSON-escaped) only when a plain scalar is impossible: it does
  not start with a letter or underscore, contains `: ` or ` #`, ends with `:`, or
  contains a newline.
- **Other scalars** (`receiver`, `repeat_interval`, `group_by` items, legacy mapping
  values) are quoted when the value is empty, numeric, contains anything outside
  `[A-Za-z0-9_.\-/@]`, or equals a reserved word: `null`, `true`, `false`, `yes`,
  `no`, `on`, `off`, `y`, `n`, `~` (in any case). That list is deliberately wider
  than YAML 1.2 requires: Alertmanager reads its config through `gopkg.in/yaml.v2`,
  which follows YAML 1.1, where `yes`/`no` are booleans.

### The whole-file export

`spliceRouteBlock` takes the **original text** and replaces lines
`[routeBlock.start, routeBlock.end)` with the new block, aligned to the indentation
of the original `route:` key. Everything else — `receivers:` with its tokens,
`inhibit_rules:`, comments, the tail of the file — is carried over verbatim. The
file is deliberately **not** rebuilt through a YAML dumper: that is what rules out
rewriting a secret or losing a comment.

## How this is verified

- `src/core/parse.test.ts` — every input shape, indentation, legacy keys, `extra`,
  the absence of secrets in the model, block bounds.
- `src/core/serialize.test.ts` — the `parse → serialize → parse` round trip by
  structure, quoting, and routing equivalence before and after export.
- `src/core/real-config.smoke.test.ts` — the same against a real config of your
  own (`AM_CONFIG=/path/to/alertmanager_config.yaml npm test`): it compares routing
  for a large cartesian product of label sets before and after the round trip, and
  checks that everything after the `route:` block is preserved byte for byte.
- `src/core/amtool-fixtures.test.ts` plus a CI step: the exported configs are
  validated by the real `amtool check-config` binary, not only by our own tests.
