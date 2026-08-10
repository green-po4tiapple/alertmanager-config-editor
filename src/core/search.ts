/** Finding a route by receiver name or by matcher text. */

import type { RouteNode } from './types';

export interface SearchHit {
  node: RouteNode;
  /** What matched — used as the caption in the result list. */
  where: 'receiver' | 'matcher';
  /** The string the match was found in. */
  text: string;
  /** Depth of the route, to give the list some orientation. */
  depth: number;
}

export function searchTree(root: RouteNode, rawQuery: string, limit = 60): SearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') return [];

  const hits: SearchHit[] = [];
  const walk = (node: RouteNode, depth: number): void => {
    if (hits.length >= limit) return;

    const receiver = node.receiver;
    if (receiver !== null && receiver.toLowerCase().includes(query)) {
      hits.push({ node, where: 'receiver', text: receiver, depth });
    } else {
      const m = node.matchers.find((x) => x.raw.toLowerCase().includes(query));
      if (m) hits.push({ node, where: 'matcher', text: m.raw, depth });
    }

    node.routes.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return hits;
}
