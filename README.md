# Alertmanager Routing Tree Editor

**Some of your alerts never reach anybody, and nothing tells you.**

A route matches, none of its children match, and the route has no `receiver` of its
own — because in Alertmanager a receiver is never inherited from the parent. The
alert is dropped. No error, no log line, nothing on a dashboard. The config looks
perfectly reasonable while it happens:

```yaml
- matchers:
    - team="payments"
  routes:
    - receiver: payments_pager
      matchers: [severity="critical"]
    - receiver: payments_warn
      matchers: [severity="warning"]
    # severity="info" for this team goes nowhere at all
```

This tool takes your routing tree and your alerts, runs **all of them through it at
once**, and lists the ones that arrive nowhere. Then it lets you fix the tree and
export the YAML back.

**[Open the live demo →](https://green-po4tiapple.github.io/alertmanager-config-editor/?demo=1)**
· [Русская версия README](README.ru.md)

Runs entirely in your browser. No backend, no install, and the config never leaves
the page.

![Batch check: one alert per row, with the lost ones counted](docs/img/batch-check.png)

The `SlowQuery` row is the defect above, found automatically.

## Why not `amtool`?

`amtool config routes test` is the right tool for one question about one alert. It
answers from the command line, one label set per invocation.

This answers a different question: **which of my alerts, out of all of them, go
nowhere** — and it needs the whole set to answer it. Feed it
`/api/v2/alerts`, a `PrometheusRule` dump or a CSV, and every alert gets a row. On
one real production dump of 322 firing alerts it found 66 that were being dropped
silently.

Two other things `amtool` does not do: it will not show you the tree, and it will
not tell you what an edit changed. Here, after you move a route, every row is also
routed through the tree **as it was before** — so you see "65 of 332 alerts
re-routed", not "4 lines of YAML changed".

## What it does

| | |
|---|---|
| **Batch check** | An alert dump → "alert → receiver → why", with a **lost** counter. Sources: Alertmanager `/api/v2/alerts`, Prometheus `/api/v1/rules`, a `PrometheusRule` dump, a rule file, or CSV. See [`docs/BATCH-CHECK.md`](docs/BATCH-CHECK.md). |
| **Routing regression** | Every resolved row is routed through the tree as loaded too, so an edit's blast radius is a number, not a guess. |
| **Two views over one tree** | A nested list of cards with inline editing, and a diagram. Same model, switch freely. |
| **Two graph layouts** | **Radial** — the shape of the official routing-tree-editor. **Blocks** — a top-down org chart with matchers inside the nodes and drag&drop re-parenting. |
| **Alert testing** | Arbitrary `label=value` pairs → every receiver the alert reaches, with the outcome of each: delivered / dropped (explicit null) / dropped (no receiver). The path is highlighted in both views. |
| **Structural editing** | Move among siblings, indent/outdent, add, delete, drag a route onto a new parent. `⌘/Ctrl+Z` undoes a whole field edit, not one character. |
| **Export** | The ready `route:` block, or your original file with only that block replaced — comments and secrets carried through byte for byte. |
| **Fetch from a live Alertmanager** | `GET /api/v2/status` → `config.original`, so nothing has to be pasted by hand. |
| **Themes and languages** | Light/dark following the system. English and Russian interface. |

### Editing, with the alert test open

![Block view with an alert test](docs/img/block-view.png)

### Radial layout, as in the official tool

![Radial graph](docs/img/graph-radial.png)

## Quick start

Nothing to install to try it — [open the demo](https://green-po4tiapple.github.io/alertmanager-config-editor/?demo=1)
and press **See it on an example**. To run it locally:

```bash
npm ci
npm run dev        # http://127.0.0.1:5180
```

```bash
npm test           # unit tests for the core (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # production build into dist/
```

## Security model

Worth reading before you paste a production config into a page you just found.

- **The config never leaves the page.** Parsing, editing and export all happen in
  the browser. The app makes no requests on its own.
- **The only outbound requests are ones you trigger**, and only to addresses you
  typed in yourself: fetching the config from Alertmanager, pulling rules and firing
  alerts, and — if you enable it — label enrichment from Prometheus/VictoriaMetrics.
  Those carry API paths and rule expressions. **The routing tree and the pasted
  config are never sent anywhere.** Cookies are not sent (`credentials: 'omit'`).
- **Nothing is persisted.** The config lives only in the tab's memory — no
  `localStorage`, no `sessionStorage`. Reloading gives you a blank paste screen. The
  single exception is your language choice.
- **Only names are read from `receivers:`.** Tokens, URLs and `*_configs` never
  enter application state at all, sops ciphertexts in a HelmRelease included. There
  is a test asserting this.
- **The whole-file export is a text splice**, not a YAML re-dump, so secrets and
  comments in your original file are carried through character for character.

If that is still not enough — and for an air-gapped network it should not be — run
it yourself:

```bash
docker build -t alertmanager-config-editor .
docker run --rm -p 8080:8080 alertmanager-config-editor   # http://localhost:8080
```

The image is `nginx-unprivileged` (~76 MB, listens on 8080, needs no root, has
`/healthz`) and runs under a read-only root filesystem:

```bash
docker run --rm --read-only --user 101:101 --cap-drop ALL \
  --tmpfs /tmp --tmpfs /var/cache/nginx -p 8080:8080 alertmanager-config-editor
```

Self-hosting has one practical advantage: a page served over plain HTTP may query
`http://` endpoints, which a browser blocks from an HTTPS page as mixed content.

## Is the export trustworthy?

`npm test` writes finished Alertmanager configs, produced by this project's own
serializer, into `amtool-out/`. CI then validates them with the **real** Alertmanager
binary — that check has already rejected a config the unit tests were happy with.
The same locally:

```bash
npm test
docker run --rm -v "$PWD/amtool-out:/cfg" --entrypoint sh \
  prom/alertmanager:v0.28.1 -c 'amtool check-config /cfg/*.yaml'
```

You can also run the whole core against your own config; the test skips itself when
the variable is unset:

```bash
AM_CONFIG=/path/to/alertmanager.yml npm test
```

Routing semantics are translated line by line from Alertmanager's
`dispatch/route.go` — including the parts that are easy to get wrong, such as
`continue: true` producing several receivers and `label!~".*"` never matching
anything. See [`docs/ROUTING-SEMANTICS.md`](docs/ROUTING-SEMANTICS.md).

## Documentation

- [`AGENTS.md`](AGENTS.md) — start here if you are going to change the code.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, invariants, extension
  points.
- [`docs/ROUTING-SEMANTICS.md`](docs/ROUTING-SEMANTICS.md) — exact semantics and the
  traps real configs hit.
- [`docs/YAML-DIALECT.md`](docs/YAML-DIALECT.md) — what the parser accepts and how
  the serializer quotes things.
- [`docs/BATCH-CHECK.md`](docs/BATCH-CHECK.md) — the batch check in detail.

## License

MIT — see [LICENSE](LICENSE).

<sub>Keywords: visualize alertmanager routing tree · test alertmanager routing ·
which receiver will get my alert · debug alertmanager config · alerts silently
dropped · alertmanager route tester · prometheus alert routing visualization</sub>
