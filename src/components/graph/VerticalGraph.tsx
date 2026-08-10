/**
 * Vertical org chart: block nodes carrying their matchers, root on top.
 * Drag&drop re-parenting lives here too — dragging dots around the radial view is
 * fiddly, while these blocks are large and easy to hit.
 */

import { useMemo, useRef, useState } from 'react';
import { layoutTree, MAX_MATCHER_LINES, type GraphNode } from '../../core/layout';
import { parseMatcher } from '../../core/matchers';
import type { RouteNode } from '../../core/types';
import { useT } from '../../i18n/react';
import { useEditor } from '../editorContext';

const TITLE_CHARS = 30;
const MATCHER_CHARS = 33;
const DRAG_THRESHOLD = 5;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function severityColor(node: RouteNode): string {
  for (const m of node.matchers) {
    const c = parseMatcher(m.raw);
    if (c.ok && c.parsed?.label === 'severity' && c.parsed.op === '=') {
      const v = c.parsed.value;
      if (v === 'critical') return 'var(--dropped)';
      if (v === 'warning') return 'var(--warning)';
      if (v === 'info') return 'var(--info)';
      if (v === 'disaster') return 'var(--disaster)';
    }
  }
  if (node.receiver === 'null') return 'var(--text-faint)';
  if (node.receiver === null) return 'var(--warning)';
  return 'var(--accent)';
}

export interface DragState {
  sourceId: string;
  targetId: string | null;
  /** Cursor position in SVG coordinates — used to place the drag ghost. */
  x: number;
  y: number;
  moved: boolean;
}

export function VerticalGraph({
  viewRoot,
  zoom,
  pad,
  onDragStateChange,
}: {
  viewRoot: RouteNode;
  zoom: number;
  pad: number;
  onDragStateChange: (dragging: boolean) => void;
}): React.JSX.Element {
  const t = useT();
  const api = useEditor();
  const layout = useMemo(() => layoutTree(viewRoot), [viewRoot]);
  const svgRef = useRef<SVGSVGElement>(null);
  /**
   * Drag state lives in a ref, not only in state: between mousedown and the first
   * mousemove React may not have re-rendered yet, so the handler would still see an
   * empty state and a fast gesture would be dropped. The ref updates synchronously;
   * state exists only for rendering.
   */
  const dragRef = useRef<(DragState & { startX: number; startY: number }) | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const width = layout.width + pad * 2;
  const height = layout.height + pad * 2;

  /** Cursor position in layout coordinates (padding excluded). */
  const toLayoutCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom - pad,
      y: (clientY - rect.top) / zoom - pad,
    };
  };

  const nodeAt = (x: number, y: number): GraphNode | null =>
    layout.nodes.find((n) => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) ?? null;

  const finishDrag = (): void => {
    const current = dragRef.current;
    if (current?.moved && current.targetId && current.targetId !== current.sourceId) {
      api.reparent(current.sourceId, current.targetId);
    }
    dragRef.current = null;
    setDrag(null);
    onDragStateChange(false);
  };

  return (
    <svg
      ref={svgRef}
      className="graph-svg"
      width={width * zoom}
      height={height * zoom}
      viewBox={`0 0 ${width} ${height}`}
      role="tree"
      onMouseMove={(e) => {
        const current = dragRef.current;
        if (!current) return;
        const p = toLayoutCoords(e.clientX, e.clientY);
        if (!p) return;
        const moved =
          current.moved ||
          Math.hypot(e.clientX - current.startX, e.clientY - current.startY) > DRAG_THRESHOLD;
        if (moved && !current.moved) onDragStateChange(true);
        const hovered = nodeAt(p.x, p.y);
        const next = {
          ...current,
          moved,
          x: p.x,
          y: p.y,
          targetId: hovered && hovered.id !== current.sourceId ? hovered.id : null,
        };
        dragRef.current = next;
        setDrag(next);
      }}
      onMouseUp={finishDrag}
      onMouseLeave={() => {
        if (dragRef.current) finishDrag();
      }}
    >
      <g transform={`translate(${pad},${pad})`}>
        {layout.edges.map((e) => {
          const onPath = api.pathIds.has(e.fromId) && api.pathIds.has(e.toId);
          return <path key={e.id} className={`gedge${onPath ? ' on-path' : ''}`} d={e.path} />;
        })}

        {layout.nodes.map((g) => {
          const node = g.node;
          const classes = ['gnode'];
          if (api.selectedId === g.id) classes.push('selected');
          if (api.pathIds.has(g.id)) classes.push('on-path');
          if (api.targetIds.has(g.id)) classes.push('is-target');
          if (api.searchIds.has(g.id)) classes.push('found');
          if (node.receiver === 'null') classes.push('is-null');
          if (drag?.moved && drag.sourceId === g.id) classes.push('dragging');
          if (drag?.moved && drag.targetId === g.id) classes.push('drop-target');

          const title = node.isRoot
            ? t.graph.rootTooltip
            : node.receiver === null
              ? t.graph.receiverUnsetDash
              : node.receiver;
          const titleClass = node.isRoot
            ? 'title dim'
            : node.receiver === null
              ? 'title warn'
              : node.receiver === 'null'
                ? 'title null'
                : 'title';

          const shown = node.matchers.slice(0, MAX_MATCHER_LINES);

          return (
            <g
              key={g.id}
              className={classes.join(' ')}
              transform={`translate(${g.x},${g.y})`}
              onMouseDown={(e) => {
                e.stopPropagation();
                api.select(g.id);
                if (node.isRoot) return; // the root is never re-parented
                const started = {
                  sourceId: g.id,
                  targetId: null,
                  x: g.x,
                  y: g.y,
                  moved: false,
                  startX: e.clientX,
                  startY: e.clientY,
                };
                dragRef.current = started;
                setDrag(started);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (g.hasChildren) api.toggleCollapse(g.id);
              }}
            >
              <title>
                {[
                  node.isRoot ? t.graph.rootTooltip : null,
                  `receiver: ${node.receiver ?? t.graph.receiverUnset}`,
                  ...node.matchers.map((m) => m.raw),
                  node.continue ? 'continue: true' : null,
                  node.repeatInterval ? `repeat_interval: ${node.repeatInterval}` : null,
                  node.isRoot ? null : t.graph.dragHint,
                ]
                  .filter(Boolean)
                  .join('\n')}
              </title>
              <rect width={g.w} height={g.h} rx={7} />
              <rect className="accent-bar" width={3} height={g.h} rx={1.5} fill={severityColor(node)} />

              <text className={titleClass} x={10} y={17}>
                {truncate(title, TITLE_CHARS)}
              </text>
              {node.continue && (
                <text className="dim" x={g.w - 8} y={17} textAnchor="end">
                  ⏩
                </text>
              )}

              {shown.map((m, i) => (
                <text key={m.id} x={10} y={34 + i * 15}>
                  {truncate(m.raw, MATCHER_CHARS)}
                </text>
              ))}
              {node.matchers.length === 0 && (
                <text className="dim" x={10} y={34}>
                  {node.isRoot ? t.graph.alwaysMatches : t.batch.noMatchers}
                </text>
              )}
              {g.hiddenMatchers > 0 && (
                <text className="dim" x={10} y={34 + MAX_MATCHER_LINES * 15}>
                  {t.graph.moreMatchers(g.hiddenMatchers)}
                </text>
              )}

              {g.collapsed && (
                <g
                  className="collapse-badge"
                  transform={`translate(${g.w / 2},${g.h + 11})`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    api.toggleCollapse(g.id);
                  }}
                >
                  <circle r={11} />
                  <text textAnchor="middle" y={3.5}>
                    +{g.hiddenSubtree}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {drag?.moved && (
          <g className="drag-ghost" transform={`translate(${drag.x + 12},${drag.y + 12})`}>
            <rect width={186} height={24} rx={5} />
            <text x={9} y={16}>
              {drag.targetId ? t.graph.dropToAttach : t.graph.hoverAParent}
            </text>
          </g>
        )}
      </g>
    </svg>
  );
}
