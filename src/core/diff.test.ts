import { describe, expect, it } from 'vitest';
import { collapseUnchanged, diffText } from './diff';
import { parseConfig } from './parse';
import { serializeRoute } from './serialize';
import { moveDown, patchNode } from './tree';
import { searchTree } from './search';

const CONFIG = `route:
  receiver: "null"
  routes:
    - receiver: a_critical
      matchers:
        - team="a"
        - severity="critical"
    - receiver: b_warning
      matchers:
        - team="b"
        - severity="warning"
    - matchers:
        - product=~"(?i)^checkout$"
      routes:
        - receiver: checkout_oncall_critical
          matchers:
            - severity="critical"
`;

function load() {
  const r = parseConfig(CONFIG);
  if (!r.ok) throw new Error(r.error);
  return r.root;
}

describe('diffText', () => {
  it('identical texts produce no changes', () => {
    const d = diffText('a\nb\nc', 'a\nb\nc');
    expect(d.changed).toBe(false);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.lines.every((l) => l.op === 'same')).toBe(true);
  });

  it('finds insertions, deletions and replacements', () => {
    const d = diffText('a\nb\nc', 'a\nX\nc\nd');
    expect(d.added).toBe(2); // X and d
    expect(d.removed).toBe(1); // b
    expect(d.lines.filter((l) => l.op === 'add').map((l) => l.text)).toEqual(['X', 'd']);
    expect(d.lines.filter((l) => l.op === 'del').map((l) => l.text)).toEqual(['b']);
  });

  it('numbers lines in both texts', () => {
    const d = diffText('a\nb', 'a\nX\nb');
    const add = d.lines.find((l) => l.op === 'add')!;
    expect(add.nextLine).toBe(2);
    expect(add.baseLine).toBeUndefined();
    const lastSame = d.lines.filter((l) => l.op === 'same').at(-1)!;
    expect([lastSame.baseLine, lastSame.nextLine]).toEqual([2, 3]);
  });

  it('editing a receiver yields exactly one +/- pair', () => {
    const base = load();
    const changed = patchNode(base, base.routes[0].id, { receiver: 'a_critical_v2' })!;
    const d = diffText(serializeRoute(base), serializeRoute(changed));
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    // receiver is the first line of a list item, so it comes with "- ".
    expect(d.lines.find((l) => l.op === 'add')!.text.trim()).toBe('- receiver: a_critical_v2');
    expect(d.lines.find((l) => l.op === 'del')!.text.trim()).toBe('- receiver: a_critical');
  });

  it('moving a route shows up as a moved block of lines', () => {
    const base = load();
    const moved = moveDown(base, base.routes[0].id)!;
    const d = diffText(serializeRoute(base), serializeRoute(moved));
    expect(d.changed).toBe(true);
    expect(d.added).toBeGreaterThan(0);
    expect(d.removed).toBeGreaterThan(0);
  });

  it('collapseUnchanged keeps the changes plus context', () => {
    const a = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
    const b = a.replace('line20', 'line20-changed');
    const d = diffText(a, b);
    const groups = collapseUnchanged(d.lines, 2);
    expect(groups).toHaveLength(1);
    const texts = groups[0].map((l) => l.text);
    expect(texts).toContain('line20-changed');
    expect(texts).toContain('line18');
    expect(texts).not.toContain('line10');
  });
});

describe('searchTree', () => {
  it('searches receivers and matchers, case-insensitively', () => {
    const root = load();
    expect(searchTree(root, 'checkout').map((h) => h.where)).toEqual(['matcher', 'receiver']);
    expect(searchTree(root, 'CHECKOUT')).toHaveLength(2);
    expect(searchTree(root, 'severity=').length).toBeGreaterThan(0);
    expect(searchTree(root, 'no-such-thing')).toEqual([]);
    expect(searchTree(root, '  ')).toEqual([]);
  });

  it('returns the depth and the matching text', () => {
    const root = load();
    const hit = searchTree(root, 'b_warning')[0];
    expect(hit.depth).toBe(1);
    expect(hit.text).toBe('b_warning');
    expect(hit.node.receiver).toBe('b_warning');
  });
});
