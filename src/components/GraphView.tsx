/**
 * Shell around the graph view: toolbar, zoom, panning, subtree focus and the layout
 * switch.
 *
 * The radial layout mirrors Prometheus's official routing-tree-editor. The vertical
 * one (an org chart) shows matchers inside the blocks and supports drag&drop
 * re-parenting.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { layoutTree } from '../core/layout';
import { layoutRadial } from '../core/layoutRadial';
import { locate } from '../core/tree';
import type { RouteNode } from '../core/types';
import { useT } from '../i18n/react';
import { useEditor } from './editorContext';
import { RadialGraph } from './graph/RadialGraph';
import { VerticalGraph } from './graph/VerticalGraph';

export type GraphLayoutMode = 'radial' | 'vertical';

const PAD = 16;

export function GraphView({
  root,
  layoutMode,
  onLayoutModeChange,
  onCollapseAll,
  onExpandAll,
}: {
  root: RouteNode;
  layoutMode: GraphLayoutMode;
  onLayoutModeChange: (mode: GraphLayoutMode) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
}): React.JSX.Element {
  const t = useT();
  const api = useEditor();

  // Subtree focus: real trees get very wide (a production org chart ran to 17,000 px),
  // and looking at all of it at once is useless. Focus is display only — zooming out
  // does not help readability, navigating does. The model never changes.
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = focusId ? locate(root, focusId) : null;
  const viewRoot = focus?.node ?? root;
  useEffect(() => {
    if (focusId && !locate(root, focusId)) setFocusId(null);
  }, [root, focusId]);

  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const size = useMemo(() => {
    if (layoutMode === 'radial') {
      const l = layoutRadial(viewRoot);
      return { w: l.size, h: l.size, nodes: l.nodes.length };
    }
    const l = layoutTree(viewRoot);
    return { w: l.width + PAD * 2, h: l.height + PAD * 2, nodes: l.nodes.length };
  }, [viewRoot, layoutMode]);

  const fit = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const byWidth = (el.clientWidth - 32) / size.w;
    const byHeight = (el.clientHeight - 32) / size.h;
    setZoom(Math.min(2, Math.max(0.08, Math.min(byWidth, byHeight))));
  };

  // The radial layout is fitted to the screen right away — there it is meaningful,
  // unlike an org chart thousands of pixels wide.
  useEffect(() => {
    if (layoutMode === 'radial') fit();
    else setZoom(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMode, focusId]);

  // Scroll to the selected node when the selection arrived from elsewhere.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !api.selectedId || layoutMode !== 'vertical') return;
    const l = layoutTree(viewRoot);
    const target = l.nodes.find((n) => n.id === api.selectedId);
    if (!target) return;
    const cx = (target.x + PAD + target.w / 2) * zoom;
    const cy = (target.y + PAD + target.h / 2) * zoom;
    if (cx < el.scrollLeft || cx > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = Math.max(0, cx - el.clientWidth / 2);
    }
    if (cy < el.scrollTop || cy > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, cy - el.clientHeight / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.selectedId]);

  const startPan = (e: React.MouseEvent): void => {
    if (e.button !== 0 || dragging) return;
    const el = scrollRef.current;
    if (!el) return;
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setPanning(true);
  };
  const stopPan = (): void => {
    pan.current = null;
    setPanning(false);
  };

  return (
    <>
      <div className="pane-head">
        <span className="eyebrow">{t.graph.title}</span>
        <span className="hint">
          {layoutMode === 'radial' ? t.graph.hintRadial : t.graph.hintVertical}
        </span>
      </div>

      <div className="graph-toolbar">
        <div className="segmented">
          <button
            type="button"
            className={layoutMode === 'radial' ? 'active' : ''}
            onClick={() => onLayoutModeChange('radial')}
            title={t.graph.radialTitle}
          >
            ◎ {t.graph.radial}
          </button>
          <button
            type="button"
            className={layoutMode === 'vertical' ? 'active' : ''}
            onClick={() => onLayoutModeChange('vertical')}
            title={t.graph.verticalTitle}
          >
            ⊞ {t.graph.vertical}
          </button>
        </div>

        <div className="segmented">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.08, +(z - 0.1).toFixed(2)))}>
            −
          </button>
          <button type="button" onClick={fit} title={t.graph.fitToScreen}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}>
            +
          </button>
        </div>
        <button type="button" className="btn tiny" onClick={() => setZoom(1)}>
          100%
        </button>

        <button type="button" className="btn tiny" onClick={onCollapseAll}>
          {t.graph.collapseAll}
        </button>
        <button type="button" className="btn tiny" onClick={onExpandAll}>
          {t.graph.expandAll}
        </button>

        <button
          type="button"
          className="btn tiny"
          disabled={!api.selectedId || api.selectedId === viewRoot.id}
          title={t.graph.focusTitle}
          onClick={() => setFocusId(api.selectedId)}
        >
          ⤢ {t.graph.focus}
        </button>
        {focus && (
          <>
            <button
              type="button"
              className="btn tiny"
              title={t.graph.focusUpTitle}
              onClick={() => setFocusId(focus.parent && !focus.parent.isRoot ? focus.parent.id : null)}
            >
              ↑ {t.graph.focusUp}
            </button>
            <button type="button" className="btn tiny" onClick={() => setFocusId(null)}>
              ✕ {t.graph.wholeRoute}
            </button>
          </>
        )}

        <span className="hint">
          {focus && (
            <>
              {t.graph.focusOn(
                focus.node.matchers.map((m) => m.raw).join(' & ') || t.tester.routeWithoutMatchers,
              )}{' '}
              ·{' '}
            </>
          )}
          {t.graph.nodeCount(size.nodes)}
        </span>
      </div>

      <div
        className={`graph-scroll${panning ? ' panning' : ''}${dragging ? ' dnd' : ''}`}
        ref={scrollRef}
        onMouseDown={startPan}
        onMouseMove={(e) => {
          const el = scrollRef.current;
          if (!el || !pan.current) return;
          el.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
          el.scrollTop = pan.current.top - (e.clientY - pan.current.y);
        }}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
      >
        {layoutMode === 'radial' ? (
          <RadialGraph viewRoot={viewRoot} zoom={zoom} />
        ) : (
          <VerticalGraph viewRoot={viewRoot} zoom={zoom} pad={PAD} onDragStateChange={setDragging} />
        )}
      </div>
    </>
  );
}
