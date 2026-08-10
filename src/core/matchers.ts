/**
 * Parsing, validation and evaluation of Alertmanager matchers.
 *
 * String form: label="value" | label!="value" | label=~"regex" | label!~"regex"
 * The value may be unquoted (Alertmanager allows that), single-quoted or in
 * backticks. The whole string may be wrapped in braces: `{label="value"}`.
 *
 * Regexes: Alertmanager wraps the pattern in ^(?:...)$ (full match), so we do the
 * same. Go/RE2 inline flags such as `(?i)` are not supported inside a JS pattern —
 * they are stripped out and moved into the RegExp flags.
 */

import { dict } from '../i18n/dict';
import type { Matcher, MatcherOp } from './types';

export interface ParsedMatcher {
  label: string;
  op: MatcherOp;
  value: string;
}

export interface MatcherCheck {
  ok: boolean;
  parsed?: ParsedMatcher;
  /** Human-readable reason why the string is invalid. */
  error?: string;
  /** Warning: the string is valid but has a caveat, e.g. a non-leading `(?i)`. */
  warning?: string;
}

const LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const OPS: MatcherOp[] = ['=~', '!~', '!=', '='];

/** Parses a matcher string. Never throws. */
export function parseMatcher(input: string): MatcherCheck {
  const t = dict().matcher;
  let s = input.trim();
  if (!s) return { ok: false, error: t.emptyString };

  // Braced form: {label="value"}
  if (s.startsWith('{') && s.endsWith('}')) {
    s = s.slice(1, -1).trim();
    if (s.includes(',')) {
      return { ok: false, error: t.multipleInOneLine };
    }
  }

  // Find the first operator such that `!=` and `!~` are not eaten as `=`.
  let opIndex = -1;
  let op: MatcherOp | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const two = s.slice(i, i + 2);
    if ((OPS as string[]).includes(two)) {
      op = two as MatcherOp;
      opIndex = i;
      break;
    }
    if (s[i] === '=') {
      op = '=';
      opIndex = i;
      break;
    }
  }
  if (!op || opIndex < 0) {
    return { ok: false, error: t.noOperator };
  }

  const label = s.slice(0, opIndex).trim();
  if (!label) return { ok: false, error: t.noLabelName };
  if (!LABEL_RE.test(label)) {
    return { ok: false, error: t.badLabelName(label) };
  }

  const rawValue = s.slice(opIndex + op.length).trim();
  const valueResult = unquote(rawValue);
  if (valueResult.error) return { ok: false, error: valueResult.error };
  const value = valueResult.value;

  if (op === '=~' || op === '!~') {
    const compiled = compileRegex(value);
    if (compiled.error) {
      return { ok: false, parsed: { label, op, value }, error: compiled.error };
    }
    return {
      ok: true,
      parsed: { label, op, value },
      ...(compiled.warning ? { warning: compiled.warning } : {}),
    };
  }

  return { ok: true, parsed: { label, op, value } };
}

function unquote(raw: string): { value: string; error?: string } {
  if (raw === '') return { value: '' };
  const q = raw[0];
  if (q === '"' || q === "'" || q === '`') {
    if (raw.length < 2 || raw[raw.length - 1] !== q) {
      return { value: raw, error: dict().matcher.unclosedQuote };
    }
    const body = raw.slice(1, -1);
    if (q === '"') {
      // Go-style escape sequences: \" \\ \n \t \r
      let out = '';
      for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (ch === '\\' && i + 1 < body.length) {
          const next = body[i + 1];
          i += 1;
          if (next === 'n') out += '\n';
          else if (next === 't') out += '\t';
          else if (next === 'r') out += '\r';
          else out += next; // \" \\ \/ and anything else: as-is
        } else {
          out += ch;
        }
      }
      return { value: out };
    }
    return { value: body };
  }
  // Unquoted value: take it verbatim.
  return { value: raw };
}

export interface CompiledRegex {
  re?: RegExp;
  error?: string;
  warning?: string;
}

/**
 * What we cache is language-independent: the compiled RegExp plus *which* problem
 * was found, never the wording. Caching the message itself would freeze the text
 * in whatever language was active on first compile, and switching the UI language
 * would leave stale strings behind.
 */
interface RegexOutcome {
  re?: RegExp;
  invalidRegex?: string;
  unsupportedFlag?: string;
  inlineFlagNotAtStart?: boolean;
}

const regexCache = new Map<string, RegexOutcome>();

/**
 * Compiles an Alertmanager RE2 pattern into a full-match JS RegExp.
 * Handles inline flags such as (?i), (?is), (?m), (?s): they are stripped out and
 * moved into the RegExp flags. The RE2 `U` flag (non-greedy swap) is unsupported.
 */
export function compileRegex(pattern: string): CompiledRegex {
  const outcome = compileRegexOutcome(pattern);
  const t = dict().matcher;
  if (outcome.unsupportedFlag) return { error: t.unsupportedRegexFlag(outcome.unsupportedFlag) };
  if (outcome.invalidRegex) return { error: t.invalidRegex(outcome.invalidRegex) };
  return {
    re: outcome.re!,
    ...(outcome.inlineFlagNotAtStart ? { warning: t.inlineFlagNotAtStart } : {}),
  };
}

function compileRegexOutcome(pattern: string): RegexOutcome {
  const cached = regexCache.get(pattern);
  if (cached) return cached;

  let body = pattern;
  let flags = '';
  let inlineFlagNotAtStart = false;
  let unsupported: string | undefined;

  const addFlags = (group: string): void => {
    for (const f of group) {
      if (f === 'i' || f === 'm' || f === 's') {
        if (!flags.includes(f)) flags += f;
      } else {
        unsupported = f;
      }
    }
  };

  // Leading flag groups: (?i), (?is) and so on — strip while they are there.
  for (;;) {
    const m = /^\(\?([imsU]+)\)/.exec(body);
    if (!m) break;
    addFlags(m[1]);
    body = body.slice(m[0].length);
  }

  // Flags in the middle of the pattern: JS cannot do that, so we apply them to
  // the whole expression and flag it to the user.
  const inner = /\(\?([imsU]+)\)/g;
  if (inner.test(body)) {
    body = body.replace(/\(\?([imsU]+)\)/g, (_full, g: string) => {
      addFlags(g);
      return '';
    });
    inlineFlagNotAtStart = true;
  }

  let result: RegexOutcome;
  if (unsupported) {
    result = { unsupportedFlag: unsupported };
  } else {
    try {
      result = {
        re: new RegExp(`^(?:${body})$`, flags),
        ...(inlineFlagNotAtStart ? { inlineFlagNotAtStart } : {}),
      };
    } catch (e) {
      result = { invalidRegex: (e as Error).message };
    }
  }
  regexCache.set(pattern, result);
  return result;
}

export type Labels = Record<string, string>;

export interface MatcherEval {
  /** The matcher string parsed successfully. */
  valid: boolean;
  /** Whether the matcher passed on this label set. */
  pass: boolean;
  /** Actual label value (a missing label reads as ''). */
  actual: string;
  check: MatcherCheck;
}

/** Evaluates one matcher. An invalid string NEVER passes. */
export function evalMatcher(raw: string, labels: Labels): MatcherEval {
  const check = parseMatcher(raw);
  if (!check.ok || !check.parsed) {
    return { valid: false, pass: false, actual: '', check };
  }
  const { label, op, value } = check.parsed;
  // A missing label is treated as an empty string — exactly as Alertmanager does.
  const actual = Object.prototype.hasOwnProperty.call(labels, label) ? labels[label] : '';

  let pass: boolean;
  if (op === '=') {
    pass = actual === value;
  } else if (op === '!=') {
    pass = actual !== value;
  } else {
    const { re } = compileRegex(value);
    const hit = re ? re.test(actual) : false;
    pass = op === '=~' ? hit : !hit;
  }
  return { valid: true, pass, actual, check };
}

/** AND over every matcher of a route. */
export function matchersPass(matchers: Matcher[], labels: Labels): boolean {
  for (const m of matchers) {
    const r = evalMatcher(m.raw, labels);
    if (!r.valid || !r.pass) return false;
  }
  return true;
}

/** Collects label names appearing in matchers — used for autocomplete. */
export function labelNamesFrom(matchers: Matcher[]): string[] {
  const out: string[] = [];
  for (const m of matchers) {
    const c = parseMatcher(m.raw);
    if (c.ok && c.parsed) out.push(c.parsed.label);
  }
  return out;
}
