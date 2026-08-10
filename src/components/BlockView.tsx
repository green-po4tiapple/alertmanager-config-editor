/**
 * Block view: a nested list of route cards with inline editing.
 */

import type { Labels } from '../core/matchers';
import { parseMatcher } from '../core/matchers';
import { changeLabel } from '../core/treeDiff';
import type { RouteNode } from '../core/types';
import { Rich } from '../i18n/Rich';
import { useT } from '../i18n/react';
import { useEditor } from './editorContext';
import { MatchersEditor, NodeBadges, NodeControls, RouteFields } from './RouteEditor';

/** Left-border tint by severity — the fastest thing for an eye to scan. */
function severityClass(node: RouteNode): string {
  for (const m of node.matchers) {
    const c = parseMatcher(m.raw);
    if (c.ok && c.parsed?.label === 'severity' && c.parsed.op === '=') {
      const v = c.parsed.value;
      if (v === 'critical' || v === 'warning' || v === 'info' || v === 'disaster') {
        return `sev-${v}`;
      }
    }
  }
  return '';
}

function RouteCard({
  node,
  testLabels,
  depth,
}: {
  node: RouteNode;
  testLabels: Labels | null;
  depth: number;
}): React.JSX.Element {
  const t = useT();
  const api = useEditor();
  // Under "changed only", the children kept are those leading to an edit.
  const visibleChildren = api.onlyChanged
    ? node.routes.filter((c) => api.changedVisible.has(c.id))
    : node.routes;
  const hasChildren = visibleChildren.length > 0;
  const change = api.changes.get(node.id);

  const classes = ['node-card'];
  if (change) classes.push(`change-${change}`);
  if (node.isRoot) classes.push('root');
  if (api.selectedId === node.id) classes.push('selected');
  if (api.pathIds.has(node.id)) classes.push('on-path');
  if (api.targetIds.has(node.id)) classes.push('is-target');
  if (api.searchIds.has(node.id)) classes.push('found');
  if (node.receiver === 'null') classes.push('is-null');
  const sev = severityClass(node);
  if (sev) classes.push(sev);

  return (
    <div className="node">
      <div
        className={classes.join(' ')}
        onMouseDown={() => api.select(node.id)}
        role="group"
        aria-label={node.isRoot ? t.block.ariaRoot : t.block.ariaRoute}
      >
        <div className="node-row">
          <button
            type="button"
            className="node-toggle"
            disabled={!hasChildren}
            title={
              hasChildren
                ? node.collapsed
                  ? t.common.expand
                  : t.common.collapse
                : t.block.noChildren
            }
            onClick={() => api.toggleCollapse(node.id)}
          >
            {hasChildren ? (node.collapsed ? `▸${node.routes.length}` : '▾') : '·'}
          </button>

          <div className="node-main">
            <MatchersEditor node={node} testLabels={testLabels} />
            <RouteFields node={node} />
            <NodeBadges node={node} />
            {change && (
              <div className="node-meta">
                <span className={`badge change-${change}`}>{changeLabel(change)}</span>
              </div>
            )}
          </div>

          <NodeControls node={node} />
        </div>
      </div>

      {hasChildren && !node.collapsed && (
        <div className="node-children">
          {visibleChildren.map((child) => (
            <RouteCard key={child.id} node={child} testLabels={testLabels} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BlockView({
  root,
  testLabels,
}: {
  root: RouteNode;
  testLabels: Labels | null;
}): React.JSX.Element {
  const t = useT();
  return (
    <>
      <div className="pane-head">
        <span className="eyebrow">{t.block.title}</span>
        <span className="hint">
          <Rich text={t.block.hint} />
        </span>
      </div>
      <div className="blocks-scroll">
        <div className="blocks-tree">
          <RouteCard node={root} testLabels={testLabels} depth={0} />
        </div>
      </div>
    </>
  );
}
