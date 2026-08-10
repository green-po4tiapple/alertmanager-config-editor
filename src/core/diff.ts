/**
 * Line diff for the "what changed before export" screen.
 *
 * What is compared is NOT the pasted text against the export — that diff would be
 * nothing but noise from normalising key order and quoting. Instead two YAML texts
 * produced by the same serializer are compared: the baseline (right after parsing
 * the paste) and the current one. What is left is only the user's real edits.
 */

export type DiffOp = 'same' | 'add' | 'del';

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line number in the baseline text, when the line exists there. */
  baseLine?: number;
  /** 1-based line number in the current text, when the line exists there. */
  nextLine?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  changed: boolean;
}

/** Very large texts are not diffed line by line — guards against O(n·m). */
const MAX_LINES = 4000;

export function diffText(base: string, next: string): DiffResult {
  const a = splitLines(base);
  const b = splitLines(next);

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    const lines: DiffLine[] = [
      ...a.map((text, i): DiffLine => ({ op: 'del', text, baseLine: i + 1 })),
      ...b.map((text, i): DiffLine => ({ op: 'add', text, nextLine: i + 1 })),
    ];
    return { lines, added: b.length, removed: a.length, changed: base !== next };
  }

  // Classic LCS: lcs[i][j] is the length of the longest common subsequence of the
  // tails a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ op: 'same', text: a[i], baseLine: i + 1, nextLine: j + 1 });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ op: 'del', text: a[i], baseLine: i + 1 });
      removed += 1;
      i += 1;
    } else {
      lines.push({ op: 'add', text: b[j], nextLine: j + 1 });
      added += 1;
      j += 1;
    }
  }
  while (i < a.length) {
    lines.push({ op: 'del', text: a[i], baseLine: i + 1 });
    removed += 1;
    i += 1;
  }
  while (j < b.length) {
    lines.push({ op: 'add', text: b[j], nextLine: j + 1 });
    added += 1;
    j += 1;
  }

  return { lines, added, removed, changed: added > 0 || removed > 0 };
}

/**
 * Keeps only the changed hunks plus context — like `diff -U`.
 * Returns groups of lines with the gaps between them elided.
 */
export function collapseUnchanged(lines: DiffLine[], context = 3): DiffLine[][] {
  const keep = new Set<number>();
  lines.forEach((l, idx) => {
    if (l.op === 'same') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k += 1) {
      keep.add(k);
    }
  });

  const groups: DiffLine[][] = [];
  let current: DiffLine[] = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (keep.has(idx)) {
      current.push(lines[idx]);
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return normalized === '' ? [] : normalized.split('\n');
}
