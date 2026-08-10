# Alertmanager Routing Tree Editor

An editor for the Prometheus Alertmanager routing tree that runs entirely in your
browser. Paste your `alertmanager.yml` — or just the `route:` block, or the
HelmRelease it lives inside — then read the tree, edit it, test which receivers an
alert actually reaches, and export the YAML back.

**[Open the live demo →](https://green-po4tiapple.github.io/alertmanager-config-editor/?demo=1)**
· [Русская версия README](README.ru.md)

No backend, no build step for the user, no config leaving the page.

> Think of it as the official
> [routing-tree-editor](https://prometheus.io/webtools/alerting/routing-tree-editor/)
> plus editing, exact `continue` semantics, a YAML export, and a batch check that
> tells you which of your alerts are being lost silently.

![Block view with an alert test](docs/img/block-view.png)

## Why

Alertmanager routing is deterministic but easy to misread, and the failure mode is
silent. The one that costs the most:

```yaml
- matchers:
    - team="payments"
  routes:
    - receiver: payments_pager
      matchers: [severity="critical"]
    - receiver: payments_chat
      matchers: [severity="warning"]
```

An alert with `team=payments, severity=info` matches the parent, matches no child,
and the parent has no `receiver` of its own — because **a receiver is never
inherited from the parent**. The alert disappears. No error, no log line, nothing in
any dashboard.

This editor badges those routes, and its batch mode counts exactly how many of your
real alerts fall into them.

## What it does

| | |
|---|---|
| **Two views over one tree** | A nested list of cards with inline editing, and a diagram. Same model, switch freely. |
| **Two graph layouts** | **Radial** — the shape of the official routing-tree-editor. **Blocks** — a top-down org chart with matchers inside the nodes and drag&drop re-parenting. |
| **Structural editing** | Move among siblings, indent/outdent, add child or sibling, delete, drag a route onto a new parent. |
| **Alert testing** | Enter arbitrary `label=value` pairs and get every receiver the alert reaches, with the outcome of each: delivered / dropped (explicit null) / dropped (no receiver). The path is highlighted in both views. |
| **Batch check** | Run a whole dump of alerts through the tree: "alert → receiver → why", with a **lost** counter. See [`docs/BATCH-CHECK.md`](docs/BATCH-CHECK.md). |
| **Routing regression** | After an edit, every row is also routed through the tree as it was loaded, so you see "65 of 332 alerts re-routed" instead of "4 lines of YAML changed". |
| **Search** | By receiver name or matcher text, with a jump to the route in either view. |
| **Diff before export** | A line diff against the tree as loaded, free of YAML-normalisation noise. |
| **Undo/redo** | `⌘/Ctrl+Z` and `⌘/Ctrl+Shift+Z`. One snapshot per text-editing session, not per keystroke. |
| **Export** | `⌘/Ctrl+E`: the ready `route:` block, or the original file with only that block replaced. |
| **Fetch from a live Alertmanager** | `GET /api/v2/status` → `config.original`, so nothing has to be pasted by hand. |
| **Themes and languages** | Light/dark following the system, plus a manual switch. English and Russian interface. |

### Radial layout, as in the original tool

![Radial graph](docs/img/graph-radial.png)

### Batch check: which alerts are lost

![Batch check](docs/img/batch-check.png)

The `SlowQuery` row above is the defect from the first section, found automatically.

## Quick start

```bash
npm ci
npm run dev        # http://127.0.0.1:5180
```

Other commands:

```bash
npm test           # unit tests for the core (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

Nothing else is needed: open the page, click **Example** to load a demo config, or
paste your own.

## Security model

This is the part worth reading before you paste a production config.

- **The config never leaves the page.** Parsing, editing and export all happen in
  the browser. The app makes no requests on its own.
- **The only outbound requests are ones you trigger**, and only to addresses you
  typed in yourself: fetching the config from Alertmanager, pulling rules and firing
  alerts, and — if you enable it — label enrichment from Prometheus/VictoriaMetrics.
  Those requests carry API paths and rule expressions. **The routing tree and the
  pasted config are never sent anywhere.** Cookies are not sent
  (`credentials: 'omit'`).
- **Nothing is persisted.** The config lives only in the tab's memory — no
  `localStorage`, no `sessionStorage`. Reloading the page gives you a blank paste
  screen. The single exception is your language choice.
- **Only names are read from `receivers:`.** Tokens, URLs and `*_configs` never
  enter application state at all, sops ciphertexts in a HelmRelease included. There
  is a test asserting this.
- **The whole-file export is a text splice**, not a YAML re-dump, so secrets and
  comments in your original file are carried through character for character.

## Self-hosting with Docker

Useful when you want it next to your own Alertmanager — a page served over plain
HTTP may talk to `http://` endpoints, which a browser blocks from an HTTPS page as
mixed content.

```bash
docker build -t alertmanager-config-editor .
docker run --rm -p 8080:8080 alertmanager-config-editor   # http://localhost:8080
```

The image is `nginx-unprivileged` (~76 MB, listens on 8080, needs no root) with a
`/healthz` endpoint. It runs under a read-only root filesystem given two tmpfs
mounts:

```bash
docker run --rm --read-only --user 101:101 --cap-drop ALL \
  --tmpfs /tmp --tmpfs /var/cache/nginx -p 8080:8080 alertmanager-config-editor
```

## Verifying the export

`npm test` writes finished Alertmanager configs, produced by this project's own
serializer, into `amtool-out/`. CI then validates them with the **real** Alertmanager
binary. The same locally:

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

## Documentation

- [`AGENTS.md`](AGENTS.md) — start here if you are going to change the code.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, invariants, extension
  points.
- [`docs/ROUTING-SEMANTICS.md`](docs/ROUTING-SEMANTICS.md) — exact Alertmanager
  semantics, checked against `dispatch/route.go`, and the traps real configs hit.
- [`docs/YAML-DIALECT.md`](docs/YAML-DIALECT.md) — what the parser accepts and how
  the serializer quotes things.
- [`docs/BATCH-CHECK.md`](docs/BATCH-CHECK.md) — the batch check in detail.

## License

MIT — see [LICENSE](LICENSE).
