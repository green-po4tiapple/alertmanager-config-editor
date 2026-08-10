import { describe, expect, it } from 'vitest';
import { compileRegex, evalMatcher, parseMatcher } from './matchers';

describe('parseMatcher', () => {
  it('parses all four operators', () => {
    expect(parseMatcher('severity="critical"').parsed).toEqual({
      label: 'severity',
      op: '=',
      value: 'critical',
    });
    expect(parseMatcher('job!="node-exporter"').parsed).toEqual({
      label: 'job',
      op: '!=',
      value: 'node-exporter',
    });
    expect(parseMatcher('product=~".+"').parsed).toEqual({
      label: 'product',
      op: '=~',
      value: '.+',
    });
    expect(parseMatcher('product!~".+"').parsed).toEqual({
      label: 'product',
      op: '!~',
      value: '.+',
    });
  });

  it('does not confuse != and !~ with =', () => {
    expect(parseMatcher('a!="b"').parsed?.op).toBe('!=');
    expect(parseMatcher('a!~"b"').parsed?.op).toBe('!~');
    expect(parseMatcher('a=~"b"').parsed?.op).toBe('=~');
  });

  it('keeps a value containing regex characters intact', () => {
    const c = parseMatcher('product=~"(?i)^checkout$"');
    expect(c.ok).toBe(true);
    expect(c.parsed?.value).toBe('(?i)^checkout$');
  });

  it('accepts the braced form and unquoted values', () => {
    expect(parseMatcher('{severity="critical"}').parsed?.value).toBe('critical');
    expect(parseMatcher('severity=critical').parsed?.value).toBe('critical');
  });

  it('rejects garbage', () => {
    expect(parseMatcher('').ok).toBe(false);
    expect(parseMatcher('severity').ok).toBe(false);
    expect(parseMatcher('123bad="x"').ok).toBe(false);
    expect(parseMatcher('severity="unclosed').ok).toBe(false);
    expect(parseMatcher('a=~"("').ok).toBe(false);
    expect(parseMatcher('{a="1", b="2"}').ok).toBe(false);
  });

  it('expands escape sequences inside double quotes', () => {
    expect(parseMatcher('msg="a\\"b"').parsed?.value).toBe('a"b');
  });
});

describe('compileRegex', () => {
  it('matches in full, never partially', () => {
    const { re } = compileRegex('checkout');
    expect(re!.test('checkout')).toBe(true);
    expect(re!.test('xcheckoutx')).toBe(false);
  });

  it('moves (?i) out of the pattern and into the flags', () => {
    const { re, error } = compileRegex('(?i)^checkout$');
    expect(error).toBeUndefined();
    expect(re!.flags).toContain('i');
    expect(re!.test('Checkout')).toBe(true);
  });

  it('an alternation with an empty branch matches the empty string', () => {
    // cluster=~"staging|dev|" — taken from a real config
    const { re } = compileRegex('staging|dev|');
    expect(re!.test('')).toBe(true);
    expect(re!.test('staging')).toBe(true);
    expect(re!.test('prod')).toBe(false);
  });

  it('(?i) mid-pattern works, but with a warning', () => {
    const { re, warning } = compileRegex('^foo(?i)bar$');
    expect(warning).toBeDefined();
    expect(re!.test('fooBAR')).toBe(true);
  });
});

describe('evalMatcher', () => {
  it('a missing label reads as an empty string', () => {
    // product!~".+" means "product is empty or absent"
    expect(evalMatcher('product!~".+"', {}).pass).toBe(true);
    expect(evalMatcher('product!~".+"', { product: '' }).pass).toBe(true);
    expect(evalMatcher('product!~".+"', { product: 'payments' }).pass).toBe(false);

    expect(evalMatcher('product=~".+"', {}).pass).toBe(false);
    expect(evalMatcher('team!="x"', {}).pass).toBe(true);
    expect(evalMatcher('team="x"', {}).pass).toBe(false);
  });

  it('an invalid matcher never passes', () => {
    const r = evalMatcher('severity="unclosed', { severity: 'unclosed' });
    expect(r.valid).toBe(false);
    expect(r.pass).toBe(false);
  });

  it('case-insensitive comparison happens only via (?i)', () => {
    expect(evalMatcher('product=~"(?i)^checkout$"', { product: 'Checkout' }).pass).toBe(true);
    expect(evalMatcher('product=~"^checkout$"', { product: 'Checkout' }).pass).toBe(false);
    expect(evalMatcher('product="checkout"', { product: 'Checkout' }).pass).toBe(false);
  });
});
