let counter = 0;

/**
 * Ids for nodes and matchers, stable for the lifetime of the tab. They are never
 * written to YAML — they exist so that "the same route, moved" can be told apart
 * from "a new route" when diffing against the tree as loaded.
 */
export function nextId(prefix = 'n'): string {
  counter += 1;
  return `${prefix}${counter}`;
}

/** Tests only — keeps generated ids predictable. */
export function resetIds(): void {
  counter = 0;
}
