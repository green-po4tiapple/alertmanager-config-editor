/** Finds a route by receiver or matcher text and jumps to it. */

import { useMemo } from 'react';
import { searchTree } from '../core/search';
import type { RouteNode } from '../core/types';
import { useT } from '../i18n/react';

export function SearchPanel({
  root,
  query,
  onQueryChange,
  onSelectNode,
}: {
  root: RouteNode;
  query: string;
  onQueryChange: (q: string) => void;
  onSelectNode: (id: string) => void;
}): React.JSX.Element {
  const t = useT();
  const hits = useMemo(() => searchTree(root, query), [root, query]);
  const trimmed = query.trim();

  return (
    <section className="side-section">
      <div className="eyebrow">
        <span>{t.search.title}</span>
        {trimmed !== '' && <span className="hint">{t.search.matches(hits.length)}</span>}
      </div>

      <div className="label-row search-row">
        <input
          type="search"
          placeholder={t.search.placeholder}
          value={query}
          spellCheck={false}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn"
          title={t.common.clear}
          onClick={() => onQueryChange('')}
        >
          ✕
        </button>
      </div>

      {trimmed !== '' && hits.length === 0 && <span className="hint">{t.search.nothingFound}</span>}

      {hits.length > 0 && (
        <div className="hit-list">
          {hits.map((h) => (
            <button
              type="button"
              className="hit-row"
              key={h.node.id}
              onClick={() => onSelectNode(h.node.id)}
              title={t.search.goToRoute}
            >
              <span className={`badge ${h.where === 'receiver' ? 'continue' : ''}`}>
                {h.where === 'receiver' ? 'receiver' : t.search.matcher}
              </span>
              <code>{h.text}</code>
              <span className="hint">{t.search.level(h.depth)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
