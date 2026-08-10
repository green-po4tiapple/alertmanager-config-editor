import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { collectHighlight, matchTree } from './core/routing';
import {
  addChild as opAddChild,
  addMatcher as opAddMatcher,
  addSibling as opAddSibling,
  countNodes,
  expandTo,
  indentNode,
  labelNamesInTree,
  moveDown,
  moveUp,
  outdentNode,
  patchNode,
  receiversInTree,
  removeMatcher as opRemoveMatcher,
  removeNode,
  reparent as opReparent,
  setCollapsedAll,
  setMatcherRaw,
  toggleCollapsed,
  treeDepth,
  locate,
} from './core/tree';
import { parseConfig } from './core/parse';
import { searchTree } from './core/search';
import { serializeRoute } from './core/serialize';
import { diffTrees } from './core/treeDiff';
import { BatchView, initialBatchState, type BatchState } from './components/BatchView';
import type { RouteNode } from './core/types';
import { AlertTester } from './components/AlertTester';
import { BlockView } from './components/BlockView';
import { EditorContext, type EditorApi, type MoveDirection, type NodePatch } from './components/editorContext';
import { ExportDialog } from './components/ExportDialog';
import { GraphView } from './components/GraphView';
import { Inspector } from './components/Inspector';
import { LoadScreen } from './components/LoadScreen';
import { SearchPanel } from './components/SearchPanel';
import { SourceDialog } from './components/SourceDialog';
import { EXAMPLE_CONFIG, demoRequested } from './demo/exampleConfig';
import { loadLang, setLang as setLangGlobal, type Lang } from './i18n/dict';
import { LangContext, useT } from './i18n/react';
import { Rich } from './i18n/Rich';
import type { Dict } from './i18n/dict';
import { LangSwitch } from './components/LangSwitch';
import { initialState, labelsToObject, reducer } from './state/store';

type Theme = 'auto' | 'light' | 'dark';

/**
 * Outer shell: owns the language and provides it to everything below.
 *
 * It has to be a separate component from `Editor` — a component cannot consume a
 * context it provides itself, and `Editor` reads translations everywhere.
 */
export function App(): React.JSX.Element {
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = loadLang();
    setLangGlobal(initial);
    return initial;
  });
  const langApi = useMemo(
    () => ({
      lang,
      setLang: (next: Lang): void => {
        setLangGlobal(next);
        setLangState(next);
      },
    }),
    [lang],
  );

  return (
    <LangContext.Provider value={langApi}>
      <Editor />
    </LangContext.Provider>
  );
}

function Editor(): React.JSX.Element {
  const t = useT();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [theme, setTheme] = useState<Theme>('auto');
  const [showExport, setShowExport] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Batch-check state lives here so it survives switching between views.
  const [batch, setBatch] = useState<BatchState>(initialBatchState);
  const { root, source } = state;

  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') delete el.dataset.theme;
    else el.dataset.theme = theme;
  }, [theme]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  /* ---------------------------- derived values ----------------------------- */

  const testLabels = useMemo(() => labelsToObject(state.labels), [state.labels]);

  const results = useMemo(() => {
    if (!root || !state.tested) return null;
    return matchTree(root, testLabels);
  }, [root, state.tested, testLabels]);

  const highlight = useMemo(
    () => (results ? collectHighlight(results) : { pathIds: new Set<string>(), targetIds: new Set<string>() }),
    [results],
  );

  const knownReceivers = useMemo(() => {
    if (!root) return state.receiverNames;
    return [...new Set([...state.receiverNames, ...receiversInTree(root)])].sort();
  }, [root, state.receiverNames]);

  const labelNames = useMemo(() => (root ? labelNamesInTree(root) : []), [root]);

  const searchIds = useMemo(() => {
    if (!root || state.search.trim() === '') return new Set<string>();
    return new Set(searchTree(root, state.search).map((h) => h.node.id));
  }, [root, state.search]);

  const treeChanges = useMemo(
    () =>
      root && state.baselineRoot
        ? diffTrees(state.baselineRoot, root)
        : { changed: new Map(), keep: new Set<string>(), removed: 0, hasChanges: false },
    [root, state.baselineRoot],
  );

  /* ------------------------------- mutations ------------------------------- */

  const apply = useCallback(
    (next: RouteNode | null, session?: string, select?: string) => {
      if (!next) return;
      dispatch({ type: 'apply', root: next, session, select });
    },
    [dispatch],
  );

  const api = useMemo<EditorApi>(() => {
    const need = (): RouteNode => root as RouteNode;
    return {
      knownReceivers,
      configReceivers: state.receiverNames,
      selectedId: state.selectedId,
      pathIds: highlight.pathIds,
      targetIds: highlight.targetIds,
      searchIds,
      changes: treeChanges.changed,
      onlyChanged: state.onlyChanged,
      changedVisible: treeChanges.keep,
      select: (id) => dispatch({ type: 'select', id }),
      patch: (id: string, patch: NodePatch, session?: string) =>
        apply(patchNode(need(), id, patch), session),
      endSession: () => dispatch({ type: 'endSession' }),
      setMatcher: (id, matcherId, raw, session) =>
        apply(setMatcherRaw(need(), id, matcherId, raw), session),
      addMatcher: (id) => apply(opAddMatcher(need(), id)),
      removeMatcher: (id, matcherId) => apply(opRemoveMatcher(need(), id, matcherId)),
      move: (id, dir: MoveDirection) => {
        const fn =
          dir === 'up' ? moveUp : dir === 'down' ? moveDown : dir === 'indent' ? indentNode : outdentNode;
        const next = fn(need(), id);
        if (!next) {
          showToast(
            dir === 'indent'
              ? t.app.noPreviousSibling
              : dir === 'outdent'
                ? t.app.alreadyTopLevel
                : t.app.cannotMoveFurther,
          );
          return;
        }
        apply(next);
      },
      reparent: (id, newParentId) => {
        const next = opReparent(need(), id, newParentId);
        if (!next) {
          showToast(t.app.cannotReparentIntoItself);
          return;
        }
        apply(next, undefined, id);
        showToast(t.app.reparented);
      },
      addChild: (id) => {
        const r = opAddChild(need(), id);
        if (r) apply(r.root, undefined, r.newId);
      },
      addSibling: (id) => {
        const r = opAddSibling(need(), id);
        if (r) apply(r.root, undefined, r.newId);
      },
      remove: (id) => {
        const located = locate(need(), id);
        if (!located) return;
        const kids = countNodes(located.node) - 1;
        if (kids > 0 && !window.confirm(t.app.confirmDelete(kids))) return;
        apply(removeNode(need(), id));
        if (state.selectedId === id) dispatch({ type: 'select', id: located.parent?.id ?? null });
      },
      toggleCollapse: (id) => apply(toggleCollapsed(need(), id)),
    };
  }, [
    root,
    knownReceivers,
    state.receiverNames,
    state.selectedId,
    state.onlyChanged,
    highlight,
    searchIds,
    treeChanges,
    apply,
    showToast,
    t,
  ]);

  /** Selecting from a test result: expand the ancestors, then select the route. */
  const selectAndReveal = useCallback(
    (id: string) => {
      if (!root) return;
      const expanded = expandTo(root, id);
      if (expanded) dispatch({ type: 'apply', root: expanded, select: id });
      else dispatch({ type: 'select', id });
    },
    [root, dispatch],
  );

  /** Jumping to a route from the batch table also switches to the block view. */
  const revealFromBatch = useCallback(
    (id: string) => {
      dispatch({ type: 'setView', view: 'blocks' });
      selectAndReveal(id);
    },
    [dispatch, selectAndReveal],
  );

  /* ------------------------------- keyboard ------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (key === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (key === 'e' && root) {
        e.preventDefault();
        setShowExport(true);
      } else if (key === 'enter' && root) {
        e.preventDefault();
        dispatch({ type: 'runTest' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, root]);

  /**
   * `?demo=1` loads the bundled example straight away, so the project can be shown
   * with a single link. Without the flag the start screen stays empty on purpose:
   * nothing is ever loaded that the user did not ask for.
   */
  useEffect(() => {
    if (!demoRequested(window.location.search)) return;
    const parsed = parseConfig(EXAMPLE_CONFIG);
    if (!parsed.ok) return;
    dispatch({
      type: 'load',
      parsed,
      sourceText: EXAMPLE_CONFIG,
      baselineYaml: serializeRoute(parsed.root),
    });
    // Runs once on mount: re-loading the example on every render would throw away
    // whatever the visitor had already edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------- render -------------------------------- */

  if (!root || !source) {
    return (
      <div className="app">
        <Topbar
          theme={theme}
          setTheme={setTheme}
          state={state}
          dispatch={dispatch}
          onExport={() => setShowExport(true)}
          onSource={() => setShowSource(true)}
          t={t}
        />
        <LoadScreen
          onLoaded={(parsed, sourceText, origin) => {
            dispatch({
              type: 'load',
              parsed,
              sourceText,
              // Diff baseline: the same tree run through our own serializer.
              baselineYaml: serializeRoute(parsed.root),
              ...(origin ? { origin: 'api' as const, originUrl: origin.url } : {}),
            });
            // The address is useful in the batch check — prefill it right away.
            if (origin) setBatch((b) => ({ ...b, alertmanagerUrl: origin.url }));
          }}
        />
      </div>
    );
  }

  return (
    <EditorContext.Provider value={api}>
      <div className="app">
        <Topbar
          theme={theme}
          setTheme={setTheme}
          state={state}
          dispatch={dispatch}
          onExport={() => setShowExport(true)}
          onSource={() => setShowSource(true)}
          t={t}
        />

        <datalist id="known-receivers">
          {knownReceivers.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>

        <div className="workbench">
          <div className="main-pane">
            {state.view === 'batch' ? (
              <BatchView
                root={root}
                baselineRoot={state.baselineRoot}
                state={batch}
                onChange={(patch) => setBatch((b) => ({ ...b, ...patch }))}
                onSelectNode={revealFromBatch}
                onToast={showToast}
              />
            ) : state.view === 'blocks' ? (
              <BlockView root={root} testLabels={state.tested ? testLabels : null} />
            ) : (
              <GraphView
                root={root}
                layoutMode={state.graphLayout}
                onLayoutModeChange={(layout) => dispatch({ type: 'setGraphLayout', layout })}
                onCollapseAll={() => apply(setCollapsedAll(root, true))}
                onExpandAll={() => apply(setCollapsedAll(root, false))}
              />
            )}
          </div>

          <aside className="side-pane">
            <SearchPanel
              root={root}
              query={state.search}
              onQueryChange={(query) => dispatch({ type: 'setSearch', query })}
              onSelectNode={selectAndReveal}
            />

            <AlertTester
              rows={state.labels}
              dispatch={dispatch}
              results={results}
              tested={state.tested}
              labelNames={labelNames}
              onSelectNode={selectAndReveal}
            />

            {state.view === 'graph' && (
              <Inspector root={root} testLabels={state.tested ? testLabels : null} />
            )}

            <section className="side-section">
              <div className="eyebrow">
                <span>{t.app.receiversTitle}</span>
                <span className="hint">{knownReceivers.length}</span>
              </div>
              <span className="hint">
                <Rich text={t.app.receiversHint} />
              </span>
              <ReceiverChips root={root} names={knownReceivers} t={t} />
            </section>

            {state.warnings.length > 0 && (
              <section className="side-section">
                <div className="eyebrow">
                  <span>{t.app.parseWarnings}</span>
                  <span className="hint">{state.warnings.length}</span>
                </div>
                <ul className="warn-list">
                  {state.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            )}

            <section className="side-section">
              <div className="eyebrow">
                <span>{t.app.changesTitle}</span>
                {treeChanges.hasChanges && (
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={state.onlyChanged}
                      onChange={() => dispatch({ type: 'toggleOnlyChanged' })}
                    />
                    {t.app.onlyChanged}
                  </label>
                )}
              </div>
              {treeChanges.hasChanges ? (
                <span className="hint">
                  {t.app.changedCount(treeChanges.changed.size)}
                  {treeChanges.removed > 0 ? t.app.removedCount(treeChanges.removed) : ''}
                  {t.app.changesFilterHint}
                </span>
              ) : (
                <span className="hint">{t.app.noChangesYet}</span>
              )}
            </section>

            <section className="side-section">
              <div className="eyebrow">
                <span>{t.app.treeTitle}</span>
              </div>
              <span className="hint">
                {t.app.treeStats(
                  countNodes(root),
                  treeDepth(root),
                  state.past.length,
                  state.future.length,
                )}
              </span>
            </section>
          </aside>
        </div>

        {showExport && (
          <ExportDialog
            root={root}
            source={source}
            baselineYaml={state.baselineYaml}
            onClose={() => setShowExport(false)}
            onToast={showToast}
          />
        )}
        {showSource && <SourceDialog source={source} onClose={() => setShowSource(false)} />}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </EditorContext.Provider>
  );
}

function ReceiverChips({
  root,
  names,
  t,
}: {
  root: RouteNode;
  names: string[];
  t: Dict;
}): React.JSX.Element {
  const used = useMemo(() => new Set(receiversInTree(root)), [root]);
  return (
    <div className="chips">
      {names.map((n) => (
        <span
          key={n}
          className={`chip ${used.has(n) ? 'used' : 'unused'}`}
          title={used.has(n) ? t.app.receiverUsed : t.app.receiverUnused}
        >
          {n}
        </span>
      ))}
    </div>
  );
}

function Topbar({
  theme,
  setTheme,
  state,
  dispatch,
  onExport,
  onSource,
  t,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  state: ReturnType<typeof initialState>;
  dispatch: React.Dispatch<Parameters<typeof reducer>[1]>;
  onExport: () => void;
  onSource: () => void;
  t: Dict;
}): React.JSX.Element {
  const loaded = state.root !== null;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">⌁</span>
        <span>
          Alertmanager Routing Tree Editor
          <small>{t.app.tagline}</small>
        </span>
      </div>

      {loaded && (
        <div className="topbar-group">
          <div className="segmented">
            <button
              type="button"
              className={state.view === 'blocks' ? 'active' : ''}
              onClick={() => dispatch({ type: 'setView', view: 'blocks' })}
            >
              {t.app.viewBlocks}
            </button>
            <button
              type="button"
              className={state.view === 'graph' ? 'active' : ''}
              onClick={() => dispatch({ type: 'setView', view: 'graph' })}
            >
              {t.app.viewGraph}
            </button>
            <button
              type="button"
              className={state.view === 'batch' ? 'active' : ''}
              title={t.app.viewBatchTitle}
              onClick={() => dispatch({ type: 'setView', view: 'batch' })}
            >
              {t.app.viewBatch}
            </button>
          </div>

          <button
            type="button"
            className="btn"
            disabled={state.past.length === 0}
            title="⌘/Ctrl+Z"
            onClick={() => dispatch({ type: 'undo' })}
          >
            ↶ {t.app.undo}
          </button>
          <button
            type="button"
            className="btn"
            disabled={state.future.length === 0}
            title="⌘/Ctrl+Shift+Z"
            onClick={() => dispatch({ type: 'redo' })}
          >
            ↷ {t.app.redo}
          </button>
        </div>
      )}

      <div className="topbar-group">
        {loaded && (
          <>
            <button type="button" className="btn" onClick={onSource}>
              {t.app.original}
            </button>
            <button type="button" className="btn primary" onClick={onExport} title="⌘/Ctrl+E">
              {t.app.exportYaml}
            </button>
            <button
              type="button"
              className="btn danger"
              title={t.app.loadAnotherTitle}
              onClick={() => {
                if (window.confirm(t.app.loadAnotherConfirm)) {
                  dispatch({ type: 'unload' });
                }
              }}
            >
              {t.app.loadAnother}
            </button>
          </>
        )}
        <LangSwitch />
        <div className="segmented" title={t.app.theme}>
          <button type="button" className={theme === 'auto' ? 'active' : ''} onClick={() => setTheme('auto')}>
            {t.app.themeAuto}
          </button>
          <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
            ☀
          </button>
          <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
            ☾
          </button>
        </div>
      </div>
    </header>
  );
}
