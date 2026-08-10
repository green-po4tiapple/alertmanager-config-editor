/**
 * Route-editing pieces shared by both views: the matcher list, the fields
 * (receiver / continue / repeat_interval / …) and the control buttons.
 *
 * The block view embeds them directly in a card; the graph view puts them in the
 * inspector for the selected node. The model and the handlers are the same
 * (EditorContext), which is why the two views can never drift apart.
 */

import { useMemo } from 'react';
import { evalMatcher, parseMatcher, type Labels } from '../core/matchers';
import type { RouteNode } from '../core/types';
import { useT } from '../i18n/react';
import { useEditor } from './editorContext';

export function MatchersEditor({
  node,
  testLabels,
}: {
  node: RouteNode;
  testLabels: Labels | null;
}): React.JSX.Element {
  const t = useT();
  const api = useEditor();
  // "Why it did not match" is shown only where it answers a question the user asked:
  // on the selected route and on routes along the walked path. Otherwise the whole
  // screen fills with notes about routes this test never even considered.
  const explain = api.selectedId === node.id || api.pathIds.has(node.id);

  return (
    <div className="matchers-box">
      {node.matchers.map((m) => {
        const check = parseMatcher(m.raw);
        const evaluated = explain && testLabels && check.ok ? evalMatcher(m.raw, testLabels) : null;
        const classes = ['matcher-input'];
        if (!check.ok) classes.push('bad');
        if (m.origin !== 'matchers') classes.push('legacy');
        if (evaluated && !evaluated.pass) classes.push('miss');
        return (
          <div key={m.id}>
            <div className="matcher-line">
              <input
                className={classes.join(' ')}
                value={m.raw}
                spellCheck={false}
                title={
                  m.origin === 'matchers'
                    ? t.route.matcherHint
                    : t.route.legacyMatcherHint(m.origin)
                }
                onChange={(e) => api.setMatcher(node.id, m.id, e.target.value, `${m.id}:raw`)}
                onFocus={() => api.endSession()}
                onBlur={() => api.endSession()}
              />
              <button
                type="button"
                className="icon-btn"
                title={t.route.removeMatcher}
                onClick={() => api.removeMatcher(node.id, m.id)}
              >
                ✕
              </button>
            </div>
            {!check.ok && <div className="matcher-error">{check.error}</div>}
            {check.ok && check.warning && <div className="matcher-warn">⚠ {check.warning}</div>}
            {evaluated && !evaluated.pass && (
              <div className="matcher-warn">
                {t.route.didNotMatch}{' '}
                <code>{evaluated.actual === '' ? t.route.labelAbsent : evaluated.actual}</code>
              </div>
            )}
          </div>
        );
      })}

      {node.matchers.length === 0 && (
        <div className="no-matchers">
          {node.isRoot ? t.route.rootAlwaysMatches : t.route.noMatchersMatchesAll}
        </div>
      )}

      <button type="button" className="link-btn" onClick={() => api.addMatcher(node.id)}>
        {t.route.addMatcher}
      </button>
    </div>
  );
}

export function RouteFields({ node }: { node: RouteNode }): React.JSX.Element {
  const t = useT();
  const api = useEditor();
  const receiverValue = node.receiver ?? '';
  const known = useMemo(() => new Set(api.configReceivers), [api.configReceivers]);
  const unknownReceiver =
    receiverValue !== '' && api.configReceivers.length > 0 && !known.has(receiverValue);

  const receiverClasses: string[] = [];
  if (receiverValue === 'null') receiverClasses.push('receiver-null');
  if (unknownReceiver) receiverClasses.push('receiver-unknown');

  return (
    <div className="fields-row">
      <label className="field">
        <span>receiver</span>
        <input
          type="text"
          list="known-receivers"
          value={receiverValue}
          placeholder={t.route.receiverUnsetPlaceholder}
          spellCheck={false}
          className={receiverClasses.join(' ')}
          title={unknownReceiver ? t.route.receiverUnknown : t.route.receiverHint}
          onChange={(e) => {
            const raw = e.target.value;
            api.patch(node.id, { receiver: raw.trim() === '' ? null : raw }, `${node.id}:receiver`);
          }}
          onFocus={() => api.endSession()}
          onBlur={() => api.endSession()}
        />
      </label>

      <label className="chk">
        <input
          type="checkbox"
          checked={node.continue}
          onChange={(e) => api.patch(node.id, { continue: e.target.checked })}
        />
        continue
      </label>

      <label className="field">
        <span>repeat_interval</span>
        <input
          type="text"
          className="narrow"
          value={node.repeatInterval}
          placeholder="30m"
          spellCheck={false}
          onChange={(e) => api.patch(node.id, { repeatInterval: e.target.value }, `${node.id}:ri`)}
          onFocus={() => api.endSession()}
          onBlur={() => api.endSession()}
        />
      </label>

      {node.isRoot && (
        <>
          <label className="field">
            <span>group_wait</span>
            <input
              type="text"
              className="narrow"
              value={node.groupWait}
              placeholder="30s"
              spellCheck={false}
              onChange={(e) => api.patch(node.id, { groupWait: e.target.value }, `${node.id}:gw`)}
              onFocus={() => api.endSession()}
              onBlur={() => api.endSession()}
            />
          </label>
          <label className="field">
            <span>group_interval</span>
            <input
              type="text"
              className="narrow"
              value={node.groupInterval}
              placeholder="5m"
              spellCheck={false}
              onChange={(e) => api.patch(node.id, { groupInterval: e.target.value }, `${node.id}:gi`)}
              onFocus={() => api.endSession()}
              onBlur={() => api.endSession()}
            />
          </label>
        </>
      )}

      {node.groupBy !== null && (
        <label className="field">
          <span>group_by</span>
          <input
            type="text"
            value={node.groupBy.join(', ')}
            spellCheck={false}
            title={t.route.commaSeparated}
            onChange={(e) =>
              api.patch(
                node.id,
                {
                  groupBy: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
                `${node.id}:gb`,
              )
            }
            onFocus={() => api.endSession()}
            onBlur={() => api.endSession()}
          />
        </label>
      )}
    </div>
  );
}

export function NodeBadges({ node }: { node: RouteNode }): React.JSX.Element | null {
  const t = useT();
  const api = useEditor();
  const badges: React.JSX.Element[] = [];

  if (node.continue) {
    badges.push(
      <span key="c" className="badge continue" title={t.route.badgeContinue}>
        continue
      </span>,
    );
  }
  if (node.receiver === 'null') {
    badges.push(
      <span key="n" className="badge null" title={t.route.badgeNull}>
        null
      </span>,
    );
  }
  if (node.receiver === null && node.routes.length > 0) {
    badges.push(
      <span
        key="nr"
        className="badge no-receiver"
        title={t.route.badgeNoReceiverTitle}
      >
        {t.route.badgeNoReceiver}
      </span>,
    );
  }
  if (node.receiver === null && node.routes.length === 0) {
    badges.push(
      <span key="nr0" className="badge no-receiver" title={t.route.badgeLeafNoReceiverTitle}>
        {t.route.badgeLeafNoReceiver}
      </span>,
    );
  }
  if (api.targetIds.has(node.id)) {
    badges.push(
      <span key="t" className="badge hit">
        {t.route.badgeGoesHere}
      </span>,
    );
  }
  const extraKeys = Object.keys(node.extra);
  if (extraKeys.length > 0) {
    badges.push(
      <span key="e" className="badge" title={t.route.badgeExtraTitle(extraKeys.join(', '))}>
        {t.route.badgeExtra(extraKeys.length)}
      </span>,
    );
  }
  if (node.muteTimeIntervals || node.activeTimeIntervals) {
    badges.push(
      <span key="mi" className="badge" title="mute_time_intervals / active_time_intervals">
        time intervals
      </span>,
    );
  }

  if (badges.length === 0) return null;
  return <div className="node-meta">{badges}</div>;
}

export function NodeControls({ node }: { node: RouteNode }): React.JSX.Element {
  const t = useT();
  const api = useEditor();
  const isRoot = node.isRoot;

  return (
    <div className="node-controls">
      <button
        type="button"
        className="btn tiny"
        title={t.route.moveUp}
        disabled={isRoot}
        onClick={() => api.move(node.id, 'up')}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn tiny"
        title={t.route.moveDown}
        disabled={isRoot}
        onClick={() => api.move(node.id, 'down')}
      >
        ↓
      </button>
      <button
        type="button"
        className="btn tiny"
        title={t.route.indent}
        disabled={isRoot}
        onClick={() => api.move(node.id, 'indent')}
      >
        ⇥
      </button>
      <button
        type="button"
        className="btn tiny"
        title={t.route.outdent}
        disabled={isRoot}
        onClick={() => api.move(node.id, 'outdent')}
      >
        ⇤
      </button>
      <button
        type="button"
        className="btn tiny"
        title={t.route.addChildTitle}
        onClick={() => api.addChild(node.id)}
      >
        {t.route.addChild}
      </button>
      <button
        type="button"
        className="btn tiny"
        title={t.route.addSiblingTitle}
        disabled={isRoot}
        onClick={() => api.addSibling(node.id)}
      >
        {t.route.addSibling}
      </button>
      <button
        type="button"
        className="btn tiny danger"
        title={t.route.removeRoute}
        disabled={isRoot}
        onClick={() => api.remove(node.id)}
      >
        🗑
      </button>
    </div>
  );
}
