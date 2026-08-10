/**
 * English dictionary.
 *
 * Typed as `Dict` (derived from `ru.ts`), so the compiler rejects a missing key, a
 * stray extra one, or a parameterised message whose signature drifted apart from
 * the reference.
 */

import type { Dict } from './dict';

export const en: Dict = {
  /* ------------------------------- src/core -------------------------------- */

  outcome: {
    delivered: { label: 'delivered', note: '' },
    'drop-null': {
      label: 'dropped (explicit null)',
      note:
        'A receiver literally named "null" — a deliberate drop: this route exists precisely ' +
        'to swallow such alerts.',
    },
    'drop-no-receiver': {
      label: 'dropped (no receiver on this route)',
      note:
        'This route has no receiver of its own and none of its children matched. A receiver ' +
        'is NOT inherited from the parent, so the effective receiver is empty and the alert ' +
        'is lost silently.',
    },
  },

  change: {
    added: 'added',
    modified: 'modified',
    moved: 'moved',
    'moved-modified': 'moved and modified',
  },

  resolution: {
    exact: 'resolved',
    'no-series': 'no series — no alerts',
    unresolved: 'series labels needed',
  },

  matcher: {
    emptyString: 'empty string',
    multipleInOneLine: 'several matchers on one line — split them into separate lines',
    noOperator: 'no operator (=, !=, =~, !~)',
    noLabelName: 'label name is missing',
    badLabelName: (label: string): string => `invalid label name: ${label}`,
    unclosedQuote: 'unclosed quote in the value',
    inlineFlagNotAtStart:
      'the inline flag (?…) was not at the start of the pattern — JS cannot do that, so the ' +
      'flag was applied to the whole expression (in Go it would only last until the end of ' +
      'its group)',
    unsupportedRegexFlag: (flag: string): string => `unsupported regex flag: (?${flag})`,
    invalidRegex: (message: string): string => `invalid regex: ${message}`,
  },

  endpoint: {
    schemeAdded: (url: string): string => `scheme filled in: ${url}`,
    addressReplaced: (url: string): string => `address replaced with ${url}`,
  },

  parse: {
    emptyInput: 'Nothing to parse — paste some YAML.',
    yamlFailed: (message: string): string => `YAML did not parse: ${message}`,
    expectedMapping:
      'Expected a YAML mapping: either a whole config with a route: key, or the route: block ' +
      'itself (receiver/matchers/routes), or a list of routes starting with "- ".',
    noRouteKey: (keys: string): string =>
      'Found neither a route: key nor anything that looks like a route block. Top-level keys: ' +
      `${keys || '(none)'}.`,
    nestedRoute: (path: string): string =>
      `The route: block was found not at the top level but at ${path} — this looks like a ` +
      'HelmRelease/ConfigMap. The whole-file export will put the block back in the same place.',
    routeMustBeMapping: 'The route: key must be a mapping.',
    dedented: (spaces: number): string =>
      `The paste was indented by ${spaces} space(s) — the indent was stripped before parsing.`,
    routesFragmentWrapped:
      'A fragment of a route list was pasted — it has been attached under a root route:.',
    continueMustBeBool: (where: string, got: string): string =>
      `${where}: continue must be true/false, got ${got}.`,
    routesMustBeList: (where: string): string => `${where}: routes: must be a list — ignored.`,
    routeNotMapping: (where: string): string => `${where}: not a mapping — route skipped.`,
    receiverYamlNull: (where: string): string =>
      `${where}: unquoted receiver: null is a YAML null, not a receiver named "null". ` +
      'Treating it as "no receiver set".',
    receiverNotString: (where: string, type: string): string =>
      `${where}: receiver is not a string (${type}) — coerced to one.`,
    matchersMustBeList: (where: string): string =>
      `${where}: matchers: must be a list of strings — ignored.`,
    matcherItemNotString: (where: string): string =>
      `${where}: a matchers entry is not a string — coerced to one.`,
    legacyMustBeMapping: (where: string, origin: string): string =>
      `${where}: ${origin}: must be a mapping — ignored.`,
    legacyDeprecated: (where: string, origin: string, op: string): string =>
      `${where}: the ${origin}: key is deprecated in Alertmanager. Shown as a ` +
      `\`label${op}"value"\` matcher; the export will turn it back into ${origin}:.`,
    receiversNotList: 'receivers: is not a list — receiver names were not extracted.',
  },

  source: {
    emptyInput: 'Nothing to parse.',
    yamlFailed: (message: string): string => `YAML did not parse: ${message}`,
    jsonFailed: (message: string): string => `JSON did not parse: ${message}`,
    noAlertingRules:
      'No alerting rules found. Expected a PrometheusRule dump, a rule file with a groups: ' +
      'key, or JSON from the Prometheus/Alertmanager API.',
    noAlertingRulesInApi: 'The /api/v1/rules response contains no alerting rules.',
    emptyArray: 'The array is empty, or its entries carry no labels.',
    expectedObjectOrArray: 'Expected an object or an array.',
    unknownJson:
      'Unrecognised JSON. Expected a response from /api/v1/rules, /api/v1/alerts or /api/v2/alerts.',
    csvNeedsHeaderAndRow: 'CSV needs a header row and at least one data row.',
    csvNoDataRows: 'The CSV contains no data rows.',
    csvRow: (index: number): string => `row ${index}`,
    noAlertname: '(no alertname)',
    firingAlert: 'firing alert',
    labelsNotMapping: (where: string): string => `${where}: labels is not a mapping — ignored.`,
  },

  batch: {
    noExternalLabels: 'no external labels',
    noMatchers: '(no matchers)',
  },

  enrich: {
    noAddress: 'no address given',
    badStatus: (status: string): string => `response status=${status}`,
    version: (version: string): string => `version ${version}`,
    connected: 'connected',
    noConfigOriginal: 'the /api/v2/status response has no config.original',
    noExpr: 'the rule has no expr — nothing to expand',
    firingNow: (count: number): string =>
      `firing right now: ${count} label set(s) from the expression`,
    notFiringUsedRelaxed: (count: number): string =>
      `not firing right now; labels taken from the expression without its threshold (${count})`,
    metricMissing: (metric: string): string =>
      `metric ${metric} does not exist in this TSDB at all — either the exporter is silent or ` +
      'the data is written to a different Prometheus',
    metricPresentNoMatch: (metric: string, count: number): string =>
      `metric ${metric} exists (${count} series) but none matched the expression filters — ` +
      'check the matchers in expr',
    noMetricInExpr: 'no metric found in the expression',
    timeout: 'request timed out',
  },

  /* ------------------------------ interface -------------------------------- */

  common: {
    close: 'Close',
    clear: 'Clear',
    expand: 'Expand',
    collapse: 'Collapse',
  },

  sourceDialog: {
    title: 'Original pasted config (read-only)',
    intro: (lines: number): string =>
      `This is the source text exactly as it arrived: ${lines} lines. The editor never ` +
      'overwrites it — every edit lives in a separate working copy of the tree.',
    fromApi: (url: string): string =>
      `Fetched from \`${url}\` (\`/api/v2/status\`); Alertmanager itself replaced the secrets ` +
      'in it with `<secret>`.',
    showWholeFile: 'show the whole file (including `receivers:` with tokens)',
  },

  search: {
    title: 'Search the tree',
    matches: (count: number): string => `${count} matches`,
    placeholder: 'receiver or matcher, e.g. oncall',
    nothingFound: 'Nothing found in receivers or in matchers.',
    goToRoute: 'Go to route',
    matcher: 'matcher',
    level: (depth: number): string => `lvl ${depth}`,
  },

  inspector: {
    title: 'Selected route',
    rootTitle: 'Root route',
    empty: 'Click a block on the diagram to edit it here.',
    level: (n: number): string => `level ${n}`,
    children: (n: number): string => `children: ${n}`,
    goToParent: 'Go to the parent route',
    rootRoute: 'root route',
    noMatchers: 'no matchers',
    untouchedKeys: 'Keys the editor leaves alone but preserves on export:',
  },

  block: {
    title: 'Routing tree — block view',
    hint:
      'Order matters: the first matching sibling at a level wins unless it carries ' +
      '`continue`. Dimmed cards are `receiver: "null"` — a deliberate drop. Edits apply ' +
      'immediately; `⌘/Ctrl+Z` undoes them.',
    ariaRoot: 'root route',
    ariaRoute: 'routing route',
    noChildren: 'No child routes',
  },

  tester: {
    title: 'Test an alert',
    clearHighlight: 'clear highlight',
    hint:
      'Set the labels of a hypothetical alert. A missing label reads as an empty string — ' +
      'exactly how Alertmanager treats it.',
    removeLabel: 'Remove label',
    addLabel: '+ label',
    run: 'Test →',
    nothingMatched:
      'No route matched, not even the root. That can only happen when the root itself has ' +
      'matchers and they failed.',
    multiplePaths: (count: number): string =>
      `${count} paths matched — because of \`continue: true\` the alert goes to every receiver ` +
      'listed below at once.',
    receiverUnset: '(no receiver set)',
    pathOf: (index: number, total: number): string => `path ${index}/${total}`,
    showRoute: 'Show this route',
    rootRoute: 'root route',
    routeWithoutMatchers: 'route without matchers',
  },

  graph: {
    title: 'Routing tree — graph view',
    hintRadial:
      'Root in the centre, levels fanning out as rings — the same shape as the official ' +
      'routing-tree-editor. Click a node to select it and open the inspector on the right; ' +
      'double-click to collapse or expand its subtree.',
    hintVertical:
      'Root on top, routes fanning downwards, matchers visible inside the blocks. Drag a ' +
      'block onto another to make it a child; double-click to collapse or expand; drag empty ' +
      'space to pan.',
    radial: 'Radial',
    radialTitle: "Same shape as Prometheus's official routing-tree-editor",
    vertical: 'Blocks',
    verticalTitle: 'Blocks with matchers, drag&drop of routes',
    fitToScreen: 'Fit to screen',
    collapseAll: 'Collapse all',
    expandAll: 'Expand all',
    focus: 'Focus',
    focusTitle: 'Show only the selected subtree (the model does not change)',
    focusUp: 'up',
    focusUpTitle: 'One level up',
    wholeRoute: 'whole route',
    focusOn: (what: string): string => `focus: ${what}`,
    nodeCount: (n: number): string => `${n} nodes`,
    rootTooltip: 'route (root)',
    receiverUnset: '(not set)',
    receiverUnsetDash: '— no receiver set —',
    collapsedCount: (n: number): string => `collapsed routes: ${n}`,
    dragHint: 'drag onto another block to re-parent',
    alwaysMatches: '(always matches)',
    moreMatchers: (n: number): string => `+${n} matcher(s)`,
    dropToAttach: 'release — becomes a child',
    hoverAParent: 'hover over the future parent',
  },

  route: {
    matcherHint:
      'label="value" | label!="value" | label=~"regex" | label!~"regex". ' +
      'The regex must match in full (^(?:…)$); a leading (?i) is allowed.',
    legacyMatcherHint: (origin: string): string =>
      `Came from the legacy ${origin}: key — the export will put it back there.`,
    removeMatcher: 'Remove matcher',
    addMatcher: '+ matcher',
    didNotMatch: 'did not match: actual value',
    labelAbsent: '"" (label absent)',
    rootAlwaysMatches: 'root — always matches',
    noMatchersMatchesAll: 'no matchers — matches every alert',
    receiverUnsetPlaceholder: '— not set —',
    receiverUnknown: 'This name is not in the receivers: block of the pasted config',
    receiverHint:
      'Receiver name. Empty = no receiver key at all (the alert is lost silently). ' +
      '"null" = a deliberate drop.',
    commaSeparated: 'Comma-separated list',
    badgeContinue: 'After a match, processing continues with the next siblings',
    badgeNull: 'Deliberate drop',
    badgeNoReceiver: 'no receiver',
    badgeNoReceiverTitle:
      'No receiver of its own: if no child matches, the alert is lost silently',
    badgeLeafNoReceiver: 'leaf without receiver',
    badgeLeafNoReceiverTitle: 'A leaf with no receiver — the alert is lost',
    badgeGoesHere: 'goes here',
    badgeExtra: (n: number): string => `+${n} key(s)`,
    badgeExtraTitle: (keys: string): string => `Preserved on export: ${keys}`,
    moveUp: 'Up among siblings',
    moveDown: 'Down among siblings',
    indent: 'Make it a child of the previous sibling',
    outdent: 'Lift one level up',
    addChild: '+child',
    addChildTitle: 'Add a child route',
    addSibling: '+sibling',
    addSiblingTitle: 'Add a sibling route',
    removeRoute: 'Delete route',
  },

  exportDialog: {
    title: 'Export YAML',
    size: (lines: number, bytes: number): string => `${lines} lines · ${bytes} bytes`,
    download: 'Download file',
    copy: 'Copy',
    copied: 'Copied to clipboard',
    copyFailed: 'Could not copy — select the text manually',
    saved: 'File saved',
    tabRoute: 'route: block only',
    tabFile: 'Whole file',
    tabFileTitle: 'The original file with the route: block replaced',
    tabFileDisabledApi:
      'Unavailable: the config came from the Alertmanager API, where secrets read <secret>',
    tabFileNeedsWholeFile: 'Available only when a whole file was pasted',
    tabDiff: 'Changes',
    tabDiffTitle: 'What exactly changed relative to the loaded config',
    tabDiffNone: '(none)',
    hintDiff:
      'Compared against the tree as of load time. Both texts went through the same serializer, ' +
      'so the diff shows real edits only, not differences in YAML formatting.',
    hintRoute:
      'A ready `route:` block — paste it over the old one in `alertmanager_config.yaml`. Key ' +
      'order is normalised, meaning and structure are preserved exactly, and matcher strings ' +
      'are not re-quoted.',
    hintFile:
      'The pasted file with only the `route:` block replaced. Everything else — `receivers:`, ' +
      '`inhibit_rules:`, comments — is carried over from the original verbatim.',
    apiSecretsNote:
      '⚠️ The config came from the Alertmanager API, so the source carries `<secret>` instead ' +
      'of tokens. The `route:` block below contains no secrets and can be pasted as-is; the ' +
      'whole-file tab is disabled deliberately.',
    noChanges:
      'The tree matches the one that was loaded — no edits (or they cancelled each other out).',
    selfCheckUnparsable: (error: string): string => `⚠ The export does not parse back: ${error}`,
    selfCheckInvalidMatchers: (count: number, examples: string): string =>
      `⚠ The tree has ${count} invalid matcher(s) — Alertmanager would reject this config: ` +
      examples,
  },

  load: {
    title: 'Alertmanager routing tree',
    subtitle:
      'Paste a whole `alertmanager_config.yaml`, or just the `route:` block (a bare list of ' +
      'routes starting with `- matchers:` works too) — or the HelmRelease it lives inside. ' +
      'Parsing happens in the browser; the config never leaves the page and is never written ' +
      'to browser storage.',
    pullTitle: 'Fetch from a running Alertmanager',
    pullHint:
      '`GET /api/v2/status` → `config.original`. The scheme is optional — `https` is assumed, ' +
      'and `http` is automatically retried over `https` if it fails. Alertmanager returns the ' +
      'config with secrets masked (`bot_token: <secret>`), which makes this the safest source ' +
      'for editing the tree — but such a file must never be written back to a cluster whole, ' +
      'so the whole-file export is disabled for it.',
    pullButton: 'Fetch config',
    pullBusy: 'Fetching…',
    authNeeded: 'authentication required',
    username: 'username',
    password: 'password',
    orPaste: 'or paste it yourself',
    loadTree: 'Load tree',
    openFile: 'Open file…',
    loadExample: 'Example',
    exampleTitle: 'Load a demo config — try the editor without using your own data',
    dropHint: 'or drop a file here · ⌘/Ctrl+Enter',
    factFeatures:
      '**What this editor does.** Two views over one tree (a nested block list and a diagram), ' +
      'moving and re-parenting routes, testing an arbitrary label set and seeing every receiver ' +
      'it reaches (`continue` included), and exporting a ready `route:` block.',
    factSecrets:
      '**Secrets.** When a whole file is pasted, only the names are taken from `receivers:`. ' +
      'Tokens, URLs and `*_configs` never enter application state at all, sops ciphertexts in a ' +
      'HelmRelease included.',
    factNetwork:
      '**Network.** The app reaches out only when you press a button, and only to addresses you ' +
      'typed in: the config from Alertmanager, rules and firing alerts, and — in batch mode — ' +
      'label enrichment from Prometheus/VM. The routing tree and the pasted config are never ' +
      'sent anywhere.',
    factOriginal:
      '**The original is untouched.** The pasted text is kept separately and is never ' +
      'overwritten by anything in the interface. YAML appears only when you press Export.',
    amHttpError: (status: string): string =>
      `Alertmanager answered ${status} — the address is reachable, but /api/v2/status returned ` +
      'no config.',
    amNetworkError: (message: string, tried: string): string =>
      `Could not fetch the config: ${message}. Tried ${tried}. Check that the address is ` +
      'reachable from this network and serves CORS headers.',
  },

  app: {
    tagline: 'parsed in your browser · the config never leaves it',
    viewBlocks: 'Blocks',
    viewGraph: 'Graph',
    viewBatch: 'Batch',
    viewBatchTitle: 'Run an alert dump through the current tree',
    undo: 'Undo',
    redo: 'Redo',
    original: 'Original',
    exportYaml: 'Export YAML',
    loadAnother: 'Another config',
    loadAnotherTitle: 'Back to the paste screen — current edits will be lost',
    loadAnotherConfirm: 'Load another config? Current edits will be lost.',
    theme: 'Theme',
    themeAuto: 'auto',
    receiversTitle: 'Receivers',
    receiversHint:
      'Only the names were taken from `receivers:` — they feed autocomplete. Dimmed ones are ' +
      'not used by any route.',
    receiverUsed: 'used in the tree',
    receiverUnused: 'not used by any route',
    parseWarnings: 'Parse notes',
    changesTitle: 'Changes',
    onlyChanged: 'changed only',
    changedCount: (n: number): string => `Edited routes: ${n}`,
    removedCount: (n: number): string => ` · routes deleted: ${n}`,
    changesFilterHint: '. The toggle keeps only changed routes and their parents in the tree.',
    noChangesYet:
      'The tree matches the one that was loaded — no edits yet. The filter appears here as soon ' +
      'as you change something.',
    treeTitle: 'Tree',
    treeStats: (nodes: number, depth: number, past: number, future: number): string =>
      `Routes: ${nodes} · depth: ${depth} · history: ${past} step(s) back, ${future} forward`,
    noPreviousSibling: 'There is no previous sibling to attach this to',
    alreadyTopLevel: 'The route is already at the top level',
    cannotMoveFurther: 'Nowhere further to move',
    cannotReparentIntoItself: 'Cannot re-parent: a route may not be nested inside itself',
    reparented: 'Route re-parented',
    confirmDelete: (kids: number): string => `Delete this route together with its ${kids} nested?`,
  },

  batchUi: {
    title: 'Batch check',
    intro:
      'Load an alert dump and see where each one goes through the current (already edited) tree. ' +
      'A route is shown only once it is proven: a Prometheus rule knows only its static ' +
      '`labels:`, so it is first expanded into real series by querying the TSDB — until then no ' +
      'receiver is shown at all.',

    step1: '1. Connections (optional)',
    step1Hint:
      'You type the addresses yourself — nothing is hard-coded. The scheme is optional: `https` ' +
      'is assumed, and `http` is retried over `https` automatically. Only requests to these ' +
      'addresses ever leave the page; the routing tree and the pasted config are never sent ' +
      'anywhere.',
    check: 'Check',
    checking: 'checking…',
    authRequired: 'authentication required (basic)',
    credentialsNote:
      'Kept only in this tab’s memory and sent as an Authorization header to the addresses above.',

    step2: '2. Alert source',
    step2Hint:
      'Easiest is to pull it over the API from the block above. Otherwise paste or drop a file: ' +
      'a `PrometheusRule` dump (`kubectl get prometheusrule -A -o yaml`), a rule file, an ' +
      '`/api/v1/rules` response, an `/api/v2/alerts` dump, or CSV with a header of label names.',
    pullRules: 'Rules from Prometheus',
    pullRulesTitle: 'GET /api/v1/rules?type=alert — every alerting rule',
    pullAlerts: 'Firing alerts from Alertmanager',
    pullAlertsTitle: 'GET /api/v2/alerts — what is firing right now (labels are complete)',
    fetching: 'fetching…',
    sourceIs: (from: string): string => `source: ${from}`,
    loadDump: 'Load dump',
    loadedAlerts: (n: number): string => `Alerts loaded: ${n}`,
    format: {
      'prometheus-rule-crd': 'PrometheusRule dump from a cluster',
      'prometheus-rule-file': 'Prometheus rule file',
      'prometheus-rules-api': '/api/v1/rules response',
      'alerts-api': 'firing alerts (complete labels)',
      csv: 'CSV',
    },
    alertCount: (n: number): string => `alerts: ${n}`,

    step3: '3. External labels',
    step3Hint:
      'The ones Prometheus adds itself (`cluster`, `location`) — a rule dump has none of them, ' +
      'yet routing looks at them. Several comma-separated values give one run each, so a ' +
      'difference in behaviour between clusters is immediately visible.',
    remove: 'Remove',
    addExternalLabel: '+ external label',
    variantCount: (n: number, list: string): string => `Run variants: ${n} (${list})`,

    step4: '4. Label enrichment from Prometheus / VictoriaMetrics',
    step4Hint:
      'Needed when the source is rules, which know only their static `labels:`. Not needed for a ' +
      'dump of firing alerts, whose labels are already real. Only **rule expressions** are sent, ' +
      'to the address from block 1.',
    enableEnrichment: 'enrich labels by querying the TSDB',
    seriesPerRule: 'series per rule',
    enrichLabels: 'Enrich labels',
    enriching: (done: number, total: number): string => `Enriching… ${done}/${total}`,
    abort: 'Abort',
    aborted: 'Aborted.',
    needPromUrl: 'Set the Prometheus/VM address in block 1.',
    noExprInDump: 'The dump has no expressions (expr) — nothing to enrich.',
    enrichSummary: (
      exact: number,
      approx: number,
      noData: number,
      noMatch: number,
      errors: number,
    ): string =>
      `Firing now (exact labels): ${exact} · expanded without threshold: ${approx} · ` +
      `metric absent from TSDB: ${noData} · filters matched nothing: ${noMatch} · errors: ${errors}`,
    expanding: (name: string): string => `expanding ${name}…`,

    httpAnswered: (status: string): string =>
      `${status} — the address answers, just not with what we asked for: check the path and permissions.`,
    causesHttps:
      'Possible causes: the service is unreachable from this network, sends no CORS headers, or ' +
      'uses a self-signed certificate.',
    causesHttp:
      'Possible causes: the service is unreachable from this network or sends no CORS headers.',
    requestFailed: (message: string, tried: string, causes: string): string =>
      `${message}. Tried ${tried}. ${causes}`,

    result: 'Result',
    resultCounts: (rows: number, alerts: number): string => `rows: ${rows} · alerts: ${alerts}`,
    notShown: (n: number): string => ` · not shown: ${n}`,
    statDelivered: 'delivered',
    statDropNull: 'dropped (explicit null)',
    statLost: 'lost',
    statUnresolved: 'not expanded into alerts',
    statNoSeries: 'no series',
    statChanged: 'route changed',
    statMulti: 'several receivers',
    regressionNote: (changed: number, rows: number): string =>
      `Your edits re-route **${changed}** of ${rows} rows. The "route changed" filter shows only ` +
      'those — that is the regression of an edit: a behaviour diff, not a YAML diff.',
    unresolvedNote: (n: number): string =>
      `${n} rule(s) were never expanded into alerts, so no route was computed for them: a rule ` +
      'is a template, and series labels appear only when it fires.',
    expandAllViaProm: 'expand them all via Prometheus',
    unresolvedNeedProm:
      'Set the Prometheus address in block 1 to expand them into real alerts.',
    noReceiverBucket: '(no receiver)',
    emptyName: '(empty)',

    filterAll: 'all',
    filterUnresolved: 'not expanded',
    filterMulti: 'several',
    searchPlaceholder: 'filter by alert, label or receiver',
    copyCsv: 'Copy CSV',
    copiedRows: (n: number): string => `Rows copied: ${n}`,
    downloadCsv: 'Download CSV',
    downloadMarkdown: 'Download markdown',

    colAlert: 'Alert',
    colLabels: 'Known labels',
    colOutcome: 'Outcome',
    colWhy: 'Why',
    truncatedTable: (total: number): string =>
      `Showing the first 500 rows of ${total}. Narrow the filter or export CSV.`,
    seriesOf: (index: number, total: number): string => `series ${index}/${total}`,
    enrichmentLabel: 'enrichment',
    didNotMatchBefore: '(did not match)',
    whyNoSeries:
      'The rule currently yields no series — there are no alerts from it, so there is nothing to route.',
    whyUnresolved: (labels: string): string =>
      `The rule was not expanded into alerts. The tree asks this alert about \`${labels}\`; those ` +
      'labels appear only when it fires.',

    detailBefore: 'Before your edits',
    noRouteMatched: 'no route matched',
    detailAfter: 'After your edits',
    detailPath: 'Path through the tree',
    detailBlockers: 'Routes that hinge on unknown labels',
    detailBlockersHint:
      'Until the rule is expanded into real alerts these routes cannot be decided — which is why ' +
      'no route is shown.',
    showRoute: 'show route',
    expandViaProm: 'Expand into alerts via Prometheus',
    openInProm: 'Open in Prometheus',
    withoutThreshold: 'Without threshold',
    withoutThresholdTitle:
      'The same expression without its final threshold — shows series even when the rule is not firing',
    detailAttempts: 'Queries that were made',
    attempt: {
      expr: 'expression as-is',
      'expr-without-threshold': 'without the final threshold',
      'series-exists': 'does the metric exist at all',
    },
    seriesCount: (n: number): string => `series: ${n}`,
  },
};
