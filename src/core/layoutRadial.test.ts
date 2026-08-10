import { describe, expect, it } from 'vitest';
import { labelTransform, layoutRadial, radialLabel } from './layoutRadial';
import { parseConfig } from './parse';
import { setCollapsedAll } from './tree';
import type { RouteNode } from './types';

function tree(yaml: string): RouteNode {
  const r = parseConfig(yaml);
  if (!r.ok) throw new Error(r.error);
  return r.root;
}

const SAMPLE = `route:
  receiver: "null"
  routes:
    - receiver: a_critical
      matchers:
        - team="a"
        - severity="critical"
    - receiver: a_warning
      matchers:
        - team="a"
        - severity="warning"
    - matchers:
        - team="b"
      routes:
        - receiver: b_critical
          matchers:
            - severity="critical"
        - receiver: b_warning
          matchers:
            - severity="warning"
`;

describe('layoutRadial', () => {
  it('root at the centre, children on rings', () => {
    const l = layoutRadial(tree(SAMPLE));
    const root = l.nodes.find((n) => n.node.isRoot)!;
    expect(root.radius).toBe(0);
    expect(root.x).toBe(0);
    expect(root.y).toBe(0);

    const depths = new Set(l.nodes.map((n) => n.depth));
    expect([...depths].sort()).toEqual([0, 1, 2]);

    // Inner nodes of the same level sit at exactly the same radius.
    // (Leaves may be pushed outward when their ring is too crowded for labels.)
    const byDepth = new Map<number, number[]>();
    for (const n of l.nodes) {
      if (n.isLeaf) continue;
      byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n.radius]);
    }
    for (const [, radii] of byDepth) expect(new Set(radii).size).toBe(1);

    // No node ends up closer to the centre than its own ring.
    const ringStep = l.nodes.find((n) => !n.isLeaf && n.depth === 1)!.radius;
    for (const n of l.nodes) expect(n.radius).toBeGreaterThanOrEqual(n.depth * ringStep);
  });

  it('leaves are spread evenly around the circle, a parent sits between its children', () => {
    const l = layoutRadial(tree(SAMPLE));
    const leaves = l.nodes.filter((n) => n.isLeaf).sort((a, b) => a.angle - b.angle);
    expect(leaves).toHaveLength(4);

    const gaps = leaves.slice(1).map((n, i) => n.angle - leaves[i].angle);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);

    const teamB = l.nodes.find((n) => n.node.matchers[0]?.raw === 'team="b"')!;
    const kids = l.nodes.filter((n) => teamB.node.routes.some((r) => r.id === n.id));
    expect(teamB.angle).toBeCloseTo((kids[0].angle + kids[1].angle) / 2, 6);
  });

  it('there is exactly one edge fewer than there are nodes', () => {
    const l = layoutRadial(tree(SAMPLE));
    expect(l.edges).toHaveLength(l.nodes.length - 1);
    for (const e of l.edges) expect(e.path).toMatch(/^M [-\d.]+ [-\d.]+ C /);
  });

  it('collapsed routes are not laid out but remember their subtree size', () => {
    const collapsed = setCollapsedAll(tree(SAMPLE), true);
    const l = layoutRadial(collapsed);
    const teamB = l.nodes.find((n) => n.node.matchers[0]?.raw === 'team="b"')!;
    expect(teamB.collapsed).toBe(true);
    expect(teamB.hiddenSubtree).toBe(2);
    expect(l.nodes.some((n) => n.node.receiver === 'b_critical')).toBe(false);
  });

  it('leaves on an inner ring get enough arc for their label', () => {
    // Edge case: many leaves directly under the root plus one deep branch.
    const many = Array.from(
      { length: 30 },
      (_, i) => `    - receiver: "null"\n      matchers:\n        - alertname="A${i}"`,
    ).join('\n');
    const root = tree(`route:
  routes:
${many}
    - matchers:
        - team=~".+"
      routes:
        - receiver: deep
          matchers:
            - severity="critical"
`);
    const l = layoutRadial(root);
    const innerLeaves = l.nodes.filter((n) => n.isLeaf && n.depth === 1);
    expect(innerLeaves.length).toBe(30);
    const angles = innerLeaves.map((n) => n.angle).sort((a, b) => a - b);
    const slot = angles[1] - angles[0];
    // Arc length between neighbouring labels at their own radius.
    expect(slot * innerLeaves[0].radius).toBeGreaterThanOrEqual(20);
  });

  it('no NaN anywhere and a sensible canvas size', () => {
    const l = layoutRadial(tree(SAMPLE));
    for (const n of l.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.angle)).toBe(true);
    }
    expect(l.size).toBeGreaterThan(l.maxRadius * 2);
    expect(l.center).toBe(l.size / 2);
  });

  it('labels: receiver, null, and a matcher for routes without a receiver', () => {
    const root = tree(SAMPLE);
    expect(radialLabel(root)).toEqual({ text: 'null', kind: 'null' });
    expect(radialLabel(root.routes[0])).toEqual({ text: 'a_critical', kind: 'receiver' });
    expect(radialLabel(root.routes[2])).toEqual({ text: 'team="b"', kind: 'matcher' });
  });

  it('labels flip on the left half of the circle', () => {
    expect(labelTransform(0)).toEqual({ deg: -90, flip: false });
    expect(labelTransform(Math.PI / 2)).toEqual({ deg: 0, flip: false });
    expect(labelTransform(Math.PI * 1.5).flip).toBe(true);
  });
});
