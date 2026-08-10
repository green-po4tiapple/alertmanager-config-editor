# Architecture

A map of the code for whoever — or whatever — works on this editor next: the layers,
the invariants that must not be broken, and the usual places to extend.

## Stack, and why

| Choice | Reason |
|---|---|
| Vite + React + TypeScript | A static build with no server at runtime, and strict typing for the tree model. |
| `js-yaml` | A real YAML parser instead of a hand-rolled line reader: it handles `- key:` list items correctly, distinguishes `"null"` (a string) from `null`, and does not trip over quotes inside plain scalars. |
| Hand-written SVG layouts | react-flow/d3 are not needed: the tree is strict, the layout must be predictable, and a real org chart runs past 17,000 px wide. Zero extra bundle weight. |
| A hand-written serializer, not `yaml.dump` | Precise control is the point: matcher strings must reach the file character for character, `receiver: "null"` must stay quoted, and key order must stay readable to a human reviewing the diff. |

Runtime dependencies: `react`, `react-dom`, `js-yaml`. That is the whole list.

## Layers

```
src/core/       pure logic, no React — fully covered by tests
  types.ts        the RouteNode/Matcher model and the outcome types
  ids.ts          id generator (ids live in memory only, never in YAML)
  matchers.ts     matcher parsing/validation, RE2→JS compilation, evaluation
  routing.ts      Alertmanager semantics (reference: dispatch/route.go)
  parse.ts        YAML → model + receiver NAMES + bounds of the route: block
                  (including a nested route: inside a HelmRelease/ConfigMap)
  serialize.ts    model → YAML + splicing the block back into the source file
  tree.ts         tree operations (clone → mutate → new root)
  layout.ts       org-chart layout (vertical view)
  layoutRadial.ts the "like the original" layout: rings, arcs, radial labels
  diff.ts         line LCS diff for the "Changes" tab
  treeDiff.ts     structural comparison against the tree as loaded (by node id)
  search.ts       finding a route by receiver / matcher
  alertSources.ts parsing alert dumps (PrometheusRule, API, CSV)
  promql.ts       selectors from expr, stripping the final threshold
  enrich.ts       Prometheus/VM client: real series labels
  batch.ts        the batch run + "why is this answer unresolved"

src/i18n/
  ru.ts           the reference dictionary
  en.ts           typed as `Dict`, so a missing key fails the build
  dict.ts         Lang/Dict, module-level locale, setLang/dict() — NO React
  react.ts        LangContext + useT()/useLang() — the React side
  Rich.tsx        renders `code` and **strong** markup inside dictionary strings

src/demo/
  exampleConfig.ts  the bundled example, plus the ?demo=1 check

src/state/
  store.ts        useReducer: state, undo/redo history, alert-test rows

src/components/
  editorContext.ts  the single editing API (EditorApi) shared by both views
  RouteEditor.tsx   shared editing blocks: matchers, fields, badges, controls
  BlockView.tsx     block view (recursive cards)
  GraphView.tsx     graph shell: toolbar, zoom, pan, focus, layout switch
  graph/RadialGraph.tsx    radial layout (like the original tool)
  graph/VerticalGraph.tsx  org chart + drag&drop re-parenting
  SearchPanel.tsx   tree search
  BatchView.tsx     batch check: source, external labels, enrichment, table
  Inspector.tsx     editing panel for the selected node (used by the graph)
  AlertTester.tsx   the alert-test panel and its results
  LoadScreen.tsx    the paste screen
  ExportDialog.tsx  export (three tabs) + self-check
  SourceDialog.tsx  read-only view of the untouched original
  LangSwitch.tsx    ru/en switch
  Modal.tsx         modal wrapper

src/App.tsx       assembly: derived data, EditorApi, hotkeys, ?demo=1
```

Rule: **no React imports may appear under `src/core/`**. Everything there is tested
in vitest without a DOM. That is also why `src/i18n/dict.ts` is split from
`src/i18n/react.ts` — core needs translations, not React.

## Invariants

1. **The original is immutable.** `state.source.text` is written once at load and
   never again. Every edit goes into `state.root`. The whole-file export is a text
   splice into `source.text` (`spliceRouteBlock`), which is what carries secrets and
   comments through verbatim.
2. **Almost no persistence.** The config lives only in the tab's memory: no
   `localStorage`, no `sessionStorage`, and no network requests other than the ones
   the user explicitly triggers. The **one** exception is the chosen UI language
   (`am-editor-lang`). If you add autosave, that is a deliberate change to the
   threat model — discuss it, and update the claims in the README and on the load
   screen along with the code.
3. **Only `name` is taken from `receivers:`.** See `extractReceiverNames`. Never
   pull `*_configs` into the model; there is a test for this.
4. **Mutations are immutable.** The functions in `src/core/tree.ts` follow
   `structuredClone` → mutate the copy → return a new root, or `null` when the
   operation is impossible. That is what makes an undo snapshot simply the previous
   root, and what lets React see a new reference.
5. **Unknown keys are never lost.** Anything the editor does not understand sits in
   `RouteNode.extra` and is emitted on export via `js-yaml`. When you add support
   for a new key, add it to `KNOWN_KEYS` (`parse.ts`) *and* to the output order
   (`serialize.ts`) — otherwise it will be written twice.
6. **Matchers are stored as strings.** `Matcher.raw` is exactly the text that will
   go into the YAML. Parsing happens on demand (`parseMatcher`) and is never cached
   in the model. That is what lets a user hold a temporarily invalid string in a
   field without corrupting the tree.
7. **`receiver === null` ≠ `receiver === 'null'`.** The first means the key is
   absent (the alert is lost silently); the second is a receiver *name* (a
   deliberate drop). Do not collapse them anywhere: not in the model, not in the
   UI, not in the export.
8. **A route is shown only when it is proven.** See the batch-check section below.

## Undo/redo history

The logic lives in `store.ts`, action `apply`:

- a structural operation arrives **without** `session` → always snapshot;
- a text-field edit arrives with a `session` key (e.g. `n17:receiver`): a snapshot
  is taken only when `session !== state.editSession`.

Fields call `endSession()` on `focus` and `blur`, so one editing session equals one
snapshot and `⌘+Z` undoes the whole field edit rather than one character. The
session key must be unique per field (`${nodeId}:receiver`, `${matcherId}:raw`, …)
or edits to two different fields will merge into one history step.

Hotkeys are captured globally in `App.tsx` with `preventDefault()`, including while
focus is in an `<input>`: the browser's native undo would fight ours, and we keep
history for text edits too.

## Derived data (not stored in state)

The alert-test result, path highlighting, the list of known receivers and the label
names are computed in `App.tsx` with `useMemo` over `(root, labels)`. So after any
edit or undo the result recomputes itself, and stale highlighting from an old tree
cannot survive in state.

## Internationalisation

The Russian dictionary is the reference shape; `Dict = typeof ru`, and `en.ts` is
typed as `Dict`. A missing key, a stray extra one, or a parameterised message whose
signature drifted is a **compile error**, not a blank label at runtime.

Values with substitutions are functions (`metricMissing: (m: string) => …`) so that
string assembly never leaks into components. Sentences carrying inline `code` or
**strong** markup stay one key and are rendered through `<Rich>` — splitting a
sentence into three keys would hand a translator fragments instead of meaning.

`src/core/` reads the current language through the module-level `dict()`. One
language per tab is the only mode this app has, so a module-level variable is honest
here; the alternative (returning message codes from core and resolving them in the
UI) would rewrite `warnings: string[]`, every `throw`, and a pile of tests for no
practical gain. Tests pin the locale in `src/test-setup.ts` and compare against
`dict()` rather than literals, so rewording a message does not break them.

## Graph view

Two layouts over one model, switched in the toolbar.

**Radial** (`core/layoutRadial.ts`) is the primary one and mirrors the official
routing-tree-editor: radius equals depth, leaves are spread evenly around the
circle, a parent sits centred between its outermost children, and links are cubic
Béziers in polar coordinates (the equivalent of `d3.linkRadial`).

The subtlety: every leaf gets the same angular slot, but arc length grows with
radius, so a leaf on an inner ring is the most cramped — on a real config thirteen
`null` routes at level one collapsed into an unreadable smear. Inflating every ring
is the wrong fix: the canvas grows and "fit to screen" drops to an unreadable 43%.
So rings stay compact and only the **crowded leaves are pushed outward** to the ring
where their labels fit; inner nodes stay exactly at their own depth.

**Vertical** (`core/layout.ts`) is a simplified tidy-tree: leaves left to right along
a cursor, a parent centred above its children, row height equal to the tallest node
on that level, orthogonal `V → H → V` edges. This is where matchers are visible
inside the blocks and where drag&drop works.

Common to both:

- an edge counts as "on the path" when both ends are in `pathIds`; a node enters
  `pathIds` only through its parent, so the edge really was walked;
- collapsed nodes are not laid out but remember the size of the hidden subtree;
- **subtree focus** (`focusId` in `GraphView`) is display only — the model does not
  change. It exists because a real org chart is thousands of pixels wide, and the
  answer to that is navigation, not zoom.

### Drag&drop

Drag state lives in a **ref**, not only in React state: between `mousedown` and the
first `mousemove` a re-render may not have happened, so a handler reading state
would still see it empty and a fast gesture would be dropped. The ref updates
synchronously; state exists only for rendering the highlight and the ghost. The drop
target is found by hit-testing the cursor against node rectangles (coordinates go
through `getBoundingClientRect`, accounting for zoom). Dropping a route inside its
own subtree is refused in `tree.reparent`.

## Tests

```
src/core/matchers.test.ts        matcher parsing, RE2→JS, missing labels
src/core/routing.test.ts         sibling order, continue, "receiver is not
                                 inherited", traps from real configs
src/core/parse.test.ts           input shapes, HelmRelease/ConfigMap, dialect,
                                 secrets, block bounds
src/core/serialize.test.ts       round trip, quoting, legacy match/match_re
src/core/layoutRadial.test.ts    rings, leaf angles, arcs, pushing out crowding
src/core/diff.test.ts            LCS diff, context collapsing, tree search
src/core/batch.test.ts           dump formats, ambiguity, variants, regression
src/core/enrich.test.ts          the TSDB client against a stub fetch
src/core/urls.test.ts            scheme handling and mixed content
src/demo/exampleConfig.test.ts   the bundled example and the defects it pins
src/core/amtool-fixtures.test.ts writes amtool-out/ for the CI check
src/core/real-config.smoke.test.ts  a run against YOUR real config (AM_CONFIG=…)
```

`amtool-fixtures` is the bridge to real validation: the test writes finished configs
and a CI step runs `amtool check-config` over them with the actual Alertmanager
binary. If you touch `serialize.ts`, watch that step — it catches what our own tests
cannot see in principle. It already has: the bundled example was rejected until it
gained an `smtp_smarthost`.

## Batch check

Separate document: [`BATCH-CHECK.md`](BATCH-CHECK.md). The invariants that must not
be broken:

1. **A route is shown only when it is proven.** Routing is deterministic, and the
   tool has no right to publish a "likely" route. A Prometheus rule is a template,
   not an alert: until it has been expanded into real series (`enrich.ts`),
   `resolution` is `unresolved`, `destinations` is empty, and the user gets the
   exact list of missing labels (`neededLabels`). `explainRoute` and its
   `ambiguities` are **diagnostics of that state**, not a way to guess the answer.
   Do not give in to "well, let's show *something*". Separately: do not infer the
   label set from `by (...)` in an expression — that was measured against real data
   and it is wrong (see `BATCH-CHECK.md`).
2. **Enrichment is optional and explicit.** Off by default; the user types the URL;
   only `expr` goes out. Do not auto-discover the address from the config and do not
   send the tree there. This is the only network operation in the whole application
   and it has to stay predictable.
3. **Rule labels win over series labels** (`mergeStatic`) — as in Prometheus. Order
   in `evaluateBatch`: series → rule `labels:` → external labels.
4. **`stripFinalComparison` only removes a numeric threshold.** `a > b` compares two
   series and its result has a different label set — leave it alone.

## Extension points

| Task | Where to look |
|---|---|
| A new route key (e.g. `group_by` on a non-root) | `types.ts` → `parse.ts` (`KNOWN_KEYS`, `buildNode`) → `serialize.ts` (order) → `RouteFields` |
| A third language | add `src/i18n/<lang>.ts` typed as `Dict`, register it in `DICTS` and in `LangSwitch`; the compiler will list every key you still owe |
| Diff "original vs edits" | `serializeRoute(root)` against the lines of `source.text[routeBlock]` |
| Validating against a real Alertmanager | the `amtool check-config` CI step; in a browser this is impossible |
