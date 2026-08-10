# Working on this repository

For agents and contributors. Read this before changing anything; it is short on
purpose, and every rule here exists because breaking it cost something.

## What this project is

A browser-only editor for the Alertmanager routing tree. It has one job that
justifies its existence: **tell the truth about where an alert goes**. Every design
decision below follows from that.

## Ground rules

1. **Never show an unproven answer.** If the routing result depends on labels that
   are not known, show no receiver at all and say exactly which labels are missing.
   A plausible answer next to a disclaimer is worse than no answer: people remember
   the answer and forget the disclaimer. This has been re-learned the hard way; see
   invariant 8 in `docs/ARCHITECTURE.md`.
2. **Verify semantics against the source, not against the previous version.** The
   reference for routing is `dispatch/route.go` in Alertmanager. If a spec, a
   comment or an older implementation disagrees with it, the source wins.
3. **Do not infer facts from syntax.** In particular: do not derive an alert's label
   set from `by (...)` in a PromQL expression. It was measured against a real
   corpus and it is wrong (`docs/BATCH-CHECK.md`).
4. **`receiver === null` is not `receiver === 'null'`.** Absent key = silent loss;
   the string `null` = a deliberate drop. Never collapse them.
5. **The pasted original is immutable.** Edits live in a working copy; the
   whole-file export splices text rather than re-dumping YAML, which is what keeps
   secrets and comments intact.
6. **Only names are read from `receivers:`.** No `*_configs`, ever. There is a test.
7. **No React under `src/core/`.** That is what keeps the core testable without a
   DOM. If core needs translations, it imports `src/i18n/dict.ts`, never
   `src/i18n/react.ts`.
8. **Keep the network surface explicit.** Requests happen only on a user action, only
   to a user-typed address, and never carry the tree or the config. If you add a
   feature that weakens this, change the claims in both READMEs and on the load
   screen in the same commit.

## Layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full map. The short
version:

```
src/core/        pure logic, no React, fully tested
src/i18n/        dictionaries; ru is the reference shape, en is typed against it
src/components/  both views, sharing one editing API (editorContext.ts)
src/state/       useReducer store + undo/redo
src/demo/        the bundled example config
```

## How to verify a change

Running the test suite is necessary and not sufficient. In order of strength:

```bash
npx tsc --noEmit          # types, including dictionary key parity
npm test                  # unit tests for the core

# The export validated by the REAL Alertmanager parser:
docker run --rm -v "$PWD/amtool-out:/cfg" --entrypoint sh \
  prom/alertmanager:v0.28.1 -c 'amtool check-config /cfg/*.yaml'

# The whole core against a real config (skips itself without the variable):
AM_CONFIG=/path/to/alertmanager.yml npm test
```

And then **open a browser**. Sixty green unit tests say nothing about whether a
button moves a route. Any UI change needs a scripted run that asserts DOM state, and
a look at the screenshots with your own eyes — including the light theme and both
languages.

Two failure modes that unit tests structurally cannot catch, and that have both
happened here:

- **Gesture state read in the same event tick.** Drag&drop broke only on fast
  gestures, because React had not re-rendered between `mousedown` and the first
  `mousemove`. Such state belongs in a `ref`; React state is for rendering only.
- **Layout that fixes one defect and ruins the scale.** Widening the rings made
  labels readable and made "fit to screen" 43%. After any layout change, compare the
  canvas size and the fit percentage before and after.

## Adding a language

Add `src/i18n/<lang>.ts` typed as `Dict`, register it in `DICTS` (`dict.ts`) and in
`LangSwitch.tsx`. The compiler will then list every key you still owe. Keep whole
sentences in one key — `<Rich>` renders `` `code` `` and `**strong**` inline, which
is what lets other languages reorder words freely.

## Test data

Use synthetic names (`checkout`, `payments`, `platform_chat`, `prod`, `staging`).
The bundled example in `src/demo/exampleConfig.ts` deliberately contains two real
defects — a route that loses `info` alerts silently, and a dead `!~".*"` matcher —
and there are tests pinning both. If a test fails because someone tidied the example
up, restore the example, not the test: an example where nothing can go wrong
demonstrates nothing.

## Screenshots

`docs/img/*.png` are generated with puppeteer against `?demo=1` at
`deviceScaleFactor: 2`, English UI. They are committed rather than built in CI; a
generation script is not shipped because it would need puppeteer as a dependency for
everyone. Regenerate them by hand when the UI changes noticeably.

`docs/img/social-preview.png` (1280×640) is the card shown when a link to the
repository is pasted into Slack, Telegram or a chat. GitHub exposes no API for it:
after changing the file, upload it by hand under **Settings → General → Social
preview**.

## Getting a change in

`main` is protected: no direct pushes, and the `Types, tests, amtool` check has to
be green. That applies to everyone, maintainers included.

```bash
git switch -c my-change
# … work …
npm run typecheck && npm test
git push -u origin my-change
gh pr create --fill
```

Every pull request from a branch in this repository gets its own deployed copy at
`/pr-<number>/` on the Pages site, and a bot comments the link. It is rebuilt on
each push and deleted when the pull request closes — so a reviewer can click
through the actual change instead of taking a screenshot on trust.

Pull requests from forks run with a read-only token and therefore get no preview.
For those, CI attaches the built site as a `site` artifact on the run instead.
