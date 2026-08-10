/**
 * Inspector for the selected route — the editing panel used by the graph view.
 * It reuses the very same editing components as the block-view cards.
 */

import type { Labels } from '../core/matchers';
import { locate } from '../core/tree';
import type { RouteNode } from '../core/types';
import { useT } from '../i18n/react';
import { useEditor } from './editorContext';
import { MatchersEditor, NodeBadges, NodeControls, RouteFields } from './RouteEditor';

export function Inspector({
  root,
  testLabels,
}: {
  root: RouteNode;
  testLabels: Labels | null;
}): React.JSX.Element {
  const t = useT();
  const api = useEditor();
  const located = api.selectedId ? locate(root, api.selectedId) : null;

  if (!located) {
    return (
      <section className="side-section">
        <div className="eyebrow">
          <span>{t.inspector.title}</span>
        </div>
        <span className="hint">{t.inspector.empty}</span>
      </section>
    );
  }

  const { node, chain } = located;

  return (
    <section className="side-section">
      <div className="eyebrow">
        <span>{node.isRoot ? t.inspector.rootTitle : t.inspector.title}</span>
        <span className="hint">
          {t.inspector.level(chain.length)}
          {node.routes.length > 0 ? ` · ${t.inspector.children(node.routes.length)}` : ''}
        </span>
      </div>

      {chain.length > 0 && (
        <div className="path-list">
          {chain.map((a, i) => (
            <button
              type="button"
              className="path-step"
              key={a.id}
              title={t.inspector.goToParent}
              onClick={() => api.select(a.id)}
            >
              <span className="dot">{i === 0 ? '⌂' : '→'}</span>
              <span>
                {a.isRoot ? (
                  <>{t.inspector.rootRoute}</>
                ) : a.matchers.length === 0 ? (
                  <>{t.inspector.noMatchers}</>
                ) : (
                  a.matchers.map((m) => <code key={m.id}>{m.raw}</code>)
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="node-card selected" style={{ borderLeftColor: 'var(--accent)' }}>
        <div className="node-main">
          <MatchersEditor node={node} testLabels={testLabels} />
          <RouteFields node={node} />
          <NodeBadges node={node} />
        </div>
      </div>

      <NodeControls node={node} />

      {Object.keys(node.extra).length > 0 && (
        <div className="extra-note">
          {t.inspector.untouchedKeys} <code>{Object.keys(node.extra).join(', ')}</code>
        </div>
      )}
    </section>
  );
}
