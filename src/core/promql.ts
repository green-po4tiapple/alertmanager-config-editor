/**
 * Minimal PromQL parsing — exactly as much as the batch check needs: pull out
 * metric selectors, and be able to strip a final threshold comparison.
 *
 * A full parser is not needed here and would be a liability: the goal is not to
 * evaluate the expression but to work out which series sit behind it.
 *
 * Both edge cases handled below were found by running this over a real corpus of
 * rules, not by imagination: `offset 1d` used to yield a "metric" named `d`, and
 * `by (namespace, pod)` used to yield "metrics" named after the labels.
 */

/** PromQL functions and keywords — none of these are metrics. */
const NOT_METRICS = new Set([
  'abs', 'absent', 'absent_over_time', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh',
  'avg', 'avg_over_time', 'bottomk', 'by', 'bool', 'ceil', 'changes', 'clamp', 'clamp_max',
  'clamp_min', 'cos', 'cosh', 'count', 'count_over_time', 'count_values', 'day_of_month',
  'day_of_week', 'day_of_year', 'days_in_month', 'deg', 'delta', 'deriv', 'exp', 'floor', 'group',
  'group_left', 'group_right', 'histogram_count', 'histogram_fraction', 'histogram_quantile',
  'histogram_sum', 'holt_winters', 'hour', 'idelta', 'ignoring', 'increase', 'irate', 'label_join',
  'label_replace', 'last_over_time', 'ln', 'log10', 'log2', 'mad_over_time', 'max', 'max_over_time',
  'min', 'min_over_time', 'minute', 'month', 'offset', 'on', 'pi', 'predict_linear',
  'present_over_time', 'quantile', 'quantile_over_time', 'rad', 'rate', 'resets', 'round',
  'scalar', 'sgn', 'sin', 'sinh', 'sort', 'sort_desc', 'sqrt', 'stddev', 'stddev_over_time',
  'stdvar', 'stdvar_over_time', 'sum', 'sum_over_time', 'tan', 'tanh', 'time', 'timestamp',
  'topk', 'vector', 'without', 'year', 'and', 'or', 'unless', 'unless_on', 'start', 'end',
  'inf', 'nan', 'keep_metric_names',
]);

/** Keywords whose parenthesised list holds label names, not metrics. */
const GROUPING = new Set(['by', 'without', 'on', 'ignoring', 'group_left', 'group_right']);

/**
 * Extracts series selectors: `metric{...}` or a bare metric name.
 * Duplicates are removed, order is preserved.
 */
export function extractSelectors(expr: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let i = 0;

  const isIdentStart = (c: string): boolean => /[a-zA-Z_:]/.test(c);
  const isIdent = (c: string): boolean => /[a-zA-Z0-9_:]/.test(c);

  while (i < expr.length) {
    const ch = expr[i];

    // Skip strings wholesale — they can contain metric-looking words.
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(expr, i);
      continue;
    }

    // Ranges and subqueries: [5m], [1h:1m] — otherwise "m" would become a metric.
    if (ch === '[') {
      i = skipTo(expr, i, ']');
      continue;
    }

    if (!isIdentStart(ch)) {
      i += 1;
      continue;
    }

    let j = i;
    while (j < expr.length && isIdent(expr[j])) j += 1;
    const name = expr.slice(i, j);

    // Duration suffix: `offset 1d`, `5m`, `100ms` — letters right after a digit are
    // a time unit, not a metric.
    if (i > 0 && /[\d.]/.test(expr[i - 1])) {
      i = j;
      continue;
    }

    // Whitespace between the name and a parenthesis or brace.
    let k = j;
    while (k < expr.length && /\s/.test(expr[k])) k += 1;

    // by (namespace, pod) / on (...) / group_left (...) — the parentheses hold LABEL
    // names, not metrics, so the whole list is skipped.
    if (GROUPING.has(name)) {
      i = expr[k] === '(' ? skipTo(expr, k, ')') : j;
      continue;
    }

    if (expr[k] === '(') {
      // A function call: the name itself is not a metric, so step inside.
      i = j;
      continue;
    }

    if (NOT_METRICS.has(name)) {
      i = j;
      continue;
    }

    let selector = name;
    if (expr[k] === '{') {
      const end = matchBrace(expr, k);
      if (end > 0) {
        selector = `${name}${expr.slice(k, end + 1)}`;
        j = end + 1;
      }
    }

    if (!seen.has(selector)) {
      seen.add(selector);
      out.push(selector);
    }
    i = j;
  }

  return out;
}

/** Label names mentioned in the expression's selectors. */
export function labelNamesInExpr(expr: string): string[] {
  const names = new Set<string>();
  for (const sel of extractSelectors(expr)) {
    const brace = sel.indexOf('{');
    if (brace < 0) continue;
    const body = sel.slice(brace + 1, -1);
    for (const m of body.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=~|!~|!=|=)/g)) {
      if (m[1] !== '__name__') names.add(m[1]);
    }
  }
  // Grouping labels: by (...) / without (...) — these survive into the result.
  for (const m of expr.matchAll(/\b(?:by|without)\s*\(([^)]*)\)/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim();
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

/**
 * Strips a final threshold comparison: `foo > 5` → `foo`.
 *
 * Needed for rules that are not firing right now: without the threshold the
 * expression still returns series carrying the CORRECT label set (aggregations are
 * already applied), which is enough to see where such an alert would go.
 */
export function stripFinalComparison(expr: string): string | null {
  const ops = ['==', '!=', '>=', '<=', '>', '<'];
  let depth = 0;
  let i = 0;
  let cut = -1;
  let cutLen = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(expr, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (depth === 0) {
      const two = expr.slice(i, i + 2);
      const op = ops.find((o) => (o.length === 2 ? two === o : ch === o && two !== '=~' && two !== '!~'));
      if (op) {
        cut = i;
        cutLen = op.length;
        i += op.length;
        continue;
      }
    }
    i += 1;
  }

  if (cut < 0) return null;
  const head = expr.slice(0, cut).trim();
  const tail = expr.slice(cut + cutLen).trim();
  // Only cut when the right-hand side really is a threshold, not a second series:
  // `a > b` compares two series and its result has a different label set.
  if (!/^(bool\s+)?[-+]?[\d._eE]+$/.test(tail)) return null;
  return head === '' ? null : head;
}

function skipTo(text: string, start: number, closing: string): number {
  let i = start + 1;
  while (i < text.length && text[i] !== closing) i += 1;
  return i + 1;
}

function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

function matchBrace(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}
