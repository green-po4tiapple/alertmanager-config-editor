/**
 * Radial view — visually mirrors Prometheus's official routing-tree-editor: root in
 * the centre, one ring per level, arcs for links, labels along the radius.
 */

import { useMemo } from 'react';
import { labelTransform, layoutRadial, radialLabel } from '../../core/layoutRadial';
import type { RouteNode } from '../../core/types';
import { useT } from '../../i18n/react';
import { useEditor } from '../editorContext';

const MAX_LABEL = 26;

function truncate(text: string, max = MAX_LABEL): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function RadialGraph({
  viewRoot,
  zoom,
}: {
  viewRoot: RouteNode;
  zoom: number;
}): React.JSX.Element {
  const t = useT();
  const api = useEditor();
  const layout = useMemo(() => layoutRadial(viewRoot), [viewRoot]);

  return (
    <svg
      className="graph-svg radial"
      width={layout.size * zoom}
      height={layout.size * zoom}
      viewBox={`0 0 ${layout.size} ${layout.size}`}
      role="tree"
    >
      <g transform={`translate(${layout.center},${layout.center})`}>
        {layout.edges.map((e) => {
          const onPath = api.pathIds.has(e.fromId) && api.pathIds.has(e.toId);
          return <path key={e.id} className={`redge${onPath ? ' on-path' : ''}`} d={e.path} />;
        })}

        {layout.nodes.map((n) => {
          const { deg, flip } = labelTransform(n.angle);
          const label = radialLabel(n.node);
          const classes = ['rnode', `kind-${label.kind}`];
          if (api.selectedId === n.id) classes.push('selected');
          if (api.pathIds.has(n.id)) classes.push('on-path');
          if (api.targetIds.has(n.id)) classes.push('is-target');
          if (api.searchIds.has(n.id)) classes.push('found');
          if (n.node.continue) classes.push('has-continue');

          return (
            <g
              key={n.id}
              className={classes.join(' ')}
              transform={`rotate(${deg}) translate(${n.radius},0)`}
              onMouseDown={(e) => {
                e.stopPropagation();
                api.select(n.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (n.hasChildren) api.toggleCollapse(n.id);
              }}
            >
              <title>
                {[
                  n.node.isRoot ? t.graph.rootTooltip : null,
                  `receiver: ${n.node.receiver ?? t.graph.receiverUnset}`,
                  ...n.node.matchers.map((m) => m.raw),
                  n.node.continue ? 'continue: true' : null,
                  n.node.repeatInterval ? `repeat_interval: ${n.node.repeatInterval}` : null,
                  n.collapsed ? t.graph.collapsedCount(n.hiddenSubtree) : null,
                ]
                  .filter(Boolean)
                  .join('\n')}
              </title>

              {/* The clickable area is deliberately larger than the dot itself. */}
              <circle className="hit" r={11} />
              <circle className="dot" r={n.node.isRoot ? 6 : n.collapsed ? 7 : 4.5} />
              {n.collapsed && <circle className="collapsed-ring" r={10} />}

              <g transform={flip ? 'rotate(180)' : undefined}>
                <text
                  className="rlabel"
                  x={flip ? -13 : 13}
                  dy="0.32em"
                  textAnchor={flip ? 'end' : 'start'}
                >
                  {truncate(label.text)}
                  {n.collapsed ? ` (+${n.hiddenSubtree})` : ''}
                </text>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
