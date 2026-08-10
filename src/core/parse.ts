/**
 * Parses pasted YAML into the tree model.
 *
 * Three shapes of input are accepted:
 *   1) a whole alertmanager_config.yaml (the top-level `route:` key is located);
 *   2) just the block starting at `route:`;
 *   3) the innards of a route block — `receiver:` / `matchers:` / `routes:` … —
 *      or a fragment of a route list (lines starting with `- `).
 *
 * From the `receivers:` block ONLY the names (`name:`) are taken, for autocomplete.
 * No webhook/telegram configs, tokens or URLs ever reach application state.
 */

import { load } from 'js-yaml';
import { dict } from '../i18n/dict';
import { nextId } from './ids';
import type { Matcher, RouteNode } from './types';

export interface RouteBlockRange {
  /** 0-based line indices of the source text: [start, end), `route:` key included. */
  start: number;
  end: number;
}

export interface ParseSuccess {
  ok: true;
  root: RouteNode;
  /** Receiver names from the `receivers:` block (when a whole file was pasted). */
  receiverNames: string[];
  /** Whether a whole file was pasted (has `route:` and possibly `receivers:`). */
  wholeFile: boolean;
  /** Bounds of the `route:` block in the source text — for the whole-file export. */
  routeBlock: RouteBlockRange | null;
  warnings: string[];
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

const ROUTE_KEYS = new Set([
  'receiver',
  'routes',
  'matchers',
  'match',
  'match_re',
  'group_by',
  'group_wait',
  'group_interval',
  'repeat_interval',
  'continue',
  'mute_time_intervals',
  'active_time_intervals',
]);

const KNOWN_KEYS = new Set([...ROUTE_KEYS]);

export function parseConfig(text: string): ParseResult {
  const t = dict().parse;
  if (!text.trim()) return { ok: false, error: t.emptyInput };

  const warnings: string[] = [];
  const prepared = prepare(text);

  let doc: unknown;
  try {
    doc = load(prepared.text);
  } catch (e) {
    return { ok: false, error: t.yamlFailed((e as Error).message) };
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: t.expectedMapping };
  }

  const obj = doc as Record<string, unknown>;
  let routeRaw: unknown;
  let container: Record<string, unknown> = obj;
  let wholeFile = false;

  if (looksLikeRoute(obj.route)) {
    routeRaw = obj.route;
    wholeFile = true;
  } else if (Object.keys(obj).some((k) => ROUTE_KEYS.has(k))) {
    routeRaw = obj;
  } else {
    // The config may live inside a Flux HelmRelease, a ConfigMap or a Secret —
    // look for `route:` at any depth, including inside a YAML string field.
    const nested = findNestedRoute(obj);
    if (!nested) {
      return {
        ok: false,
        error: t.noRouteKey(Object.keys(obj).slice(0, 8).join(', ')),
      };
    }
    routeRaw = nested.route;
    container = nested.container;
    wholeFile = true;
    warnings.push(t.nestedRoute(nested.path));
  }

  if (routeRaw === null || typeof routeRaw !== 'object' || Array.isArray(routeRaw)) {
    return { ok: false, error: t.routeMustBeMapping };
  }

  const root = buildNode(routeRaw as Record<string, unknown>, true, warnings, 'route');
  const receiverNames = extractReceiverNames(container, warnings);
  const routeBlock = wholeFile ? findRouteBlock(text) : null;

  if (prepared.note) warnings.push(prepared.note);

  return { ok: true, root, receiverNames, wholeFile, routeBlock, warnings };
}

/**
 * Normalises the paste into something a YAML parser will definitely accept:
 *  - strips a common indent (text copied out of the middle of a file);
 *  - wraps a route-list fragment ("- matchers:" …) into `routes:`.
 */
function prepare(text: string): { text: string; note?: string } {
  const t = dict().parse;
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const lines = normalized.split('\n');
  const meaningful = lines.filter((l) => l.trim() && !/^\s*#/.test(l));
  if (meaningful.length === 0) return { text: normalized };

  let minIndent = Infinity;
  for (const l of meaningful) {
    const m = /^ */.exec(l);
    minIndent = Math.min(minIndent, m ? m[0].length : 0);
  }
  let out = normalized;
  let note: string | undefined;
  if (minIndent > 0 && Number.isFinite(minIndent)) {
    out = lines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l.trimStart())).join('\n');
    note = t.dedented(minIndent);
  }

  const firstMeaningful = out.split('\n').find((l) => l.trim() && !/^\s*#/.test(l)) ?? '';
  if (/^-\s/.test(firstMeaningful) || firstMeaningful.trim() === '-') {
    const indented = out
      .split('\n')
      .map((l) => (l.trim() ? `  ${l}` : l))
      .join('\n');
    out = `routes:\n${indented}`;
    note = t.routesFragmentWrapped;
  }

  return note ? { text: out, note } : { text: out };
}

function looksLikeRoute(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).some((k) => ROUTE_KEYS.has(k));
}

interface NestedRoute {
  route: unknown;
  /** The object `route` sits next to — `receivers:` is looked for there too. */
  container: Record<string, unknown>;
  /** Path to the key that was found, for the message shown to the user. */
  path: string;
}

/**
 * Finds `route:` at any depth of the document. Needed when the Alertmanager config
 * is embedded in a Flux HelmRelease (`spec.values.….config.route`), a ConfigMap or
 * a Secret — including when it sits as a YAML string inside a field.
 */
function findNestedRoute(root: Record<string, unknown>, maxDepth = 14): NestedRoute | null {
  const queue: Array<{ node: Record<string, unknown>; path: string; depth: number }> = [
    { node: root, path: '$', depth: 0 },
  ];

  while (queue.length > 0) {
    const { node, path, depth } = queue.shift()!;
    if (depth > maxDepth) continue;

    if (looksLikeRoute(node.route)) {
      return { route: node.route, container: node, path: `${path}.route` };
    }

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        queue.push({ node: value as Record<string, unknown>, path: `${path}.${key}`, depth: depth + 1 });
      } else if (typeof value === 'string' && /(^|\n)\s*route:/.test(value)) {
        // Config held as a string inside a field (ConfigMap `alertmanager.yml: |`).
        try {
          const inner = load(value);
          if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            const innerObj = inner as Record<string, unknown>;
            if (looksLikeRoute(innerObj.route)) {
              return { route: innerObj.route, container: innerObj, path: `${path}.${key}` };
            }
          }
        } catch {
          // Not YAML — keep walking.
        }
      }
    }
  }
  return null;
}

function buildNode(
  raw: Record<string, unknown>,
  isRoot: boolean,
  warnings: string[],
  where: string,
): RouteNode {
  const t = dict().parse;
  const node: RouteNode = {
    id: nextId(),
    isRoot,
    receiver: readReceiver(raw, warnings, where),
    matchers: readMatchers(raw, warnings, where),
    continue: raw.continue === true,
    repeatInterval: readScalar(raw.repeat_interval),
    groupWait: readScalar(raw.group_wait),
    groupInterval: readScalar(raw.group_interval),
    groupBy: readStringList(raw.group_by),
    muteTimeIntervals: readStringList(raw.mute_time_intervals),
    activeTimeIntervals: readStringList(raw.active_time_intervals),
    extra: {},
    routes: [],
    collapsed: false,
  };

  if (raw.continue !== undefined && typeof raw.continue !== 'boolean') {
    warnings.push(t.continueMustBeBool(where, String(raw.continue)));
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(key)) node.extra[key] = value;
  }

  const routes = raw.routes;
  if (routes !== undefined && routes !== null) {
    if (!Array.isArray(routes)) {
      warnings.push(t.routesMustBeList(where));
    } else {
      routes.forEach((child, i) => {
        if (child === null || typeof child !== 'object' || Array.isArray(child)) {
          warnings.push(t.routeNotMapping(`${where}.routes[${i}]`));
          return;
        }
        node.routes.push(
          buildNode(child as Record<string, unknown>, false, warnings, `${where}.routes[${i}]`),
        );
      });
    }
  }

  return node;
}

function readReceiver(
  raw: Record<string, unknown>,
  warnings: string[],
  where: string,
): string | null {
  if (!('receiver' in raw)) return null;
  const v = raw.receiver;
  if (v === null) {
    warnings.push(dict().parse.receiverYamlNull(where));
    return null;
  }
  if (typeof v === 'string') return v;
  warnings.push(dict().parse.receiverNotString(where, typeof v));
  return String(v);
}

function readMatchers(
  raw: Record<string, unknown>,
  warnings: string[],
  where: string,
): Matcher[] {
  const t = dict().parse;
  const out: Matcher[] = [];

  const list = raw.matchers;
  if (list !== undefined && list !== null) {
    if (!Array.isArray(list)) {
      warnings.push(t.matchersMustBeList(where));
    } else {
      for (const item of list) {
        if (typeof item === 'string') {
          out.push({ id: nextId('m'), raw: item, origin: 'matchers' });
        } else {
          warnings.push(t.matcherItemNotString(where));
          out.push({ id: nextId('m'), raw: String(item), origin: 'matchers' });
        }
      }
    }
  }

  // Legacy forms: `match` (equality) and `match_re` (regex).
  out.push(...readLegacyMap(raw.match, '=', 'match', warnings, where));
  out.push(...readLegacyMap(raw.match_re, '=~', 'match_re', warnings, where));

  return out;
}

function readLegacyMap(
  value: unknown,
  op: '=' | '=~',
  origin: 'match' | 'match_re',
  warnings: string[],
  where: string,
): Matcher[] {
  const t = dict().parse;
  if (value === undefined || value === null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(t.legacyMustBeMapping(where, origin));
    return [];
  }
  warnings.push(t.legacyDeprecated(where, origin, op));
  return Object.entries(value as Record<string, unknown>).map(([label, v]) => ({
    id: nextId('m'),
    raw: `${label}${op}"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    origin,
  }));
}

function readScalar(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

function readStringList(v: unknown): string[] | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v)];
}

function extractReceiverNames(obj: Record<string, unknown>, warnings: string[]): string[] {
  const raw = obj.receivers;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push(dict().parse.receiversNotList);
    return [];
  }
  const names: string[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const name = (item as Record<string, unknown>).name;
      // ONLY the name is taken. Everything else (webhook_configs, tokens, URLs) is
      // deliberately never read — see the test "only names are taken from receivers".
      if (typeof name === 'string') names.push(name);
      else if (name !== undefined && name !== null) names.push(String(name));
    }
  }
  return dedupe(names);
}

export function dedupe(items: string[]): string[] {
  return [...new Set(items.filter((s) => s !== ''))];
}

/**
 * Locates the bounds of the `route:` block in the ORIGINAL text (no indent
 * normalisation), so that the whole-file export replaces only that span and leaves
 * everything else — secrets in `receivers:` included — byte for byte.
 */
export function findRouteBlock(text: string): RouteBlockRange | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  let start = -1;
  let baseIndent = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = /^(\s*)route:\s*(#.*)?$/.exec(line);
    if (m) {
      start = i;
      baseIndent = m[1].length;
      break;
    }
  }
  if (start < 0) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = /^ */.exec(line)![0].length;
    if (indent <= baseIndent) {
      end = i;
      break;
    }
  }
  // Trailing blank lines are not part of the block.
  while (end > start + 1 && !lines[end - 1].trim()) end -= 1;

  return { start, end };
}
