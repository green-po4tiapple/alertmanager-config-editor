/**
 * Serialising the tree model back into YAML.
 *
 * Key order inside a route is fixed and close to how people write configs by hand:
 *   receiver → group_by → matchers (+ legacy match/match_re) → continue →
 *   group_wait → group_interval → repeat_interval → mute/active_time_intervals →
 *   unknown keys (as they were) → routes
 *
 * Matcher strings are written as-is (plain scalars), never re-quoted:
 * `product=~"(?i)^checkout$"` must reach the file character for character.
 *
 * This is a hand-written serializer rather than `yaml.dump` precisely because that
 * control matters: `receiver: "null"` has to stay quoted, and key order has to stay
 * readable to a human reviewing the diff.
 */

import { dump } from 'js-yaml';
import { parseMatcher } from './matchers';
import type { RouteNode } from './types';
import type { RouteBlockRange } from './parse';

const INDENT_STEP = 2;

/** The complete `route:` block, starting at zero indentation. */
export function serializeRoute(root: RouteNode): string {
  const lines = ['route:', ...nodeLines(root, INDENT_STEP)];
  return `${lines.join('\n')}\n`;
}

/** Lines of a single route, already indented by `indent`. */
export function nodeLines(node: RouteNode, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  if (node.receiver !== null) {
    lines.push(`${pad}receiver: ${yamlScalar(node.receiver)}`);
  }

  if (node.groupBy !== null) {
    lines.push(`${pad}group_by:`);
    for (const g of node.groupBy) lines.push(`${pad}${' '.repeat(INDENT_STEP)}- ${yamlScalar(g)}`);
  }

  const plain = node.matchers.filter((m) => m.origin === 'matchers');
  const legacyEq = node.matchers.filter((m) => m.origin === 'match');
  const legacyRe = node.matchers.filter((m) => m.origin === 'match_re');

  const eq = legacyMapLines('match', legacyEq, '=', pad);
  const re = legacyMapLines('match_re', legacyRe, '=~', pad);

  // Matchers the user rewrote into an operator a legacy mapping cannot express fall
  // back to the modern matchers: list.
  const matcherStrings = [...plain.map((m) => m.raw), ...eq.orphaned, ...re.orphaned];
  if (matcherStrings.length > 0) {
    lines.push(`${pad}matchers:`);
    for (const raw of matcherStrings) {
      lines.push(`${pad}${' '.repeat(INDENT_STEP)}- ${matcherScalar(raw)}`);
    }
  }
  lines.push(...eq.lines, ...re.lines);

  if (node.continue) lines.push(`${pad}continue: true`);
  if (node.groupWait) lines.push(`${pad}group_wait: ${yamlScalar(node.groupWait)}`);
  if (node.groupInterval) lines.push(`${pad}group_interval: ${yamlScalar(node.groupInterval)}`);
  if (node.repeatInterval) lines.push(`${pad}repeat_interval: ${yamlScalar(node.repeatInterval)}`);

  if (node.muteTimeIntervals !== null) {
    lines.push(`${pad}mute_time_intervals:`);
    for (const t of node.muteTimeIntervals) {
      lines.push(`${pad}${' '.repeat(INDENT_STEP)}- ${yamlScalar(t)}`);
    }
  }
  if (node.activeTimeIntervals !== null) {
    lines.push(`${pad}active_time_intervals:`);
    for (const t of node.activeTimeIntervals) {
      lines.push(`${pad}${' '.repeat(INDENT_STEP)}- ${yamlScalar(t)}`);
    }
  }

  for (const [key, value] of Object.entries(node.extra)) {
    lines.push(...dumpExtra(key, value, indent));
  }

  if (node.routes.length > 0) {
    lines.push(`${pad}routes:`);
    const itemPad = ' '.repeat(indent + INDENT_STEP);
    const childIndent = indent + INDENT_STEP * 2;
    for (const child of node.routes) {
      const childLines = nodeLines(child, childIndent);
      if (childLines.length === 0) {
        lines.push(`${itemPad}- {}`);
        continue;
      }
      lines.push(`${itemPad}- ${childLines[0].slice(childIndent)}`);
      for (let i = 1; i < childLines.length; i += 1) lines.push(childLines[i]);
    }
  }

  return lines;
}

/** Rebuilds the legacy `match:` / `match_re:` mappings from matchers. */
function legacyMapLines(
  key: 'match' | 'match_re',
  items: RouteNode['matchers'],
  expectedOp: '=' | '=~',
  pad: string,
): { lines: string[]; orphaned: string[] } {
  const lines: string[] = [];
  const orphaned: string[] = [];
  if (items.length === 0) return { lines, orphaned };

  const pairs: Array<[string, string]> = [];
  for (const m of items) {
    const c = parseMatcher(m.raw);
    if (c.ok && c.parsed && c.parsed.op === expectedOp) pairs.push([c.parsed.label, c.parsed.value]);
    else orphaned.push(m.raw);
  }
  if (pairs.length > 0) {
    lines.push(`${pad}${key}:`);
    for (const [k, v] of pairs) {
      lines.push(`${pad}${' '.repeat(INDENT_STEP)}${yamlKey(k)}: ${yamlScalar(v)}`);
    }
  }
  return { lines, orphaned };
}

function dumpExtra(key: string, value: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const text = dump({ [key]: value }, { indent: INDENT_STEP, lineWidth: -1, noRefs: true });
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((l) => (l.trim() ? `${pad}${l}` : l));
}

const BARE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BARE_SCALAR_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\-/@]*$/;
const NUMERIC_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
/**
 * Words that YAML — including Go's yaml.v2, which is YAML 1.1 — may read as
 * something other than a string. These are always quoted: `receiver: "null"` must
 * stay a receiver NAME and not turn into a null.
 */
const RESERVED_WORDS = new Set([
  'null',
  'Null',
  'NULL',
  '~',
  'true',
  'True',
  'TRUE',
  'false',
  'False',
  'FALSE',
  'yes',
  'Yes',
  'YES',
  'no',
  'No',
  'NO',
  'on',
  'On',
  'ON',
  'off',
  'Off',
  'OFF',
  'y',
  'Y',
  'n',
  'N',
]);

export function yamlScalar(value: string): string {
  if (value === '') return '""';
  if (RESERVED_WORDS.has(value) || NUMERIC_RE.test(value) || !BARE_SCALAR_RE.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function yamlKey(key: string): string {
  return BARE_KEY_RE.test(key) ? key : JSON.stringify(key);
}

/**
 * A matcher as a list item. A plain scalar preserves the inner quotes
 * (`product=~"(?i)^x$"`), but a plain scalar may not contain `: ` or ` #`, nor start
 * with an indicator character — in those cases the whole string gets quoted.
 */
export function matcherScalar(raw: string): string {
  const s = raw;
  const needsQuote =
    s === '' ||
    s !== s.trim() ||
    !/^[A-Za-z_]/.test(s) ||
    s.includes(': ') ||
    s.includes(' #') ||
    s.endsWith(':') ||
    /[\n\r]/.test(s);
  return needsQuote ? JSON.stringify(s) : s;
}

/**
 * The whole-file export: the original text with only the `route:` block replaced.
 * Everything else — receivers holding tokens, inhibit_rules, comments — is carried
 * over from the original character for character, because the editor never touched
 * it in the first place.
 */
export function spliceRouteBlock(
  originalText: string,
  block: RouteBlockRange,
  routeYaml: string,
): string {
  const eol = originalText.includes('\r\n') ? '\r\n' : '\n';
  const lines = originalText.replace(/\r\n?/g, '\n').split('\n');
  const baseIndent = /^ */.exec(lines[block.start])![0].length;
  const pad = ' '.repeat(baseIndent);
  const newLines = routeYaml
    .replace(/\n$/, '')
    .split('\n')
    .map((l) => (l.trim() ? `${pad}${l}` : l));
  const out = [...lines.slice(0, block.start), ...newLines, ...lines.slice(block.end)];
  return out.join(eol);
}
