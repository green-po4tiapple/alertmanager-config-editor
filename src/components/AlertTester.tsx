/**
 * Alert-test panel: arbitrary label=value pairs → the list of receivers the alert
 * will actually reach through the current (already edited) tree.
 */

import type { Dispatch } from 'react';
import { classifyOutcome, outcomeLabel, outcomeNote } from '../core/routing';
import type { MatchResult, RouteNode } from '../core/types';
import { Rich } from '../i18n/Rich';
import { useT } from '../i18n/react';
import type { Dict } from '../i18n/dict';
import { DEFAULT_LABEL_NAMES, type Action, type LabelRow } from '../state/store';

export function AlertTester({
  rows,
  dispatch,
  results,
  tested,
  labelNames,
  onSelectNode,
}: {
  rows: LabelRow[];
  dispatch: Dispatch<Action>;
  results: MatchResult[] | null;
  tested: boolean;
  labelNames: string[];
  onSelectNode: (id: string) => void;
}): React.JSX.Element {
  const t = useT();
  const nameOptions = [...new Set([...DEFAULT_LABEL_NAMES, ...labelNames])];

  return (
    <section className="side-section">
      <div className="eyebrow">
        <span>{t.tester.title}</span>
        {tested && (
          <button type="button" className="btn tiny ghost" onClick={() => dispatch({ type: 'clearTest' })}>
            {t.tester.clearHighlight}
          </button>
        )}
      </div>
      <span className="hint">{t.tester.hint}</span>

      <datalist id="label-names">
        {nameOptions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="label-rows">
        {rows.map((row) => (
          <div className="label-row" key={row.id}>
            <input
              list="label-names"
              placeholder="label"
              value={row.name}
              spellCheck={false}
              onChange={(e) => dispatch({ type: 'labelSet', id: row.id, patch: { name: e.target.value } })}
            />
            <input
              placeholder="value"
              value={row.value}
              spellCheck={false}
              onChange={(e) => dispatch({ type: 'labelSet', id: row.id, patch: { value: e.target.value } })}
            />
            <button
              type="button"
              className="icon-btn"
              title={t.tester.removeLabel}
              onClick={() => dispatch({ type: 'labelRemove', id: row.id })}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="link-btn" onClick={() => dispatch({ type: 'labelAdd' })}>
        {t.tester.addLabel}
      </button>

      <div className="test-actions">
        <button type="button" className="btn primary" onClick={() => dispatch({ type: 'runTest' })}>
          {t.tester.run}
        </button>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'labelsReset' })}>
          {t.common.clear}
        </button>
      </div>

      {tested && results && <Results results={results} onSelectNode={onSelectNode} t={t} />}
    </section>
  );
}

function Results({
  results,
  onSelectNode,
  t,
}: {
  results: MatchResult[];
  onSelectNode: (id: string) => void;
  t: Dict;
}): React.JSX.Element {
  if (results.length === 0) {
    return (
      <div className="result-list">
        <div className="result-card">{t.tester.nothingMatched}</div>
      </div>
    );
  }

  return (
    <div className="result-list">
      {results.length > 1 && (
        <span className="hint">
          <Rich text={t.tester.multiplePaths(results.length)} />
        </span>
      )}
      {results.map((r, i) => {
        const outcome = classifyOutcome(r.node);
        return (
          <div className={`result-card ${outcome}`} key={`${r.node.id}-${i}`}>
            <div className="result-head">
              <span className={`pill ${outcome}`}>{outcomeLabel(outcome)}</span>
              <span className="receiver-name">
                {r.node.receiver === null ? t.tester.receiverUnset : r.node.receiver}
              </span>
              {results.length > 1 && (
                <span className="badge">{t.tester.pathOf(i + 1, results.length)}</span>
              )}
            </div>

            <div className="path-list">
              {r.path.map((n, depth) => (
                <button
                  type="button"
                  className="path-step"
                  key={`${n.id}-${depth}`}
                  title={t.tester.showRoute}
                  onClick={() => onSelectNode(n.id)}
                >
                  <span className="dot">{depth === 0 ? '⌂' : '→'}</span>
                  <span>{describe(n, t)}</span>
                </button>
              ))}
            </div>

            {outcomeNote(outcome) && <div className="result-note">{outcomeNote(outcome)}</div>}
            {r.node.repeatInterval && (
              <div className="result-note">repeat_interval: {r.node.repeatInterval}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function describe(node: RouteNode, t: Dict): React.JSX.Element {
  if (node.isRoot) return <>{t.tester.rootRoute}</>;
  if (node.matchers.length === 0) return <>{t.tester.routeWithoutMatchers}</>;
  return (
    <>
      {node.matchers.map((m) => (
        <code key={m.id}>{m.raw}</code>
      ))}
    </>
  );
}
